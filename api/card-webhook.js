/* ============================================================
   Helcim card webhook.

   The path is /api/card-webhook, not /api/helcim-webhook, because
   Helcim rejects any delivery URL containing the word "helcim".

   This is the reliable leg: it fires server-to-server the moment a
   card transaction is approved, independent of the customer's browser.

   Helcim's webhook body carries only {id, type} — no metadata bag — so
   we look the real transaction up by ID, read back the `invoiceNumber`
   we set to our own job reference at checkout, and use that to pull the
   job from Redis.

   Requires HELCIM_API_TOKEN and HELCIM_WEBHOOK_VERIFIER_TOKEN.
   IMPORTANT: signature verification needs the RAW body, so Vercel's
   automatic JSON parsing is disabled at the bottom of this file.
   ============================================================ */

const crypto = require('crypto');
const { getJob, setStatus } = require('./_lib/store');
const { notifyIfNeeded } = require('./_lib/notify');

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifySignature(rawBody, headers, verifierTokenB64) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const sig = headers['webhook-signature'];
  if (!id || !timestamp || !sig) return false;

  const signedContent = `${id}.${timestamp}.${rawBody.toString('utf8')}`;
  const key = Buffer.from(verifierTokenB64, 'base64');
  const expected = crypto.createHmac('sha256', key).update(signedContent).digest('base64');

  // Helcim may send several space-separated "v1,<sig>" values
  const candidates = String(sig).split(' ').map((s) => s.split(',').pop());
  return candidates.some((c) => {
    try { return crypto.timingSafeEqual(Buffer.from(c), Buffer.from(expected)); }
    catch (e) { return false; }
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method not allowed');
  }

  const apiToken = process.env.HELCIM_API_TOKEN;
  const verifierToken = process.env.HELCIM_WEBHOOK_VERIFIER_TOKEN;
  if (!apiToken || !verifierToken) {
    console.error('card-webhook: missing HELCIM_API_TOKEN or HELCIM_WEBHOOK_VERIFIER_TOKEN');
    return res.status(500).send('Webhook not configured');
  }

  const rawBody = await readRawBody(req);
  if (!verifySignature(rawBody, req.headers, verifierToken)) {
    console.error('card-webhook: signature verification failed');
    return res.status(400).send('Invalid signature');
  }

  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); }
  catch (e) { return res.status(400).send('Invalid payload'); }

  if (event.type !== 'cardTransaction') {
    return res.status(200).json({ received: true }); // ignore terminalCancel etc.
  }

  try {
    const txRes = await fetch(`https://api.helcim.com/v2/card-transactions/${event.id}`, {
      headers: { 'api-token': apiToken },
    });
    if (!txRes.ok) throw new Error(`transaction lookup failed: ${txRes.status}`);
    const tx = await txRes.json();

    if (String(tx.status || '').toUpperCase() !== 'APPROVED') {
      return res.status(200).json({ received: true });
    }

    const ref = tx.invoiceNumber;
    const job = await getJob(ref);
    if (!job) {
      console.error('card-webhook: no matching job for ref', ref);
      return res.status(200).json({ received: true });
    }

    await setStatus(ref, 'deposit_paid', 'helcim');
    await notifyIfNeeded({
      ...job,
      status: 'deposit_paid',
      transactionId: String(event.id),
      refundUrl: 'https://hub.helcim.com/transactions/all-transactions',
    });

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('card-webhook: handler error:', err && err.message);
    return res.status(500).json({ error: 'Webhook handler failed' }); // Helcim retries
  }
};

module.exports.config = { api: { bodyParser: false } };
