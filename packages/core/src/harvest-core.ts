import { normalizeDomain } from './types'
import {
  detectChallenge,
  extractAnchors,
  fetchHtml,
  metaContent,
  normalizeUrl,
  pageTitle,
  stripToText,
  type HtmlFetch,
} from './html'

/**
 * Directory harvesting: given the member listing of a professional body (a
 * society's "find an accountant", an association's "find a builder"), pull out
 * the websites of the businesses listed there. The output is a list of
 * addresses ready for bulk import; nothing is contacted and nothing is stored
 * here.
 *
 * Two shapes of directory exist. Some link straight out to each member's
 * website from the listing; those links are collected directly. Others link to
 * a profile page per member on the directory's own site, with the website only
 * on the profile; a bounded number of those profiles are opened and read.
 */

/** Listing pages followed per directory: the start page plus "next" links. */
const MAX_LISTING_PAGES = 5
/** Member profile pages opened looking for a website link. */
const MAX_PROFILE_PAGES = 40
/** Profile fetches in flight at once. Directories are other people's servers. */
const PROFILE_CONCURRENCY = 4
/** Hard ceiling on results, so one giant directory cannot flood the batch. */
const MAX_SITES = 500

export interface HarvestedSite {
  url: string
  domain: string
  /** Best guess at the business name, from link text or the profile page. */
  name: string
  /** The directory page the website was found on. */
  foundOn: string
  /** Whether the link sat on the listing itself or needed a profile opened. */
  via: 'listing' | 'profile'
}

export interface HarvestResult {
  directoryUrl: string
  /** Businesses found, deduped by domain, in the order encountered. */
  sites: HarvestedSite[]
  /** Listing pages actually read (the start page plus pagination). */
  pagesFetched: string[]
  /** Member profile pages opened looking for a website link. */
  profilesFetched: number
  /** What was skipped or cut short, written for the person reading. */
  notes: string[]
}

/**
 * The owner-registered part of a hostname: `ballaratlaw.com.au` for
 * `www.portal.ballaratlaw.com.au`. Comparing registrable domains is what keeps
 * `members.society.org.au` recognised as the directory's own page rather than
 * a business. The two-level country suffixes we meet in practice are listed;
 * everything else is treated as a plain `name.tld`.
 */
const COUNTRY_SECOND_LEVEL = /^(com|net|org|edu|gov|asn|id|co|ac)$/
export function registrableDomain(host: string): string {
  const labels = normalizeDomain(host).split('.').filter(Boolean)
  if (labels.length <= 2) return labels.join('.')
  const take = COUNTRY_SECOND_LEVEL.test(labels[labels.length - 2]) ? 3 : 2
  return labels.slice(-take).join('.')
}

/**
 * External links that are never a member's own website: social profiles, the
 * platforms directories are built on, share buttons, app stores, government
 * registries. Matched on the registrable domain.
 */
const JUNK_DOMAINS = new Set([
  // Social and messaging
  'facebook.com',
  'fb.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'pinterest.com',
  'pinterest.com.au',
  'threads.net',
  'snapchat.com',
  'whatsapp.com',
  'wa.me',
  't.me',
  'reddit.com',
  'vimeo.com',
  'medium.com',
  // Search, maps and big platforms
  'google.com',
  'google.com.au',
  'goo.gl',
  'bing.com',
  'apple.com',
  'microsoft.com',
  'adobe.com',
  'wikipedia.org',
  'archive.org',
  // Booking, forms, payments and newsletters that directories link for you
  'eventbrite.com',
  'eventbrite.com.au',
  'trybooking.com',
  'humanitix.com',
  'surveymonkey.com',
  'typeform.com',
  'mailchimp.com',
  'eepurl.com',
  'calendly.com',
  'paypal.com',
  'stripe.com',
  'squareup.com',
  // Link shorteners and link-in-bio pages, not websites to research
  'bit.ly',
  'tinyurl.com',
  'ow.ly',
  'linktr.ee',
  // Web plumbing that leaks into href attributes
  'googleapis.com',
  'gstatic.com',
  'googletagmanager.com',
  'doubleclick.net',
  'cloudflare.com',
  'jsdelivr.net',
  'unpkg.com',
  'addtoany.com',
  'addthis.com',
  'sharethis.com',
  'browser-update.org',
])

function isJunkHost(host: string): boolean {
  const domain = normalizeDomain(host)
  // Government sites are registries and regulators, not businesses to pitch.
  if (/\.gov(\.[a-z]{2})?$/.test(domain)) return true
  return JUNK_DOMAINS.has(domain) || JUNK_DOMAINS.has(registrableDomain(domain))
}

/** Documents and media are not websites, whatever they are linked as. */
const FILE_PATH = /\.(pdf|jpe?g|png|gif|webp|svg|docx?|xlsx?|pptx?|zip|mp[34]|avi|mov)$/i

