/* ============================================================
   Quote request WITHOUT payment — the "just send my request" path,
   and the only path available when the job needs an on-site visit.

   Replaces the old Firebase Cloud Function that texted the owner via
   Twilio. Same SMS still goes out (see _lib/notify.js), plus an email
   to the owner and a branded confirmation to the customer, and the
   job lands on the owner's board instead of vanishing into a text.

   ⭐ DEGRADES ON PURPOSE. Storage is treated as optional: if Upstash
   isn't connected yet, the request still goes through as long as the
   owner can be reached by email or SMS. Losing the job-board entry is
   bad; losing the customer is worse. The request is only refused when
   nothing at all worked — and then it says so plainly and gives the
   phone number rather than pretending it sent.
   ============================================================ */

const { validateBooking } = require('./_lib/pricing');
const { buildJobRecord } = require('./_lib/record');
const { newRef, saveJob } = require('./_lib/store');
const { notifyNewRequest } = require('./_lib/notify');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const b = req.body || {};
  const err = validateBooking(b);
  if (err) return res.status(400).json({ error: err });

  // newRef() is pure, so we always have a reference even with no storage
  const ref = newRef();
  const record = buildJobRecord(
    b,
    { ref, status: 'new', processor: 'none', processorLabel: 'No deposit taken' },
    req.headers['x-forwarded-for']
  );

  let saved = null;
  try {
    saved = await saveJob(ref, record);
  } catch (e) {
    // Not fatal — carry on and try to reach the owner anyway
    console.error('job storage unavailable, continuing without it:', e && e.message);
  }

  const notified = await notifyNewRequest(saved || record);

  if (!saved && !notified.reached) {
    // Nothing persisted and nobody was told. Say so honestly.
    console.error('submit-quote: no storage and no notification channel configured');
    return res.status(503).json({
      error: "We couldn't submit that automatically. Please call us on 647-706-5123 " +
        "or email info@resealcanada.ca and we'll pick it up right away.",
    });
  }

  return res.status(200).json({
    ok: true,
    ref,
    stored: !!saved,
    message: "Thanks — your request is in. We'll be back to you within 2 business days.",
  });
};
