/* ============================================================
   Persistence for quote requests and paid bookings, backed by
   Upstash Redis (Vercel → Storage → Upstash → Redis).

   WHY THIS EXISTS: Helcim only echoes back an `invoiceNumber` and
   PayPal only a `custom_id` — both just short strings, not a place to
   store a job. So we mint the reference ourselves, save the real
   record here keyed by it, and look it up again when the webhook says
   payment succeeded.

   Beyond that, this file also backs the owner's job board: every
   record is indexed in a sorted set by creation time, which is the
   only way to enumerate jobs at all (a plain `job:<ref>` key is
   unreachable unless you already know the ref).

   Env vars are injected automatically when Upstash is connected to
   the Vercel project. Both naming schemes work.
   ============================================================ */

const { Redis } = require('@upstash/redis');

const TTL_SECONDS = 180 * 24 * 60 * 60; // 180 days — covers a full season

let _client = null;
function redis() {
  if (_client) return _client;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('Job storage is not configured (connect Upstash Redis in Vercel → Storage)');
  }
  _client = new Redis({ url, token });
  return _client;
}

function newRef() {
  // Short and field-safe — fits Helcim's invoiceNumber and PayPal's
  // custom_id length limits with room to spare.
  return 'RSC' + Date.now().toString(36).toUpperCase() +
    Math.random().toString(36).slice(2, 6).toUpperCase();
}

const REF_RE = /^RSC[A-Z0-9]{4,40}$/;

/* ---------- Job board index ---------- */
const JOBS_KEY = 'jobs:all';

/* Every status a job can be in, in pipeline order. */
const STATUSES = ['new', 'quoted', 'deposit_paid', 'scheduled', 'completed', 'cancelled'];

const STATUS_LABELS = {
  new: 'New request',
  quoted: 'Quoted',
  deposit_paid: 'Deposit paid',
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

async function saveJob(ref, data) {
  const row = {
    ...data,
    ref,
    status: data.status || 'new',
    notified: false,
    createdAt: Date.now(),
    history: [{ at: Date.now(), status: data.status || 'new', by: 'system' }],
  };
  await redis().set(`job:${ref}`, row, { ex: TTL_SECONDS });
  try {
    await redis().zadd(JOBS_KEY, { score: row.createdAt, member: ref });
  } catch (e) {
    // Never block a booking because the index hiccuped
    console.error('job index failed:', e && e.message);
  }
  return row;
}

async function getJob(ref) {
  if (!ref || !REF_RE.test(String(ref))) return null;
  try { return await redis().get(`job:${ref}`); } catch (e) { return null; }
}

async function updateJob(ref, patch) {
  const row = await getJob(ref);
  if (!row) return null;
  const next = { ...row, ...patch, updatedAt: Date.now() };
  await redis().set(`job:${ref}`, next, { ex: TTL_SECONDS });
  return next;
}

/* Status change with an append-only audit trail, so the owner can see
   not just where a job is but how it got there. */
async function setStatus(ref, status, by) {
  if (!STATUSES.includes(status)) return null;
  const row = await getJob(ref);
  if (!row) return null;
  const history = Array.isArray(row.history) ? row.history.slice(-40) : [];
  history.push({ at: Date.now(), status, by: by || 'owner' });
  return updateJob(ref, { status, history });
}

/* Most recent first. Powers the owner's backlog board. */
async function listJobs(limit = 200) {
  try {
    const refs = await redis().zrange(JOBS_KEY, 0, Math.max(0, limit - 1), { rev: true });
    if (!Array.isArray(refs) || !refs.length) return [];
    const rows = await Promise.all(refs.map((r) => getJob(r)));
    return rows.filter(Boolean);
  } catch (e) {
    console.error('job list failed:', e && e.message);
    return [];
  }
}

/* Marks the emails as sent. Idempotency guard for the payment paths —
   whichever of webhook/capture lands first wins, the rest no-op. */
async function markNotified(ref) {
  return updateJob(ref, { notified: true });
}

/* Drop index entries for jobs whose rows have already expired. */
async function pruneJobs(beforeMs) {
  try { return await redis().zremrangebyscore(JOBS_KEY, 0, beforeMs); }
  catch (e) { return 0; }
}

module.exports = {
  newRef, REF_RE, saveJob, getJob, updateJob, setStatus, listJobs,
  markNotified, pruneJobs, STATUSES, STATUS_LABELS,
};
