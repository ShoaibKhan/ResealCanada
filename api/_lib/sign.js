/* ============================================================
   HMAC signing for the owner's one-click links — the job board, the
   status buttons in alert emails, and refund approvals.

   Those links land in an inbox, so they carry ?sig=… derived from the
   value they act on. Only links this server generated are accepted;
   nobody can guess a reference and drive the job board with it.

   Key: a dedicated APP_SECRET if set, otherwise derived from an
   existing server-only secret so the feature works with zero extra
   setup. All of these are stable, so issued links keep working.
   ============================================================ */

const crypto = require('crypto');

function secret() {
  return (
    process.env.APP_SECRET ||
    process.env.HELCIM_API_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    'reseal-insecure-fallback-set-APP_SECRET'
  );
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(String(value)).digest('hex').slice(0, 32);
}

function verify(value, sig) {
  if (!sig) return false;
  const expected = sign(value);
  try {
    return crypto.timingSafeEqual(Buffer.from(String(sig)), Buffer.from(expected));
  } catch (e) {
    return false;
  }
}

module.exports = { sign, verify };