/** Link text that names the link, not the business behind it. */
const GENERIC_LINK_TEXT =
  /^(|-|website|web ?site|visit(( our| their)? website)?|view website|view|www|click here|here|read more|learn more|more( info(rmation)?)?|view profile|profile|details?|contact|email|link|external link|find out more|go to website|open)$/i

/** A hostname pretending to be a name is no name at all. */
function cleanName(text: string): string {
  const name = text.replace(/\s+/g, ' ').trim()
  if (name.length < 2 || name.length > 90) return ''
  if (GENERIC_LINK_TEXT.test(name)) return ''
  if (/^(https?:\/\/|www\.)/i.test(name)) return ''
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(name)) return ''
  return name
}

/**
 * Paths that read like one member's page on the directory itself. Kept broad
 * on purpose: a wrong guess costs one wasted fetch, a missed one costs a lead.
 */
const PROFILE_PATH_HINT =
  /(member|profile|listing|directory|business(es)?|company|companies|firm|practice|practitioner|provider|operator|supplier|tutor|teacher|school|studio|club|agent|accountant|builder|lawyer|solicitor)(s)?([/_-]|$)|\/(view|show|detail)s?\//i

/** Pagination links, so page 2 of the same listing is not read as a profile. */
const PAGINATION_PATH = /[?&](page|p|pg|start|offset|per_page)=|\/page\/\d+/i

function stripTracking(url: URL): string {
  const params = new URLSearchParams()
  for (const [key, value] of url.searchParams) {
    if (!/^(utm_|fbclid|gclid|mc_|ref$)/i.test(key)) params.append(key, value)
  }
  const query = params.toString()
  return `${url.origin}${url.pathname}${query ? `?${query}` : ''}`
}

/**
 * The next listing page, from rel="next" or a link that just says "Next".
 * Returns null when there is none, which is how the listing loop ends.
 */
