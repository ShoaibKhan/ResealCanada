/* ============================================================
   "Is this reference paid?" — used by payment-success.html to render
   the confirmation, and by its retry button for the rare case where
   the customer's browser arrives before the Helcim webhook or PayPal
   capture has finished.

   Processor-agnostic: reads the same Redis row every payment path
   writes to. `notified` is only ever set after a path independently
   confirmed the payment WITH the processor, so it doubles as the
   "paid" signal. Nothing here trusts the browser's word for payment.
   ============================================================ */

const { getJob, REF_RE, STATUS_LABELS } = require('./_lib/store');
const { money, estimateLabel } = require('./_lib/pricing');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ref = String((req.body && req.body.ref) || '');
  if (!REF_RE.test(ref)) return res.status(400).json({ error: 'Invalid reference' });

  try {
    const job = await getJob(ref);
    if (!job || !job.notified) return res.status(200).json({ paid: false });

    return res.status(200).json({
      paid: true,
      summary: {
        reference: job.ref,
        name: job.name || '',
        service: job.svcLabel || '',
        details: job.detailLabel || '',
        date: job.date || '',
        estimate: job.needsVisit ? 'On-site quote' : `${estimateLabel(job)} + HST`,
        depositPaid: `${money(job.depositAmount)} CAD`,
        paymentMethod: job.processorLabel || job.processor || '',
        status: STATUS_LABELS[job.status] || job.status || '',
      },
    });
  } catch (err) {
    console.error('verify-payment error:', err && err.message);
    return res.status(500).json({ error: 'Unable to verify payment' });
  }
};
