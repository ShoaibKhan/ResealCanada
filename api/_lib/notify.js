/* ============================================================
   Every outbound message the system sends.

   Two channels, deliberately:
     • Email (Resend) — owner alerts and the customer's invoice.
     • SMS (Twilio)  — owner only. He is on a job site most of the day,
       and a text is the only thing he will reliably see within the
       hour. This replaces the old Firebase function's Twilio call.

   Idempotent where it matters: `notified` lives on the same Redis row
   as the job, so whichever payment path lands first (Helcim webhook or
   PayPal capture) sends the emails and the rest no-op. Closing the tab
   right after paying must never mean nobody gets told.

   Nothing here ever throws. A message failing to send must not roll
   back a payment that already succeeded.
   ============================================================ */

const { markNotified, STATUS_LABELS } = require('./store');
const { money, estimateLabel } = require('./pricing');
const { sign } = require('./sign');

const OWNER_EMAILS = ['info@resealcanada.ca'];
const CUSTOMER_REPLY_TO = 'info@resealcanada.ca';

const BRAND = {
  yellow: '#fdd635',
  black: '#121212',
  ink: '#141414',
  muted: '#6d6d6d',
  line: '#e6e6e6',
};

function siteUrl() {
  return (process.env.SITE_URL || 'https://resealcanada.ca').replace(/\/$/, '');
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(d) {
  if (!d) return 'Not specified';
  const t = Date.parse(`${d}T00:00:00Z`);
  if (!Number.isFinite(t)) return String(d);
  return new Date(t).toLocaleDateString('en-CA', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

/* ------------------------------------------------------------------
   Channels
------------------------------------------------------------------ */

async function sendEmail({ to, subject, html, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) {
    console.error('email skipped: RESEND_API_KEY / RESEND_FROM not set');
    return false;
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, reply_to: replyTo || undefined, subject, html }),
    });
    if (!r.ok) console.error('email failed:', r.status, await r.text().catch(() => ''));
    return r.ok;
  } catch (e) {
    console.error('email failed:', e && e.message);
    return false;
  }
}

/* Owner SMS. Silently no-ops when Twilio isn't configured, so the rest
   of the system works fine without it. */
async function sendOwnerSms(body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const to = process.env.OWNER_SMS_TO;
  const msgService = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !to || (!msgService && !from)) return false;

  try {
    const params = new URLSearchParams({ To: to, Body: body.slice(0, 1500) });
    if (msgService) params.set('MessagingServiceSid', msgService);
    else params.set('From', from);

    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!r.ok) console.error('sms failed:', r.status, await r.text().catch(() => ''));
    return r.ok;
  } catch (e) {
    console.error('sms failed:', e && e.message);
    return false;
  }
}

/* ------------------------------------------------------------------
   Templates
------------------------------------------------------------------ */

