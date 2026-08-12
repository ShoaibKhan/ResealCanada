/* ============================================================
   PayPal return leg.

   PayPal sends the customer here after they APPROVE — but approval
   alone moves no money. This captures the order server-side (the
   actual charge), notifies through the shared deduplicated path, then
   forwards to /payment-success?ref=…

   Security: the reference used for notification is read from the
   CAPTURED ORDER's own custom_id, which we set server-side at order
   creation. Never from anything the browser supplies.
   ============================================================ */

const { getJob, setStatus } = require('./_lib/store');
const { notifyIfNeeded } = require('./_lib/notify');
const { apiBase, getAccessToken } = require('./_lib/paypal');

function refundUrlFor(captureId) {
  const base = process.env.PAYPAL_ENV === 'sandbox'
    ? 'https://www.sandbox.paypal.com'
    : 'https://www.paypal.com';
  return captureId ? `${base}/activity/payment/${captureId}` : `${base}/activity`;
}

function extractRefAndCapture(order) {
  const pu = (order.purchase_units || [])[0] || {};
  const cap = ((pu.payments || {}).captures || [])[0] || {};
  return {
    ref: cap.custom_id || pu.custom_id || '',
    captureId: cap.id || '',
    completed:
      String(order.status || '').toUpperCase() === 'COMPLETED' ||
      String(cap.status || '').toUpperCase() === 'COMPLETED',
  };
}

function bounce(res, to) {
  res.statusCode = 302;
  res.setHeader('Location', to);
  return res.end();
}

module.exports = async (req, res) => {
  const orderId = String((req.query && req.query.token) || '');
  if (!/^[A-Z0-9]{5,30}$/i.test(orderId)) return bounce(res, '/?canceled=1#book');

  try {
    const token = await getAccessToken();

    // Idempotency key = order id, so a refresh of this URL can't double-charge
    const r = await fetch(`${apiBase()}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `cap-${orderId}`,
      },
    });
    let order = await r.json().catch(() => ({}));

    // Already captured (refresh, or a webhook race) → read current state
    if (!r.ok) {
      const already = JSON.stringify(order).includes('ORDER_ALREADY_CAPTURED');
      if (!already) {
        console.error('PayPal capture failed:', r.status, JSON.stringify(order).slice(0, 300));
        return bounce(res, '/?canceled=1#book');
      }
      const g = await fetch(`${apiBase()}/v2/checkout/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      order = await g.json().catch(() => ({}));
    }

    const { ref, captureId, completed } = extractRefAndCapture(order);
    if (!completed || !ref) {
      console.error('PayPal capture not completed for order', orderId);
      return bounce(res, '/?canceled=1#book');
    }

    const job = await getJob(ref);
    if (job) {
      await setStatus(ref, 'deposit_paid', 'paypal');
      await notifyIfNeeded({
        ...job,
        status: 'deposit_paid',
        transactionId: captureId || orderId,
        refundUrl: refundUrlFor(captureId),
      });
    }
    return bounce(res, `/payment-success?ref=${encodeURIComponent(ref)}`);
  } catch (e) {
    console.error('PayPal capture error:', e && e.message);
    return bounce(res, '/?canceled=1#book');
  }
};
