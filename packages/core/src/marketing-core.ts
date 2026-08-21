/**
 * The marketing pipeline's domain code: the post model, LinkedIn's text
 * rules, and the call that publishes to the company page.
 *
 * Posts live in Firestore (`marketing_posts`, with card PNGs in
 * `marketing_cards`) and are created, reviewed and approved in the app —
 * see apps/web/src/lib/marketing.ts for the store. This module holds only
 * what is shared between that store and the server function that publishes:
 * the types, the escaping, and the network call. Status moves
 * draft → approved → posted, and only ever forward; posted is final.
 *
 * The westringia repo's docs/social directory holds the collateral posted
 * before the pipeline moved here, as a closed archive. Nothing reads it.
 */

export type MarketingPostStatus = 'draft' | 'approved' | 'posted'

export interface MarketingPost {
  id: string
  title: string
  /** The exact post text, published verbatim (after Little Text escaping). */
  body: string
  /** Alt text for the card; null for a text-only post. */
  imageAlt: string | null
  /** Whether a card PNG exists in marketing_cards/{id}. */
  hasImage: boolean
  status: MarketingPostStatus
  createdAt: string
  updatedAt: string
  postedAt: string | null
  postUrn: string | null
}

export const LINKEDIN_COMMENTARY_LIMIT = 3000

const API = 'https://api.linkedin.com'

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
 * LinkedIn's commentary field is "Little Text Format": these characters are
 * control characters unless escaped. Unescaped parentheses have mangled many
 * a first post from an automation like this one.
 */
export function escapeLittleText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => '\\' + c)
}

async function apiError(res: Response, doing: string) {
  return new Error(`${doing} failed: HTTP ${res.status} — ${await res.text()}`)
}

/**
 * Post text (and optionally one image, as a buffer) to the company page.
 * Pure network — no store access. Returns { urn, url }.
 */
export async function postToLinkedIn(
  { body, image = null, imageAlt = null }: { body: string; image?: Buffer | null; imageAlt?: string | null },
  cfg: LinkedinConfig,
): Promise<{ urn: string; url: string }> {
  if (!body) throw new Error('Empty post body.')
  if (!cfg.token || !cfg.orgId) throw new Error('No LinkedIn credentials configured.')

  const commentary = escapeLittleText(body)
  if (commentary.length > LINKEDIN_COMMENTARY_LIMIT) {
    throw new Error(
      `Commentary is ${commentary.length} characters after escaping; LinkedIn's limit is ${LINKEDIN_COMMENTARY_LIMIT.toLocaleString()}.`,
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