function shell(bannerText, bannerColor, bodyHtml, footerNote) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:24px 14px;">
      <div style="background:#fff;border:1px solid ${BRAND.line};border-radius:14px;overflow:hidden;">
        <div style="background:${bannerColor};padding:20px 28px;">
          <div style="color:${bannerColor === BRAND.yellow ? BRAND.black : '#fff'};font-size:16px;font-weight:bold;letter-spacing:.3px;">
            ${escHtml(bannerText)}
          </div>
        </div>
        <div style="padding:26px 28px;">${bodyHtml}</div>
        <div style="border-top:1px solid #eee;padding:16px 28px;text-align:center;font-size:11.5px;color:#9a9a9a;">
          ${escHtml(footerNote || 'Reseal Canada · automated notification')}
        </div>
      </div>
    </div>
  </body></html>`;
}

function rowsTable(rows) {
  return `<table width="100%" style="border-collapse:collapse;">` +
    Object.entries(rows)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `<tr>
        <td style="padding:8px 0;color:${BRAND.muted};font-size:13px;white-space:nowrap;vertical-align:top;">${escHtml(k)}</td>
        <td style="padding:8px 0 8px 18px;color:${BRAND.ink};font-size:13px;font-weight:bold;">${escHtml(String(v))}</td>
      </tr>`).join('') + `</table>`;
}

function button(url, label, bg, fg) {
  return `<a href="${escHtml(url)}" style="display:inline-block;margin:6px 8px 0 0;background:${bg};color:${fg};text-decoration:none;font-size:13px;font-weight:bold;padding:12px 22px;border-radius:9px;">${escHtml(label)}</a>`;
}

/* Job details shared by the owner alert and the customer's copy. */
function jobRows(job, forOwner) {
  const rows = {
    'Reference': job.ref,
    'Service': job.svcLabel,
    'Property': job.propertyLabel,
  };
  if (job.detailLabel) rows['Details'] = job.detailLabel;
  if (job.crackLabel) rows['Cracking'] = job.crackLabel;
  if (job.windowCountLabel) rows['Windows'] = job.windowCountLabel;
  if (job.insideLabel) rows['Coverage'] = job.insideLabel;
  rows['Preferred date'] = fmtDate(job.date);
  rows['Estimate'] = job.needsVisit ? 'On-site quote required' : `${estimateLabel(job)} + HST`;

  if (forOwner) {
    rows['Customer'] = job.name;
    rows['Phone'] = job.phone;
    rows['Email'] = job.email;
    rows['Address'] = job.addr;
    if (job.notes && job.notes !== 'None') rows['Notes'] = job.notes;
    if (job.depositPaid) {
      rows['Deposit paid'] = `${money(job.depositAmount)} via ${job.processorLabel || job.processor}`;
      rows['Transaction'] = job.transactionId || '—';
    }
    rows['Status'] = STATUS_LABELS[job.status] || job.status;
  }
  return rows;
}

/* ------------------------------------------------------------------
   Owner alerts
------------------------------------------------------------------ */

function boardUrl() {
  return `${siteUrl()}/api/jobs?sig=${sign('board')}`;
}

function statusUrl(ref, status) {
  return `${siteUrl()}/api/update-job?ref=${encodeURIComponent(ref)}&status=${status}&sig=${sign(ref + status)}`;
}

/* Returns { email, sms } so callers can tell whether the owner actually
   heard about the job. A request nobody receives is a lost customer, so
   this is worth knowing rather than assuming. */
async function alertOwner(job, kind) {
  const paid = kind === 'paid';
  const banner = paid
    ? `Deposit paid — ${money(job.depositAmount)}`
    : 'New quote request';
  const color = paid ? '#1e8e4e' : BRAND.black;

  const actions =
    button(boardUrl(), 'Open job board', BRAND.black, '#fff') +
    (paid
      ? button(statusUrl(job.ref, 'scheduled'), 'Mark scheduled', BRAND.yellow, BRAND.black)
      : button(statusUrl(job.ref, 'quoted'), 'Mark quoted', BRAND.yellow, BRAND.black));

  const html = shell(
    banner, color,
    rowsTable(jobRows(job, true)) +
      `<div style="margin-top:22px;">${actions}</div>`,
    'Reseal Canada · automated job alert'
  );

  const email = await sendEmail({
    to: OWNER_EMAILS,
    subject: paid
      ? `Deposit paid — ${job.name} (${job.ref})`
      : `New quote request — ${job.name} (${job.ref})`,
    html,
    replyTo: job.email,
  });

  const sms = await sendOwnerSms(
    (paid ? 'RESEAL — DEPOSIT PAID\n' : 'RESEAL — NEW QUOTE REQUEST\n') +
    `${job.name}\n${job.phone}\n${job.svcLabel}\n` +
    `${job.needsVisit ? 'On-site quote' : estimateLabel(job)}\n` +
    `${fmtDate(job.date)}\n${job.addr}\nRef ${job.ref}`
  );

  return { email, sms };
}

/* ------------------------------------------------------------------
   Customer messages
------------------------------------------------------------------ */

async function emailCustomerReceipt(job) {
  const lines = (job.lines || [])
    .filter((l) => l.high > 0)
    .map((l) => `<tr>
      <td style="padding:7px 0;color:${BRAND.ink};font-size:13px;">${escHtml(l.label)}</td>
      <td style="padding:7px 0;color:${BRAND.ink};font-size:13px;text-align:right;white-space:nowrap;">${money(l.low)}–${money(l.high)}</td>
    </tr>`).join('');

  const estimateBlock = job.needsVisit
    ? `<div style="background:#fffae3;border:1px solid ${BRAND.yellow};border-radius:10px;padding:16px 18px;font-size:13px;color:#5c4a00;line-height:1.6;">
         <strong>We'll quote this one in person.</strong><br>${escHtml(job.reason || '')}
       </div>`
    : `<table width="100%" style="border-collapse:collapse;margin-bottom:14px;">${lines}
         <tr><td colspan="2" style="border-top:1px solid ${BRAND.line};padding-top:10px;"></td></tr>
         <tr>
           <td style="color:${BRAND.ink};font-size:15px;font-weight:bold;">Estimated total</td>
           <td style="color:${BRAND.ink};font-size:15px;font-weight:bold;text-align:right;">${money(job.low)}–${money(job.high)}</td>
         </tr>
         <tr><td colspan="2" style="color:${BRAND.muted};font-size:12px;padding-top:4px;">Plus HST. This is an estimate, not a final price.</td></tr>
       </table>`;

  const depositBlock = job.depositPaid
    ? `<div style="background:#eef9f1;border:1px solid #b3e2c1;border-radius:10px;padding:16px 18px;margin-top:16px;font-size:13px;color:#14622f;line-height:1.6;">
         <strong>Deposit received — ${money(job.depositAmount)}</strong><br>
         This is credited in full against your final invoice. It's refundable if you cancel
         with at least 24 hours' notice.
       </div>`
    : '';

  const html = shell(
    job.depositPaid ? 'Your booking is confirmed' : 'We\'ve got your request',
    BRAND.yellow,
    `<p style="font-size:14px;color:${BRAND.ink};line-height:1.7;margin:0 0 18px;">
       Hi ${escHtml(String(job.name).split(' ')[0])},<br><br>
       ${job.depositPaid
         ? 'Thanks — your deposit is in and your date is being held. Here\'s a summary of the job.'
         : 'Thanks for getting in touch. Here\'s what we\'ve got — we\'ll be back to you within 2 business days.'}
     </p>
     ${estimateBlock}
     ${depositBlock}
     <div style="margin-top:22px;padding-top:18px;border-top:1px solid ${BRAND.line};">
       ${rowsTable(jobRows(job, false))}
     </div>
     <div style="background:#fffae3;border:1px solid ${BRAND.yellow};border-radius:10px;padding:16px 18px;margin-top:18px;font-size:12.5px;color:#5c4a00;line-height:1.6;">
       <strong>About your date.</strong> Sealer can't be applied in rain or below about 10°C,
       so your date is a target rather than a promise. If the weather moves it we'll tell you
       as early as we can and reschedule at no cost.
     </div>
     <p style="font-size:13px;color:${BRAND.muted};line-height:1.7;margin:20px 0 0;">
       Questions? Just reply to this email or call
       <a href="tel:+16477065123" style="color:${BRAND.ink};font-weight:bold;">647-706-5123</a>.
     </p>`,
    'Reseal Canada · 1010 Central Pkwy W, Mississauga, ON'
  );

  await sendEmail({
    to: [job.email],
    subject: job.depositPaid
      ? `Booking confirmed — ${job.svcLabel} (${job.ref})`
      : `We've received your request — ${job.ref}`,
    html,
    replyTo: CUSTOMER_REPLY_TO,
  });
}

