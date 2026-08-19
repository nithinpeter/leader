import type { SiteExtraction } from '../lib/types'

const FETCH_TIMEOUT_MS = 15_000
const MAX_SUBPAGES = 3
const USER_AGENT =
  'Mozilla/5.0 (compatible; WestringiaLeader/1.0; +https://westringia.com)'

function normalizeUrl(raw: string): URL {
  const trimmed = raw.trim()
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const url = new URL(withScheme)
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error('Only http(s) URLs are supported')
  }
  return url
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    })
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    if (type && !type.includes('html')) return null
    return await res.text()
  } catch {
    return null
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
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
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

export async function performExtraction(rawUrl: string): Promise<SiteExtraction> {
    const baseUrl = normalizeUrl(rawUrl)
    let html = await fetchHtml(baseUrl.href)
    if (!html && baseUrl.protocol === 'https:') {
      html = await fetchHtml(`http://${baseUrl.host}${baseUrl.pathname}`)
    }
    if (!html) {
      throw new Error(
        `Could not fetch ${baseUrl.href}. The site may be down, blocking robots, or the URL may be wrong.`,
      )
    }

    const title = stripToText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
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
    for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) emails.add(m[1].toLowerCase())
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
      const subHtml = await fetchHtml(pageUrl)
      if (!subHtml) continue
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
