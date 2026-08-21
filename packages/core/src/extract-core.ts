import type { SiteExtraction } from './types'

const FETCH_TIMEOUT_MS = 15_000
const MAX_SUBPAGES = 3
const MAX_BODY_BYTES = 500_000
// A real browser string. Announcing ourselves as a bot gets us turned away by
// WAFs that would otherwise serve the page.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function normalizeUrl(raw: string): URL {
  const trimmed = raw.trim()
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const url = new URL(withScheme)
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error('Only http(s) URLs are supported')
  }
  return url
}

/**
 * A fetch either produces HTML or an explanation. Never collapse the two into
 * null - the reason is what makes a failed lead debuggable.
 */
type FetchOutcome = { ok: true; html: string } | { ok: false; reason: string }

/**
 * The slice of fetch the extractor uses, injectable so a public endpoint can
 * swap in an SSRF-guarded client for visitor-supplied URLs. Everything the
 * app or cron runs itself stays on the platform fetch.
 */
export type HtmlFetch = (
  url: string,
  init: {
    signal: AbortSignal
    redirect: 'follow'
    headers: Record<string, string>
  },
) => Promise<Response>

/** Read at most `maxBytes` of the body, then hang up on the rest. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return (await res.text()).slice(0, maxBytes)
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < maxBytes) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  await reader.cancel().catch(() => {})
  const buf = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    buf.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf)
}

async function fetchHtml(url: string, fetchImpl: HtmlFetch): Promise<FetchOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
    })
    if (!res.ok) {
      return { ok: false, reason: `the server answered ${res.status} ${res.statusText}`.trim() }
    }
    const type = res.headers.get('content-type') ?? ''
    if (type && !type.includes('html') && !type.includes('text')) {
      return { ok: false, reason: `the address served ${type.split(';')[0]}, not a web page` }
    }
    return { ok: true, html: await readCapped(res, MAX_BODY_BYTES) }
  } catch (e) {
    if (controller.signal.aborted) {
      return { ok: false, reason: `it did not answer within ${FETCH_TIMEOUT_MS / 1000} seconds` }
    }
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : ''
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: cause ? `${message} (${cause})` : message }
  } finally {
    clearTimeout(timer)
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (whole, n) => {
      const code = parseInt(n, 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    })
    .replace(/&#(\d+);/g, (whole, n) => {
      const code = Number(n)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    })
}

function stripToText(html: string): string {
  const cleaned = html
    .replace(/<(script|style|svg|noscript|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(cleaned).replace(/\s+/g, ' ').trim()
}

function metaContent(html: string, nameOrProp: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${nameOrProp}["'][^>]*content=["']([^"']*)["']`,
    'i',
  )
  const reReversed = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${nameOrProp}["']`,
    'i',
  )
  const m = html.match(re) ?? html.match(reReversed)
  return m ? decodeEntities(m[1]).trim() : ''
}

function extractHeadings(html: string): string[] {
  const out: string[] = []
  const re = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && out.length < 30) {
    const text = stripToText(m[2])
    if (text && text.length <= 160 && !out.includes(text)) out.push(text)
  }
  return out
}

function extractAnchors(html: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = []
  const re = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && out.length < 300) {
    out.push({ href: m[1], text: stripToText(m[2]) })
  }
  return out
}

function detectTechSignals(html: string): string[] {
  const signals: [RegExp, string][] = [
    [/<meta[^>]+generator[^>]+content=["']([^"']+)["']/i, ''],
    [/wp-content|wp-includes/i, 'WordPress'],
    [/cdn\.shopify\.com|myshopify\.com/i, 'Shopify'],
    [/static\.wixstatic\.com|wix\.com/i, 'Wix'],
    [/squarespace\.com|sqsp\.net/i, 'Squarespace'],
    [/__NEXT_DATA__|_next\/static/i, 'Next.js'],
    [/data-reactroot|react-dom/i, 'React'],
    [/webflow\.com|wf-page/i, 'Webflow'],
    [/hs-scripts\.com|hubspot/i, 'HubSpot'],
    [/calendly\.com/i, 'Calendly'],
    [/servicem8\.com/i, 'ServiceM8'],
    [/simpro/i, 'Simpro'],
    [/intercom|drift\.com|tawk\.to|livechat/i, 'Live chat widget'],
    [/googletagmanager|gtag\(/i, 'Google Analytics'],
  ]
  const found = new Set<string>()
  for (const [re, label] of signals) {
    const m = html.match(re)
    if (m) found.add(label || decodeEntities(m[1] ?? '').trim())
  }
  return [...found].filter(Boolean).slice(0, 10)
}

const SOCIAL_HOSTS =
  /(facebook|instagram|linkedin|youtube|tiktok|twitter|x)\.com|youtu\.be/i

const SUBPAGE_HINT =
  /about|service|product|what-we|team|industr|solution|capabilit|pricing|work/i

/** Titles bot walls serve with a perfectly cheerful HTTP 200. */
const CHALLENGE_TITLE =
  /^\s*(just a moment|attention required|client challenge|access denied|checking your browser|security check|please wait|pardon our interruption|request unsuccessful|one moment)/i