/* ------------------------------------------------------------------
   Public entry points
------------------------------------------------------------------ */

/* Payment path. Idempotent — safe to call from both the Helcim webhook
   and the PayPal capture; only the first call sends anything. */
async function notifyIfNeeded(job) {
  if (!job || job.notified) return false;
  const paidJob = { ...job, depositPaid: true, status: 'deposit_paid' };
  try {
    await markNotified(job.ref);          // claim first, so a race can't double-send
    await alertOwner(paidJob, 'paid');
    await emailCustomerReceipt(paidJob);
    return true;
  } catch (e) {
    console.error('notifyIfNeeded failed:', e && e.message);
    return false;
  }
}

/* No-payment path — customer asked for a quote without paying a deposit.
   Returns whether the owner was reached by ANY channel, so the caller can
   decide whether the submission genuinely landed. */
async function notifyNewRequest(job) {
  let owner = { email: false, sms: false };
  try {
    owner = await alertOwner(job, 'new');
  } catch (e) {
    console.error('owner alert failed:', e && e.message);
  }
  try {
    await emailCustomerReceipt(job);
  } catch (e) {
    // The customer's copy is a courtesy; never fail the request over it
    console.error('customer receipt failed:', e && e.message);
  }
  return { ...owner, reached: !!(owner.email || owner.sms) };
}

module.exports = {
  notifyIfNeeded, notifyNewRequest, alertOwner, emailCustomerReceipt,
  sendEmail, sendOwnerSms, boardUrl, statusUrl, escHtml, fmtDate,
  OWNER_EMAILS,
};
