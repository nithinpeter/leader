/**
 * The marketing pipeline: the LinkedIn queue and the calls that publish it.
 *
 * Moved here from the westringia repo (tools/linkedin-lib.mjs and
 * src/admin/store.ts there). The already-generated collateral did not move:
 * queue files still live in the westringia repo at docs/social/queue
 * (frontmatter: title, image, image_alt, status; body: the exact post text)
 * with their card PNGs in docs/social/images. This module reads and writes
 * them through the GitHub contents API, so every approve and publish stays a
 * real commit on the westringia deploy branch and git stays the posting log.
 *
 * Status moves draft → approved → posted, and only ever forward.
 *
 * With no GitHub token configured, the store falls back to a local westringia
 * checkout on disk (WESTRINGIA_CHECKOUT, default ../westringia), where the
 * same changes show up in `git status` instead of as commits.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, basename, resolve } from 'node:path'

const API = 'https://api.linkedin.com'
const QUEUE_DIR = 'docs/social/queue'
const IMAGE_DIR = 'docs/social/images'

// ---------- Configuration (environment only; no config file here) ----------

const env = (name: string, fallback = '') => process.env[name] || fallback

export function linkedinConfig() {
  return {
    token: env('LINKEDIN_ACCESS_TOKEN'),
    orgId: env('LINKEDIN_ORG_ID'),
    version: env('LINKEDIN_VERSION', '202506'),
  }
}

export type LinkedinConfig = ReturnType<typeof linkedinConfig>

/**
 * GitHub is the store: a fine-grained PAT for the westringia repo only,
 * Contents read + write. MARKETING_GITHUB_TOKEN is read before GITHUB_TOKEN
 * because dev machines sometimes carry a GITHUB_TOKEN of their own that has
 * nothing to do with that repo.
 */
export function githubConfig() {
  return {
    token: env('MARKETING_GITHUB_TOKEN', env('GITHUB_TOKEN')),
    repo: env('MARKETING_GITHUB_REPO', 'nithinpeter/westringia'),
    branch: env('MARKETING_GITHUB_BRANCH', 'main'),
  }
}

/** Where a local westringia checkout lives, for the no-token dev fallback. */
function localRoot(): string {
  return resolve(env('WESTRINGIA_CHECKOUT', '../westringia'))
}

export function storeMode(): 'github' | 'local' {
  const forced = process.env.MARKETING_STORE
  if (forced === 'local' || forced === 'github') return forced
  return githubConfig().token ? 'github' : 'local'
}

// ---------- Queue files as text ----------

export interface QueuePost {
  file: string
  title: string
  status: string
  /** Bare image filename (the PNG in docs/social/images), or null for text-only. */
  image: string | null
  image_alt: string | null
  posted_at: string | null
  post_urn: string | null
  body: string
  /** Character count after Little Text escaping — LinkedIn's limit is 3,000. */
  chars: number
}

export function parseQueueText(raw: string, name = 'queue file') {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) throw new Error(`${name}: no frontmatter block found.`)
  const meta: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { meta, body: m[2].trim(), raw }
}

/** Move between draft and approved. Posted is terminal — refuse to touch it. */
export function setStatusText(raw: string, to: string, name = 'queue file') {
  const { meta } = parseQueueText(raw, name)
  if (meta.status === 'posted') throw new Error('Already posted; status is final.')
  if (!['draft', 'approved'].includes(to)) throw new Error(`Cannot set status to "${to}".`)
  return raw.replace(/^status:.*$/m, `status: ${to}`)
}

export function stampPostedText(raw: string, urn: string) {
  return raw.replace(
    /^status:.*$/m,
    `status: posted\nposted_at: ${new Date().toISOString()}\npost_urn: ${urn}`,
  )
}

/**
 * LinkedIn's commentary field is "Little Text Format": these characters are
 * control characters unless escaped. Unescaped parentheses have mangled many
 * a first post from an automation like this one.
 */
export function escapeLittleText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => '\\' + c)
}

// ---------- The store ----------

/** The only place a client-supplied name is accepted: strip paths, allowlist extension. */
function safeName(name: string, ext: string): string {
  const safe = basename(String(name ?? ''))
  if (!safe.endsWith(ext)) throw new Error(`Not a ${ext} file.`)
  return safe
}

async function gh(path: string, init: RequestInit = {}): Promise<any> {
  const { token, repo } = githubConfig()
  const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  if (!res.ok) {
    throw new Error(
      `GitHub ${init.method ?? 'GET'} ${path} failed: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`,
    )
  }
  return res.json()
}

export async function listQueueNames(): Promise<string[]> {
  if (storeMode() === 'local') {
    return readdirSync(join(localRoot(), QUEUE_DIR))
      .filter((f) => f.endsWith('.md'))
      .sort()
  }
  const { branch } = githubConfig()
  const entries = (await gh(`contents/${QUEUE_DIR}?ref=${branch}`)) as Array<{ name: string }>
  return entries.map((e) => e.name).filter((n) => n.endsWith('.md')).sort()
}