/** Scripts and resources only a challenge page loads. */
const CHALLENGE_MARKER =
  /cf-browser-verification|__cf_chl|challenge-platform|_Incapsula_Resource|distil_r_captcha|px-captcha/i

/**
 * A bot wall answers 200 with an interstitial, so `res.ok` proves nothing. Left
 * undetected we save the challenge page as the lead - "Client Challenge" as the
 * company name, no headings, no contact details.
 */
function detectChallenge(html: string, title: string, text: string): string | null {
  if (CHALLENGE_TITLE.test(title)) return title.trim()
  // A marker alone is not enough - real pages carry captchas on contact forms.
  // Paired with a near-empty body it is conclusive.
  if (CHALLENGE_MARKER.test(html) && text.length < 800) return 'a browser check'
  return null
}

export async function performExtraction(
  rawUrl: string,
  fetchImpl: HtmlFetch = fetch,
): Promise<SiteExtraction> {
    const baseUrl = normalizeUrl(rawUrl)
    let outcome = await fetchHtml(baseUrl.href, fetchImpl)
    if (!outcome.ok && baseUrl.protocol === 'https:') {
      const overHttp = await fetchHtml(`http://${baseUrl.host}${baseUrl.pathname}`, fetchImpl)
      if (overHttp.ok) outcome = overHttp
    }
    if (!outcome.ok) {
      throw new Error(`Could not fetch ${baseUrl.href} - ${outcome.reason}.`)
    }
    const html = outcome.html

    const title = stripToText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')

    const challenge = detectChallenge(html, title, stripToText(html))
    if (challenge) {
      throw new Error(
        `${baseUrl.host} served a bot check (${challenge}) instead of the site. Automated readers are blocked here - have a look yourself and add the lead by hand.`,
      )
    }
    const description =
      metaContent(html, 'description') || metaContent(html, 'og:description')
    const siteName = metaContent(html, 'og:site_name')

    const anchors = extractAnchors(html)
    const navigation = [
      ...new Set(
        anchors
          .map((a) => a.text)
          .filter((t) => t && t.length >= 3 && t.length <= 40),
      ),
    ].slice(0, 20)

    const socialLinks = [
      ...new Set(
        anchors.map((a) => a.href).filter((h) => SOCIAL_HOSTS.test(h)),
      ),
    ].slice(0, 8)

    const emails = new Set<string>()
    // mailto hrefs are often obfuscated against scrapers - percent-escapes or
    // numeric character references (mailto:&#108;uke&#064;...) that a browser
    // decodes silently. Decode before trusting the capture, and keep only what
    // still reads as an address; stored garbage ends up in the To field.
    for (const m of html.matchAll(/mailto:([^"'\s>]+)/gi)) {
      let href = m[1]
      try {
        href = decodeURIComponent(href)
      } catch {}
      const address = decodeEntities(href)
        .split('?')[0]
        .match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)
      if (address && emails.size < 5) emails.add(address[0].toLowerCase())
    }
    for (const m of stripToText(html).matchAll(
      /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi,
    )) {
      if (emails.size < 5) emails.add(m[0].toLowerCase())
    }

    const phones = new Set<string>()
    for (const m of html.matchAll(/tel:([^"'\s>]+)/gi)) {
      if (phones.size < 5) phones.add(decodeURIComponent(m[1]))
    }

    const techSignals = detectTechSignals(html)
    const headings = extractHeadings(html)
    let textSample = stripToText(html).slice(0, 3000)
    const pagesCrawled = [baseUrl.href]

    // Follow a few likely "about us / services" pages for a fuller picture.
    const candidates = [
      ...new Set(
        anchors
          .map((a) => a.href)
          .filter((h) => SUBPAGE_HINT.test(h))
          .map((h) => {
            try {
              return new URL(h, baseUrl).href
            } catch {
              return null
            }
          })
          .filter(
            (h): h is string =>
              !!h && new URL(h).host === baseUrl.host && h !== baseUrl.href,
          ),
      ),
    ].slice(0, MAX_SUBPAGES)

    for (const pageUrl of candidates) {
      const sub = await fetchHtml(pageUrl, fetchImpl)
      if (!sub.ok) continue
      const subHtml = sub.html
      pagesCrawled.push(pageUrl)
      for (const h of extractHeadings(subHtml)) {
        if (headings.length < 40 && !headings.includes(h)) headings.push(h)
      }
      textSample += `\n\n[${pageUrl}]\n${stripToText(subHtml).slice(0, 1500)}`
    }

    const services = headings
      .filter((h) => h.split(' ').length <= 8 && !/contact|home|menu/i.test(h))
      .slice(0, 12)

    const domain = baseUrl.host.replace(/^www\./, '')
    const companyName =
      siteName ||
      title.split(/\s*[|–—-]\s*/)[0]?.trim() ||
      domain.split('.')[0].replace(/^\w/, (c) => c.toUpperCase())

    return {
      url: baseUrl.href,
      domain,
      companyName,
      title,
      description,
      headings: headings.slice(0, 40),
      navigation,
      services,
      textSample: textSample.slice(0, 8000),
      pagesCrawled,
      emails: [...emails].slice(0, 5),
      phones: [...phones],
      socialLinks,
      techSignals,
      fetchedAt: new Date().toISOString(),
    }
}
