#!/usr/bin/env node
/**
 * Mint (or refresh) the LinkedIn access token the posting workflow uses.
 * Run this locally, as an admin of the company page. One time, then again
 * whenever the token expires.
 *
 *   LINKEDIN_CLIENT_ID=… LINKEDIN_CLIENT_SECRET=… node tools/linkedin-auth.mjs
 *   LINKEDIN_CLIENT_ID=… LINKEDIN_CLIENT_SECRET=… node tools/linkedin-auth.mjs --refresh <refresh_token>
 *
 * What it does: opens a local callback server on port 8917, prints the
 * LinkedIn consent URL for you to open in a browser, exchanges the returned
 * code for tokens, and prints what to paste into the repository secrets.
 * Nothing is written to disk.
 *
 * The redirect URL http://localhost:8917/callback must be registered on the
 * app under Auth → Authorized redirect URLs, exactly.
 */

import { createServer } from 'node:http';

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET (from the app page on developer.linkedin.com).');
  process.exit(1);
}

const PORT = 8917;
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPES = 'w_organization_social r_organization_social';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';

async function exchange(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    console.error('Token request failed:', JSON.stringify(data, null, 2));
    process.exit(1);
  }
  return data;
}

function print(data) {
  const days = (s) => Math.round(s / 86400);
  console.log('\nSet these where Leader runs (deploy env vars, or the repo-root .env for dev):\n');
  console.log(`  LINKEDIN_ACCESS_TOKEN = ${data.access_token}`);
  console.log(`\n  (expires in ~${days(data.expires_in)} days — diarise the refresh)`);
  if (data.refresh_token) {
    console.log(`\n  refresh token, keep somewhere safe, NOT a repo secret: ${data.refresh_token}`);
    console.log(`  (refresh works for ~${days(data.refresh_token_expires_in ?? 0)} days, via --refresh)`);
  } else {
    console.log('\n  No refresh token returned — this app is not enabled for programmatic');
    console.log('  refresh, so re-run this script when the token expires.');
  }
}

// ---------- Refresh mode ----------

const ri = process.argv.indexOf('--refresh');
if (ri !== -1) {
  const refreshToken = process.argv[ri + 1];
  if (!refreshToken) {
    console.error('usage: node tools/linkedin-auth.mjs --refresh <refresh_token>');
    process.exit(1);
  }
  print(await exchange({ grant_type: 'refresh_token', refresh_token: refreshToken }));
  process.exit(0);
}

// ---------- First-time authorisation ----------

const state = Math.random().toString(36).slice(2);
const authUrl =
  'https://www.linkedin.com/oauth/v2/authorization?' +
  new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT, state, scope: SCOPES });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  if (url.searchParams.get('state') !== state) {
    res.end('State mismatch - closing.');
    console.error('State mismatch; try again.');
    process.exit(1);
  }
  const error = url.searchParams.get('error');
  if (error) {
    res.end(`LinkedIn said: ${error}. You can close this tab.`);
    console.error('Authorisation refused:', error, url.searchParams.get('error_description'));
    process.exit(1);
  }
  res.end('Done - back to the terminal. You can close this tab.');
  server.close();

  const data = await exchange({
    grant_type: 'authorization_code',
    code: url.searchParams.get('code'),
    redirect_uri: REDIRECT,
  });
  print(data);

  // Best effort: list the organisations this member administers, so the
  // numeric id for LINKEDIN_ORG_ID does not have to be dug out of a URL.
  try {
    const acl = await fetch(
      'https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED',
      { headers: { Authorization: `Bearer ${data.access_token}`, 'LinkedIn-Version': process.env.LINKEDIN_VERSION ?? '202506', 'X-Restli-Protocol-Version': '2.0.0' } },
    );
    const orgs = (await acl.json()).elements ?? [];
    if (orgs.length) {
      console.log('\nOrganisations you administer (LINKEDIN_ORG_ID is the number):');
      for (const o of orgs) console.log(`  ${o.organization}`);
    }
  } catch {
    console.log('\nCould not list organisations - read LINKEDIN_ORG_ID from the page admin URL instead:');
    console.log('  linkedin.com/company/<number>/admin/ - the number is the id.');
  }
});

server.listen(PORT, () => {
  console.log('Open this in a browser and approve as a page admin:\n');
  console.log(`  ${authUrl}\n`);
  console.log(`Waiting on ${REDIRECT} …`);
});