/** sha is null in local mode, and required to write back in GitHub mode. */
export async function readQueueFile(
  name: string,
): Promise<{ name: string; text: string; sha: string | null }> {
  const file = safeName(name, '.md')
  if (storeMode() === 'local') {
    return { name: file, text: readFileSync(join(localRoot(), QUEUE_DIR, file), 'utf8'), sha: null }
  }
  const { branch } = githubConfig()
  const data = await gh(`contents/${QUEUE_DIR}/${file}?ref=${branch}`)
  return { name: file, text: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha }
}

export async function writeQueueFile(
  name: string,
  text: string,
  sha: string | null,
  message: string,
): Promise<void> {
  const file = safeName(name, '.md')
  if (storeMode() === 'local') {
    writeFileSync(join(localRoot(), QUEUE_DIR, file), text)
    return
  }
  const { branch } = githubConfig()
  await gh(`contents/${QUEUE_DIR}/${file}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: Buffer.from(text).toString('base64'),
      sha,
      branch,
    }),
  })
}

export async function readImage(name: string): Promise<Buffer> {
  const file = safeName(name, '.png')
  if (storeMode() === 'local') {
    return readFileSync(join(localRoot(), IMAGE_DIR, file))
  }
  const { branch } = githubConfig()
  const data = await gh(`contents/${IMAGE_DIR}/${file}?ref=${branch}`)
  return Buffer.from(data.content, 'base64')
}

/** Every queue file, parsed and ready for the review UI. */
export async function listQueuePosts(): Promise<QueuePost[]> {
  const names = await listQueueNames()
  return Promise.all(
    names.map(async (name) => {
      const { text } = await readQueueFile(name)
      const { meta, body } = parseQueueText(text, name)
      return {
        file: name,
        title: meta.title ?? name,
        status: meta.status ?? 'draft',
        image: meta.image ? (meta.image.split('/').pop() ?? null) : null,
        image_alt: meta.image_alt ?? null,
        posted_at: meta.posted_at ?? null,
        post_urn: meta.post_urn ?? null,
        body,
        chars: escapeLittleText(body).length,
      }
    }),
  )
}

// ---------- The LinkedIn calls ----------

async function apiError(res: Response, doing: string) {
  return new Error(`${doing} failed: HTTP ${res.status} — ${await res.text()}`)
}

/**
 * Post text (and optionally one image, as a buffer) to the company page.
 * Pure network — no filesystem. Returns { urn, url }.
 */
export async function postToLinkedIn(
  { body, image = null, imageAlt = null }: { body: string; image?: Buffer | null; imageAlt?: string | null },
  cfg: LinkedinConfig,
): Promise<{ urn: string; url: string }> {
  if (!body) throw new Error('Empty post body.')
  if (!cfg.token || !cfg.orgId) throw new Error('No LinkedIn credentials configured.')

  const commentary = escapeLittleText(body)
  if (commentary.length > 3000) {
    throw new Error(
      `Commentary is ${commentary.length} characters after escaping; LinkedIn's limit is 3,000.`,
    )
  }

  const author = `urn:li:organization:${cfg.orgId}`
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    'LinkedIn-Version': cfg.version,
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json',
  }

  const payload: Record<string, unknown> = {
    author,
    commentary,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  }

  if (image) {
    const init = await fetch(`${API}/rest/images?action=initializeUpload`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
    })
    if (!init.ok) throw await apiError(init, 'Image upload initialization')
    const { value } = (await init.json()) as { value: { uploadUrl: string; image: string } }

    const put = await fetch(value.uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${cfg.token}` },
      body: new Uint8Array(image),
    })
    if (!put.ok) throw await apiError(put, 'Image binary upload')

    const media: Record<string, unknown> = { id: value.image }
    if (imageAlt) media.altText = imageAlt
    payload.content = { media }
  }

  const res = await fetch(`${API}/rest/posts`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw await apiError(res, 'Post creation')
  const urn = res.headers.get('x-restli-id') ?? ''
  return { urn, url: `https://www.linkedin.com/feed/update/${urn}/` }
}

/**
 * Publish one approved queue file and mark it posted in the store.
 * The same rules as always: only status: approved posts, posted is final.
 */
export async function publishQueueFile(
  file: string,
  cfg: LinkedinConfig = linkedinConfig(),
): Promise<{ urn: string; url: string }> {
  const { name, text, sha } = await readQueueFile(file)
  const { meta, body, raw } = parseQueueText(text, name)

  if (meta.status === 'posted') {
    throw new Error(`Already posted ${meta.posted_at ?? ''} (${meta.post_urn ?? 'no URN recorded'}).`)
  }
  if (meta.status !== 'approved') {
    throw new Error(`Status is "${meta.status}", not "approved" — review it first.`)
  }

  const image = meta.image ? await readImage(meta.image.split('/').pop()!) : null
  const result = await postToLinkedIn({ body, image, imageAlt: meta.image_alt ?? null }, cfg)

  // The post is live from here. If this write fails, the caller still gets
  // the URN, so the record can be fixed by hand.
  await writeQueueFile(name, stampPostedText(raw, result.urn), sha, `Mark ${name} as posted (${result.urn})`)
  return result
}
