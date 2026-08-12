/* ============================================================
   One-click status changes from the owner's alert emails and job
   board.

   Every link is HMAC-signed over ref+status (api/_lib/sign.js), so a
   guessed reference can't be used to drive the pipeline. Signing the
   status too means a "mark completed" link can't be edited into a
   "mark cancelled" one.
   ============================================================ */

const { getJob, setStatus, REF_RE, STATUSES, STATUS_LABELS } = require('./_lib/store');
const { verify, sign } = require('./_lib/sign');
const { escHtml } = require('./_lib/notify');

function page(title, body, ok) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)}</title>
  <style>
    body{margin:0;background:#f5f5f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
         display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;}
    .card{background:#fff;border:1px solid #e6e6e6;border-radius:16px;max-width:460px;width:100%;
          padding:34px 30px;text-align:center;box-shadow:0 18px 40px -24px rgba(0,0,0,.3);}
    .ring{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;
          margin:0 auto 18px;font-size:26px;background:${ok ? '#eef9f1' : '#fdecec'};color:${ok ? '#1e8e4e' : '#9b1c1c'};}
    h1{font-size:20px;margin:0 0 10px;color:#141414;}
    p{font-size:14px;color:#6d6d6d;line-height:1.7;margin:0 0 22px;}
    a{display:inline-block;background:#121212;color:#fdd635;text-decoration:none;font-weight:700;
      font-size:13px;padding:13px 24px;border-radius:10px;}
  </style></head><body><div class="card">
    <div class="ring">${ok ? '&#10003;' : '!'}</div>${body}
  </div></body></html>`;
}

module.exports = async (req, res) => {
  const ref = String((req.query && req.query.ref) || '');
  const status = String((req.query && req.query.status) || '');
  const sig = String((req.query && req.query.sig) || '');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!REF_RE.test(ref) || !STATUSES.includes(status)) {
    return res.status(400).send(page('Invalid link',
      '<h1>That link isn\'t valid</h1><p>The reference or status is missing or malformed.</p>', false));
  }
  if (!verify(ref + status, sig)) {
    return res.status(403).send(page('Link not recognised',
      '<h1>Link not recognised</h1><p>This link wasn\'t issued by the system, or the secret has changed since it was sent.</p>', false));
  }

  try {
    const existing = await getJob(ref);
    if (!existing) {
      return res.status(404).send(page('Job not found',
        `<h1>Job not found</h1><p>Reference <strong>${escHtml(ref)}</strong> has expired or never existed.</p>`, false));
    }

    // Already there — say so plainly rather than pretending something happened
    if (existing.status === status) {
      return res.status(200).send(page('Already set',
        `<h1>Already marked ${escHtml(STATUS_LABELS[status])}</h1>
         <p><strong>${escHtml(existing.name)}</strong> — ${escHtml(existing.svcLabel)}<br>
         Reference ${escHtml(ref)}</p>
         <a href="/api/jobs?sig=${sign('board')}">Open job board</a>`, true));
    }

    const updated = await setStatus(ref, status, 'owner');
    return res.status(200).send(page('Updated',
      `<h1>Marked ${escHtml(STATUS_LABELS[status])}</h1>
       <p><strong>${escHtml(updated.name)}</strong> — ${escHtml(updated.svcLabel)}<br>
       Reference ${escHtml(ref)}</p>
       <a href="/api/jobs?sig=${sign('board')}">Open job board</a>`, true));
  } catch (e) {
    console.error('update-job error:', e && e.message);
    return res.status(500).send(page('Something went wrong',
      '<h1>Something went wrong</h1><p>The status wasn\'t changed. Try again from the job board.</p>', false));
  }
};
