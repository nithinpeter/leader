import { Resolver } from 'node:dns/promises'
import type { EmailCheck } from './types'

/**
 * Decides whether an address is worth spending a send on, without contacting
 * the recipient and without telling them anything happened.
 *
 * The addresses outreach uses are scraped off websites, and a good share of
 * what a crawler finds is not a mailbox: a `noreply@`, the placeholder the
 * theme shipped with, or a filename the address regex matched. Mail to those
 * hard bounces, and a run of hard bounces is the single fastest way to lose a
 * sending domain. Providers read it as a list the sender did not build, which
 * is exactly what it is. One bounce costs more reputation than the email would
 * ever have earned back, so the cheap checks below are worth doing every time.
 *
 * What this deliberately does NOT do is open an SMTP session and probe the
 * recipient with RCPT TO. That is the only way to learn whether a particular
 * mailbox exists, and it is unavailable here twice over: Google Cloud blocks
 * outbound port 25 from Cloud Functions, so the call cannot leave, and most
 * business mail sits behind Google or Microsoft, who answer "yes" to every
 * probe anyway. If you want per-mailbox certainty later it has to come from a
 * verification API over HTTPS; drop it in behind `verifyEmailAddress` and the
 * rest of the cycle needs no changes.
 */

/** DNS lookups are the slow part. Bound them, or a dead resolver stalls a run. */
const resolver = new Resolver({ timeout: 5_000, tries: 2 })

/**
 * Local parts that are a mailbox in the technical sense and never a reader.
 * `info@`, `hello@` and `admin@` are absent on purpose: for a ten-person trade
 * business that IS the owner's inbox, and dropping them would drop most of the
 * pipeline.
 */
const NEVER_READ = new Set([
  'noreply',
  'no-reply',
  'no_reply',
  'donotreply',
  'do-not-reply',
  'do_not_reply',
  'mailer-daemon',
  'postmaster',
  'abuse',
  'bounce',
  'bounces',
  'unsubscribe',
  'listserv',
  'majordomo',
])

/**
 * Domains that only ever appear in template copy a site never finished
 * editing, or in third-party markup the crawler walked over. Every one of
 * these has turned up in a real scrape.
 */
const PLACEHOLDER_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'example.co.uk',
  'domain.com',
  'yourdomain.com',
  'your-domain.com',
  'yourcompany.com',
  'yoursite.com',
  'yourwebsite.com',
  'mysite.com',
  'website.com',
  'sentry.io',
  'wixpress.com',
  'w3.org',
  'schema.org',
  'localhost',
  'test',
  'invalid',
])

/**
 * The extractor's address regex happily matches `logo@2x.png` and
 * `sprite@3x.svg`. The MX check below would reject them a second later, but
 * naming the real reason costs nothing and keeps DNS out of it.
 */
const FILE_SUFFIX =
  /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|css|js|mjs|cjs|json|html?|php|aspx?|pdf|mp[34]|webm|woff2?|ttf|otf|eot|zip)$/i

/** Practical, not RFC 5322. Anything this rejects, a mail server would too. */
const SYNTAX = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i

function undeliverable(address: string, reason: string): EmailCheck {
  return { address, result: 'undeliverable', reason, checkedAt: new Date().toISOString() }
}

function deliverable(address: string, reason: string): EmailCheck {
  return { address, result: 'deliverable', reason, checkedAt: new Date().toISOString() }
}

function unknown(address: string, reason: string): EmailCheck {
  return { address, result: 'unknown', reason, checkedAt: new Date().toISOString() }
}

type DomainVerdict = { accepts: boolean | null; reason: string }

/**
 * One lookup per domain per process. Cloud Functions reuses a warm instance
 * across runs, so this also spares the resolver the same hundred domains every
 * thirty minutes.
 */
const domainCache = new Map<string, Promise<DomainVerdict>>()

/**
 * Whether a domain accepts mail at all. `null` means we could not find out,
 * which is not the same as "no" and must never be recorded as one.
 *
 * A domain with no MX record is still deliverable if it has an address record:
 * RFC 5321 says fall back to A/AAAA, and plenty of small business domains rely
 * on exactly that. A single MX pointing at the root (RFC 7505's "null MX") is
 * the opposite - an explicit statement that this domain receives no mail.
 */
function domainAcceptsMail(domain: string): Promise<DomainVerdict> {
  const cached = domainCache.get(domain)
  if (cached) return cached

  const lookup = (async (): Promise<DomainVerdict> => {
    try {
      const mx = await resolver.resolveMx(domain)
      const hosts = mx.filter((r) => r.exchange && r.exchange !== '.')
      if (hosts.length) return { accepts: true, reason: `MX ${hosts[0].exchange}` }
      // Records exist but all of them are null MX.
      return { accepts: false, reason: `${domain} publishes a null MX: it accepts no mail` }
    } catch (e) {
      const code = (e as { code?: string })?.code
      if (code === 'ENOTFOUND' || code === 'EBADNAME') {
        return { accepts: false, reason: `the domain ${domain} does not exist` }
      }
      if (code !== 'ENODATA') {
        // SERVFAIL, timeout, refused. Our problem, not the address's.
        return { accepts: null, reason: `DNS lookup for ${domain} failed (${code ?? 'unknown'})` }
      }
    }

    // ENODATA: no MX records. Fall back to the address record.
    try {
      const a = await resolver.resolve4(domain)
      if (a.length) return { accepts: true, reason: `no MX, falling back to A ${a[0]}` }
    } catch (e) {
      const code = (e as { code?: string })?.code
      if (code !== 'ENOTFOUND' && code !== 'ENODATA') {
        return { accepts: null, reason: `DNS lookup for ${domain} failed (${code ?? 'unknown'})` }
      }
    }

    return { accepts: false, reason: `${domain} has no MX and no address record` }
  })()

  // A cap, because this map lives as long as the instance does.
  if (domainCache.size > 500) domainCache.clear()
  domainCache.set(domain, lookup)
  return lookup
}

/**
 * The pre-send check. Three outcomes rather than two, and the difference
 * matters: `undeliverable` is structural and will be just as wrong next run,
 * while `unknown` means the check itself failed and the address deserves
 * another go later.
 */
export async function verifyEmailAddress(input: string): Promise<EmailCheck> {
  const address = input.trim().toLowerCase()

  if (!address) return undeliverable(address, 'no address')
  if (address.length > 254) return undeliverable(address, 'longer than an address may be')
  if (!SYNTAX.test(address) || address.includes('..')) {
    return undeliverable(address, 'not a valid address')
  }

  const at = address.lastIndexOf('@')
  const local = address.slice(0, at)
  const domain = address.slice(at + 1)

  if (local.startsWith('.') || local.endsWith('.')) {
    return undeliverable(address, 'not a valid address')
  }
  if (FILE_SUFFIX.test(domain)) {
    return undeliverable(address, 'a filename the crawler read as an address')
  }
  if (NEVER_READ.has(local)) {
    return undeliverable(address, `${local}@ is not read by a person`)
  }
  if (PLACEHOLDER_DOMAINS.has(domain)) {
    return undeliverable(address, `${domain} is placeholder copy, not their real address`)
  }

  const verdict = await domainAcceptsMail(domain)
  if (verdict.accepts === null) return unknown(address, verdict.reason)
  if (!verdict.accepts) return undeliverable(address, verdict.reason)
  return deliverable(address, verdict.reason)
}
