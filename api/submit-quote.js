/* ============================================================
   Quote request WITHOUT payment — the "just send my request" path,
   and the only path available when the job needs an on-site visit.

   Replaces the old Firebase Cloud Function that texted the owner via
   Twilio. Same SMS still goes out (see _lib/notify.js), plus an email
   to the owner and a branded confirmation to the customer, and the
   job now lands on the owner's board instead of vanishing into a text.
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

  try {
    const ref = newRef();
    const record = buildJobRecord(
      b,
      { ref, status: 'new', processor: 'none', processorLabel: 'No deposit taken' },
      req.headers['x-forwarded-for']
    );
    const saved = await saveJob(ref, record);

    // Don't let a slow mail provider hold up the customer's confirmation
    await notifyNewRequest(saved);

    return res.status(200).json({
      ok: true,
      ref,
      message: "Thanks — your request is in. We'll be back to you within 2 business days.",
    });
  } catch (e) {
    console.error('submit-quote error:', e && e.message);
    return res.status(500).json({ error: 'Unable to submit your request. Please call 647-706-5123.' });
  }
};
