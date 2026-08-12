/* ============================================================
   Shared PayPal REST helpers — OAuth2 token + API base URL.
   Requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.
   Set PAYPAL_ENV=sandbox while testing; defaults to live.
   ============================================================ */

function apiBase() {
  return process.env.PAYPAL_ENV === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';
}

async function getAccessToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PayPal is not configured');

  const r = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`PayPal auth failed: ${r.status}`);
  const j = await r.json();
  return j.access_token;
}

module.exports = { apiBase, getAccessToken };
