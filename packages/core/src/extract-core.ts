import { normalizeDomain, type SiteExtraction } from './types'
import {
  decodeEntities,
  detectChallenge,
  extractAnchors,
  fetchHtml,
  metaContent,
  normalizeUrl,
  pageTitle,
  stripToText,
  type HtmlFetch,
} from './html'

const MAX_SUBPAGES = 3

// Re-exported because the Cloud Functions import it from here; the definition
// moved to html.ts when directory harvesting started sharing the fetch code.
export type { HtmlFetch } from './html'

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

    const title = pageTitle(html)

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

    const domain = normalizeDomain(baseUrl.host)
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
