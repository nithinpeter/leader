/**
 * The branded shell every outreach email ships in. The drafts stay plain text
 * ending at "Thanks," — this module adds the identity underneath: the
 * Westringia lockup, contact details, the OpenAI Select Partner badge, and the
 * opt-out line the Spam Act requires. No person's name appears; the footer
 * identifies the business.
 *
 * The artwork is served by the website (westringia repo, public/brand/email/)
 * as PNG, because email clients will not render SVG. Per the badge rules the
 * OpenAI badge is never locked up with our mark, so it sits apart, under the
 * contact details.
 */

const SITE = 'https://westringia.com'
const LOCKUP_IMG = `${SITE}/brand/email/westringia-lockup.png`
const BADGE_IMG = `${SITE}/brand/email/openai-select-partner.png`

const PHONE = '02 8531 8610'
const PHONE_HREF = 'tel:+61285318610'
const MAILBOX = 'hello@westringia.com'
const REGION = 'Sydney, New South Wales'

export const OPT_OUT_LINE =
  "If you'd rather not hear from us, just reply and say so. That's the last you'll get."

// Palette lifted from the website (westringia repo, src/styles/global.css).
const INK = '#1C1B18'
const INK_2 = '#55534C'
const INK_3 = '#6E6C63'
const RULE = '#DEDCD2'
const SAGE_DEEP = '#3F4F38'

const FONT_STACK =
  "'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"

/**
 * The footer for the plain-text alternative, and for clients that block
 * images. Same facts as the HTML footer, nothing more.
 */
export function textFooter(): string {
  return [
    `Westringia Labs · ${REGION}`,
    `${PHONE} · westringia.com · ${MAILBOX}`,
    'OpenAI Select Partner',
    '',
    OPT_OUT_LINE,
  ].join('\n')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Blank lines separate paragraphs, single newlines stay as line breaks, so the
 * HTML reads exactly like the plain text the draft was approved as.
 */
function bodyToHtml(body: string): string {
  return body
    .trim()
    .split(/\n{2,}/)
    .map(
      (para) =>
        `<p style="margin:0 0 16px 0;">${escapeHtml(para.trim()).replace(/\n/g, '<br />')}</p>`,
    )
    .join('\n      ')
}

/**
 * Wraps a plain-text body in the branded HTML email. Deliberately quiet: the
 * body renders as an ordinary personal email, and the polish lives in the
 * footer.
 */
export function renderOutreachHtml(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
</head>
<body style="margin:0; padding:0; background-color:#ffffff;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;">
    <tr>
      <td align="left" style="padding:24px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%;">
          <tr>
            <td style="font-family:${FONT_STACK}; font-size:15px; line-height:1.65; color:${INK};">
      ${bodyToHtml(body)}
            </td>
          </tr>
          <tr>
            <td style="padding-top:20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border-top:1px solid ${RULE}; padding-top:22px;">
                    <a href="${SITE}" style="text-decoration:none;">
                      <img src="${LOCKUP_IMG}" alt="Westringia Labs" width="168" height="20" style="display:block; border:0; width:168px; height:auto;" />
                    </a>
                    <p style="margin:14px 0 0 0; font-family:${FONT_STACK}; font-size:13px; line-height:1.6; color:${INK_2};">
                      ${REGION}<br />
                      <a href="${PHONE_HREF}" style="color:${INK_2}; text-decoration:none;">${PHONE}</a>
                      &nbsp;&middot;&nbsp;
                      <a href="${SITE}" style="color:${SAGE_DEEP}; text-decoration:underline;">westringia.com</a>
                      &nbsp;&middot;&nbsp;
                      <a href="mailto:${MAILBOX}" style="color:${SAGE_DEEP}; text-decoration:underline;">${MAILBOX}</a>
                    </p>
                    <a href="${SITE}/openai-select-partner" style="text-decoration:none;">
                      <img src="${BADGE_IMG}" alt="OpenAI Select Partner" width="160" height="74" style="display:block; border:0; margin-top:18px; width:160px; height:auto;" />
                    </a>
                    <p style="margin:18px 0 0 0; font-family:${FONT_STACK}; font-size:12px; line-height:1.6; color:${INK_3};">
                      ${escapeHtml(OPT_OUT_LINE)}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
