import dns from 'node:dns'
import { isIP } from 'node:net'
import { Agent, fetch as undiciFetch } from 'undici'
import type { HtmlFetch } from '../../packages/core/src/extract-core'

/**
 * SSRF-guarded fetching for the public contact endpoint. Everything the app or
 * the cron fetches was typed by us; the contact page fetches whatever an
 * anonymous visitor names, so "read my website" must never be able to read our
 * own network. IP-literal hosts are refused outright, every redirect hop is
 * re-checked, and the DNS answer is validated at socket-connect time - the
 * only place a check cannot be raced by a rebinding resolver.
 */

const MAX_REDIRECTS = 3

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number)
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0
}

function inRange(ip: number, base: string, maskBits: number): boolean {
  const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0
  return (ip & mask) === (ipv4ToInt(base) & mask)
}

// Loopback, RFC1918, link-local (incl. the cloud metadata address), CGNAT,
// and the odd corners nothing public lives in.
function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip)
  return (
    inRange(n, '0.0.0.0', 8) ||
    inRange(n, '10.0.0.0', 8) ||
    inRange(n, '100.64.0.0', 10) ||
    inRange(n, '127.0.0.0', 8) ||
    inRange(n, '169.254.0.0', 16) ||
    inRange(n, '172.16.0.0', 12) ||
    inRange(n, '192.0.0.0', 24) ||
    inRange(n, '192.168.0.0', 16) ||
    inRange(n, '198.18.0.0', 15) ||
    inRange(n, '224.0.0.0', 3)
  )
}

// Resolver answers arrive in canonical text form, so dotted-quad and
// compressed-hex spellings are already normalised by the time we look.
function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPrivateIpv4(address)
  if (family === 6) {
    const lower = address.toLowerCase()
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
    if (mapped) return isPrivateIpv4(mapped[1]!)
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb')
    )
  }
  return false
}

/**
 * A URL an anonymous visitor may have fetched: a public NAME on a default
 * port. IP-literal hosts are refused - no business hands out its website as an
 * address, and literal spellings (hex-compressed IPv6, mapped forms) are
 * exactly where string checks get bypassed.
 */
export function isSafePublicUrl(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.port !== '' && url.port !== '80' && url.port !== '443') return false
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  if (host.endsWith('.local') || host.endsWith('.internal')) return false
  if (isIP(host)) return false
  return host.includes('.')
}

/** normalizeUrl for visitor input: add https://, reject anything unsafe. */
export function parsePublicUrl(raw: string): URL | null {
  let candidate = raw.trim()
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`
  try {
    const url = new URL(candidate)
    return isSafePublicUrl(url) ? url : null
  } catch {
    return null
  }
}

// The socket-level lookup handed to undici. Validating here - at connect time,
// on the very answer the socket will dial - is what closes the DNS-rebinding
// gap a check-then-fetch sequence leaves open.
function safeLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number,
  ) => void,
): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, [])
    const list = addresses as dns.LookupAddress[]
    if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) {
      const blocked: NodeJS.ErrnoException = new Error(
        `Refusing to connect to ${hostname}: private address`,
      )
      blocked.code = 'ENOTFOUND'
      return callback(blocked, [])
    }
    if (options.all) return callback(null, list)
    const first = list[0]!
    callback(null, first.address, first.family)
  })
}

const guardedAgent = new Agent({ connect: { lookup: safeLookup } })

/**
 * Drop-in for the extractor's fetch, for visitor-supplied URLs. Redirects are
 * followed by hand (max 3 hops) so each hop's URL faces isSafePublicUrl before
 * anything connects to it; auto-follow would only name-check the first.
 */
export const guardedFetch: HtmlFetch = async (url, init) => {
  let current = new URL(url)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isSafePublicUrl(current)) {
      throw new Error(`${current.hostname} is not a public website address`)
    }
    const res = await undiciFetch(current.href, {
      dispatcher: guardedAgent,
      headers: init.headers,
      redirect: 'manual',
      signal: init.signal,
    })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return res as unknown as Response
      current = new URL(location, current)
      continue
    }
    return res as unknown as Response
  }
  throw new Error(`${current.hostname} redirected too many times`)
}
