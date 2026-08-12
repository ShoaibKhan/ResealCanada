/* ============================================================
   Creates a PayPal Order for the booking deposit — the "pay with
   PayPal" option.

   Deposit amount is decided here, same as the Helcim path; the browser
   never sends an amount. The job is saved under our own reference and
   that reference rides along as the order's custom_id (and invoice_id),
   so both the capture leg and the webhook can find it again.

   Requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET
   (plus PAYPAL_ENV=sandbox while testing).
   ============================================================ */

const { validateBooking, computeEstimate, BOOKING_DEPOSIT } = require('./_lib/pricing');
const { buildJobRecord } = require('./_lib/record');
const { newRef, saveJob } = require('./_lib/store');
const { apiBase, getAccessToken } = require('./_lib/paypal');

const ALLOWED_ORIGINS = [
  'https://resealcanada.ca',
  'https://www.resealcanada.ca',
  'http://localhost:8931',
];

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    return res.status(500).json({ error: 'PayPal payments are not configured' });
  }

  const b = req.body || {};
  const err = validateBooking(b);
  if (err) return res.status(400).json({ error: err });

  // Same guard as the card path — no payment screen for jobs we haven't
  // priced. See create-helcim-checkout.js.
  const est = computeEstimate(b);
  if (est.needsVisit) {
    return res.status(400).json({ error: 'This job needs an on-site quote before any deposit.' });
  }

  const reqOrigin = req.headers.origin || '';
  const origin = ALLOWED_ORIGINS.includes(reqOrigin) ? reqOrigin : ALLOWED_ORIGINS[0];

  try {
    const ref = newRef();
    await saveJob(ref, buildJobRecord(
      b,
      { ref, status: 'new', processor: 'paypal', processorLabel: 'PayPal' },
      req.headers['x-forwarded-for']
    ));

    const token = await getAccessToken();
    const r = await fetch(`${apiBase()}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: 'deposit',
          custom_id: ref,
          invoice_id: ref,
          description: `Booking deposit — ${est.svcLabel}`.slice(0, 127),
          amount: { currency_code: 'CAD', value: BOOKING_DEPOSIT.toFixed(2) },
        }],
        application_context: {
          brand_name: 'Reseal Canada',
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
          return_url: `${origin}/api/capture-paypal-order`,
          cancel_url: `${origin}/?canceled=1#book`,
        },
      }),
    });

    const order = await r.json().catch(() => ({}));
    if (!r.ok || !order.id) {
      console.error('PayPal order create failed:', r.status, JSON.stringify(order).slice(0, 300));
      return res.status(502).json({ error: 'Unable to start PayPal checkout' });
    }

    const approve = (order.links || []).find((l) => l.rel === 'approve');
    if (!approve) {
      console.error('PayPal order missing approve link:', order.id);
      return res.status(502).json({ error: 'Unable to start PayPal checkout' });
    }

    return res.status(200).json({ approveUrl: approve.href, ref });
  } catch (e) {
    console.error('PayPal order error:', e && e.message);
    return res.status(500).json({ error: 'Unable to start PayPal checkout' });
  }
};
