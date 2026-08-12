/* ============================================================
   Initializes a HelcimPay.js session for the booking deposit — the
   "pay by card" option.

   The deposit amount is decided HERE from api/_lib/pricing.js; the
   browser never sends an amount. The job is saved under our own short
   reference BEFORE the checkout is created, because Helcim only echoes
   back an `invoiceNumber` — that reference IS the invoiceNumber, and
   the webhook uses it to find the job again.

   Requires HELCIM_API_TOKEN.
   ============================================================ */

const { validateBooking, computeEstimate, BOOKING_DEPOSIT } = require('./_lib/pricing');
const { buildJobRecord } = require('./_lib/record');
const { newRef, saveJob } = require('./_lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.HELCIM_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'Card payments are not configured' });

  const b = req.body || {};
  const err = validateBooking(b);
  if (err) return res.status(400).json({ error: err });

  // Jobs that need an on-site visit must never reach a payment screen —
  // taking money against a number we haven't stood behind is the exact
  // thing the estimate model exists to avoid.
  const est = computeEstimate(b);
  if (est.needsVisit) {
    return res.status(400).json({ error: 'This job needs an on-site quote before any deposit.' });
  }

  try {
    const ref = newRef();
    await saveJob(ref, buildJobRecord(
      b,
      { ref, status: 'new', processor: 'helcim', processorLabel: 'Helcim (Card)' },
      req.headers['x-forwarded-for']
    ));

    const r = await fetch('https://api.helcim.com/v2/helcim-pay/initialize', {
      method: 'POST',
      headers: { 'api-token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentType: 'purchase',
        amount: BOOKING_DEPOSIT,
        currency: 'CAD',
        // invoiceRequest CREATES an invoice carrying our reference. A
        // top-level invoiceNumber only links an EXISTING invoice and
        // fails with "Invalid Invoice Number".
        invoiceRequest: {
          invoiceNumber: ref,
          lineItems: [{
            description: `Booking deposit — ${est.svcLabel}`.slice(0, 250),
            quantity: 1,
            price: BOOKING_DEPOSIT,
            total: BOOKING_DEPOSIT,
          }],
        },
        paymentMethod: 'cc',
        confirmationScreen: false,
      }),
    });

    if (!r.ok) {
      console.error('Helcim initialize failed:', r.status, await r.text().catch(() => ''));
      return res.status(502).json({ error: 'Unable to start card checkout' });
    }

    const j = await r.json();
    return res.status(200).json({ checkoutToken: j.checkoutToken, ref });
  } catch (e) {
    console.error('Helcim initialize error:', e && e.message);
    return res.status(500).json({ error: 'Unable to start card checkout' });
  }
};
