/**
 * The fetch-and-parse toolbox shared by the extractors: site extraction
 * (extract-core) reads one business's website, directory harvesting
 * (harvest-core) reads a professional body's member listing. Both need the
 * same careful fetch - capped bodies, a real browser string, bot-wall
 * detection - so it lives here once.
 */

const FETCH_TIMEOUT_MS = 15_000
const MAX_BODY_BYTES = 500_000

// A real browser string. Announcing ourselves as a bot gets us turned away by
// WAFs that would otherwise serve the page.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export function normalizeUrl(raw: string): URL {
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
export type FetchOutcome = { ok: true; html: string } | { ok: false; reason: string }

/**
 * The slice of fetch the extractors use, injectable so a public endpoint can
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

export async function fetchHtml(url: string, fetchImpl: HtmlFetch): Promise<FetchOutcome> {
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

export function decodeEntities(s: string): string {
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

export function stripToText(html: string): string {
  const cleaned = html
    .replace(/<(script|style|svg|noscript|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(cleaned).replace(/\s+/g, ' ').trim()
}

export function metaContent(html: string, nameOrProp: string): string {
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

export function pageTitle(html: string): string {
  return stripToText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
}

export function extractAnchors(
  html: string,
  limit = 300,
): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = []
  const re = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && out.length < limit) {
    out.push({ href: decodeEntities(m[1]), text: stripToText(m[2]) })
  }
  return out
}

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
export function detectChallenge(html: string, title: string, text: string): string | null {
  if (CHALLENGE_TITLE.test(title)) return title.trim()
  // A marker alone is not enough - real pages carry captchas on contact forms.
  // Paired with a near-empty body it is conclusive.
  if (CHALLENGE_MARKER.test(html) && text.length < 800) return 'a browser check'
  return null
}