function findNextPage(html: string, currentUrl: URL, seen: Set<string>): string | null {
  const candidates: string[] = []
  for (const m of html.matchAll(/<(?:a|link)\b[^>]*\brel=["']next["'][^>]*>/gi)) {
    const href = m[0].match(/href=["']([^"'#]+)["']/i)
    if (href) candidates.push(href[1])
  }
  for (const m of html.matchAll(/<a\b([^>]+)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1]
    const text = stripToText(m[2])
    const label = attrs.match(/aria-label=["']([^"']*)["']/i)?.[1] ?? ''
    if (/^next( page)?$/i.test(text) || /^next( page)?$/i.test(label.trim())) {
      const href = attrs.match(/href=["']([^"'#]+)["']/i)
      if (href) candidates.push(href[1])
    }
  }
  for (const raw of candidates) {
    try {
      const next = new URL(raw, currentUrl)
      if (next.host !== currentUrl.host) continue
      const href = next.href.split('#')[0]
      if (!seen.has(href)) return href
    } catch {}
  }
  return null
}

interface AnchorScan {
  /** External links that could be businesses, in page order. */
  external: { url: URL; name: string }[]
  /** Same-directory links that read like member profiles. */
  profiles: { href: string; nameHint: string }[]
}

function scanAnchors(html: string, pageUrl: URL, directoryApex: string): AnchorScan {
  const external: AnchorScan['external'] = []
  const profiles: AnchorScan['profiles'] = []
  const seenProfiles = new Set<string>()
  for (const anchor of extractAnchors(html, 3000)) {
    if (/^(mailto|tel|javascript):/i.test(anchor.href)) continue
    let url: URL
    try {
      url = new URL(anchor.href, pageUrl)
    } catch {
      continue
    }
    if (!/^https?:$/.test(url.protocol)) continue
    if (FILE_PATH.test(url.pathname)) continue
    if (registrableDomain(url.host) === directoryApex) {
      const href = url.href.split('#')[0]
      if (
        PROFILE_PATH_HINT.test(url.pathname) &&
        !PAGINATION_PATH.test(url.pathname + url.search) &&
        url.pathname !== pageUrl.pathname &&
        !seenProfiles.has(href)
      ) {
        seenProfiles.add(href)
        profiles.push({ href, nameHint: cleanName(anchor.text) })
      }
    } else if (!isJunkHost(url.host)) {
      external.push({ url, name: cleanName(anchor.text) })
    }
  }
  return { external, profiles }
}

/** The member's own website, picked from the external links on their profile. */
function pickProfileWebsite(
  scan: AnchorScan,
  html: string,
): { url: URL; name: string } | null {
  if (scan.external.length === 0) return null
  // An anchor announced as the website wins. Failing that, an anchor whose
  // visible text is the address itself, the way directories print URLs.
  for (const m of html.matchAll(
    /<a\b[^>]*href=["'](https?:\/\/[^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const text = stripToText(m[2])
    if (!/^(visit )?(their |our )?web ?site$|^www\.|^https?:\/\//i.test(text)) continue
    try {
      const url = new URL(m[1])
      if (!isJunkHost(url.host)) return { url, name: '' }
    } catch {}
  }
  // Otherwise trust the page only when it points at exactly one outside
  // domain; more than one and the guess is as likely a sponsor as the member.
  const domains = new Set(scan.external.map((e) => registrableDomain(e.url.host)))
  if (domains.size === 1) return scan.external[0]
  return null
}

export async function harvestDirectory(
  rawUrl: string,
  fetchImpl: HtmlFetch = fetch,
): Promise<HarvestResult> {
  const startUrl = normalizeUrl(rawUrl)
  const directoryApex = registrableDomain(startUrl.host)
  const sites = new Map<string, HarvestedSite>()
  const notes: string[] = []
  const pagesFetched: string[] = []
  const profileQueue: { href: string; nameHint: string; foundOn: string }[] = []
  const queuedProfiles = new Set<string>()

  const add = (url: URL, name: string, foundOn: string, via: HarvestedSite['via']) => {
    const domain = normalizeDomain(url.host)
    if (sites.size >= MAX_SITES || sites.has(domain)) return
    sites.set(domain, { url: stripTracking(url), domain, name, foundOn, via })
  }

  // Walk the listing and its pagination.
  const seenPages = new Set<string>([startUrl.href.split('#')[0]])
  let pageHref: string | null = startUrl.href
  while (pageHref && pagesFetched.length < MAX_LISTING_PAGES) {
    const outcome = await fetchHtml(pageHref, fetchImpl)
    if (!outcome.ok) {
      if (pagesFetched.length === 0) {
        throw new Error(`Could not fetch ${pageHref} - ${outcome.reason}.`)
      }
      notes.push(`Stopped at ${pageHref} - ${outcome.reason}.`)
      break
    }
    const html = outcome.html
    const challenge = detectChallenge(html, pageTitle(html), stripToText(html))
    if (challenge) {
      if (pagesFetched.length === 0) {
        throw new Error(
          `${new URL(pageHref).host} served a bot check (${challenge}) instead of the directory. Automated readers are blocked here - open it in a browser and paste the member websites into bulk import instead.`,
        )
      }
      notes.push(`Stopped at ${pageHref} - it served a bot check.`)
      break
    }
    pagesFetched.push(pageHref)
    const pageUrl = new URL(pageHref)
    const scan = scanAnchors(html, pageUrl, directoryApex)
    for (const found of scan.external) add(found.url, found.name, pageHref, 'listing')
    for (const profile of scan.profiles) {
      if (queuedProfiles.has(profile.href)) continue
      queuedProfiles.add(profile.href)
      if (profileQueue.length < MAX_PROFILE_PAGES) {
        profileQueue.push({ ...profile, foundOn: pageHref })
      }
    }
    pageHref = findNextPage(html, pageUrl, seenPages)
    if (pageHref) seenPages.add(pageHref)
  }
  if (pageHref && pagesFetched.length >= MAX_LISTING_PAGES) {
    notes.push(
      `Stopped after ${MAX_LISTING_PAGES} listing pages; paste ${pageHref} to continue from there.`,
    )
  }

  // Open member profiles for directories that keep the website one click in.
  // Skipped when the listing already linked straight out to plenty of sites,
  // because then the profiles would mostly repeat what is already in hand.
  let profilesFetched = 0
  const shouldOpenProfiles =
    profileQueue.length > 0 && sites.size < Math.max(10, profileQueue.length)
  if (shouldOpenProfiles) {
    const queue = [...profileQueue]
    await Promise.all(
      Array.from({ length: PROFILE_CONCURRENCY }, async () => {
        while (queue.length > 0 && sites.size < MAX_SITES) {
          const profile = queue.shift()
          if (!profile) break
          const outcome = await fetchHtml(profile.href, fetchImpl)
          if (!outcome.ok) continue
          const html = outcome.html
          if (detectChallenge(html, pageTitle(html), stripToText(html))) continue
          profilesFetched++
          const scan = scanAnchors(html, new URL(profile.href), directoryApex)
          const picked = pickProfileWebsite(scan, html)
          if (!picked) continue
          const heading = stripToText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '')
          const name =
            profile.nameHint ||
            cleanName(heading) ||
            cleanName(metaContent(html, 'og:title')) ||
            picked.name
          add(picked.url, name, profile.href, 'profile')
        }
      }),
    )
    if (queuedProfiles.size > MAX_PROFILE_PAGES) {
      notes.push(
        `The listing links to ${queuedProfiles.size} member profiles; the first ${MAX_PROFILE_PAGES} were opened. Run it again on later pages of the listing for the rest.`,
      )
    }
  }

  if (sites.size === 0) {
    notes.push(
      'No outside websites were found. Directories that draw their results with JavaScript look empty to this reader - open the directory in a browser and paste the page that lists members as plain links, or add the websites to bulk import by hand.',
    )
  }

  return {
    directoryUrl: startUrl.href,
    sites: [...sites.values()],
    pagesFetched,
    profilesFetched,
    notes,
  }
}
