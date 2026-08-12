/* ============================================================
   The owner's job board — every request, quote and booking in one
   place, newest first.

   This is the backlog view. Emails tell him something happened; this
   tells him what is still outstanding, which is the part that
   actually gets forgotten. Reached by a signed link in every alert
   email, so there's no login to maintain.

   Read-only apart from the status buttons, which post through
   /api/update-job (separately signed per ref+status).
   ============================================================ */

const { listJobs, STATUS_LABELS } = require('./_lib/store');
const { verify, sign } = require('./_lib/sign');
const { money, estimateLabel } = require('./_lib/pricing');
const { escHtml, fmtDate } = require('./_lib/notify');

const PILL = {
  new: ['#fff4d6', '#7a5c00'],
  quoted: ['#e4efff', '#1c4f9c'],
  deposit_paid: ['#e6f7ec', '#14622f'],
  scheduled: ['#efe6ff', '#4a2a91'],
  completed: ['#eceff1', '#41525d'],
  cancelled: ['#fdecec', '#9b1c1c'],
};

// Which buttons make sense from each state
const NEXT = {
  new: ['quoted', 'scheduled', 'cancelled'],
  quoted: ['scheduled', 'completed', 'cancelled'],
  deposit_paid: ['scheduled', 'completed', 'cancelled'],
  scheduled: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

function statusUrl(ref, status) {
  return `/api/update-job?ref=${encodeURIComponent(ref)}&status=${status}&sig=${sign(ref + status)}`;
}

function pill(status) {
  const [bg, fg] = PILL[status] || PILL.new;
  return `<span style="display:inline-block;background:${bg};color:${fg};font-size:11px;font-weight:700;
    letter-spacing:.04em;text-transform:uppercase;padding:5px 11px;border-radius:100px;white-space:nowrap;">
    ${escHtml(STATUS_LABELS[status] || status)}</span>`;
}

function jobCard(j) {
  const actions = (NEXT[j.status] || [])
    .map((s) => `<a class="act" href="${statusUrl(j.ref, s)}">${escHtml(STATUS_LABELS[s])}</a>`)
    .join('');

  const est = j.needsVisit
    ? '<span class="visit">On-site quote</span>'
    : `${escHtml(estimateLabel(j))} <span class="sub">+ HST</span>`;

  const deposit = j.notified
    ? `<span class="paid">${escHtml(money(j.depositAmount))} deposit paid</span>`
    : '<span class="sub">No deposit</span>';

  return `<div class="job">
    <div class="jhead">
      <div>
        <div class="jname">${escHtml(j.name || '—')}</div>
        <div class="sub">${escHtml(j.ref)} · ${escHtml(new Date(j.createdAt).toLocaleDateString('en-CA'))}</div>
      </div>
      ${pill(j.status)}
    </div>
    <div class="jgrid">
      <div><span class="lbl">Service</span>${escHtml(j.svcLabel || '—')}</div>
      <div><span class="lbl">Details</span>${escHtml(j.detailLabel || '—')}${j.crackLabel ? ' · ' + escHtml(j.crackLabel) : ''}</div>
      <div><span class="lbl">Preferred date</span>${escHtml(fmtDate(j.date))}</div>
      <div><span class="lbl">Estimate</span>${est}</div>
      <div><span class="lbl">Phone</span><a href="tel:${escHtml(String(j.phone || '').replace(/[^\d+]/g, ''))}">${escHtml(j.phone || '—')}</a></div>
      <div><span class="lbl">Email</span><a href="mailto:${escHtml(j.email || '')}">${escHtml(j.email || '—')}</a></div>
      <div class="wide"><span class="lbl">Address</span>${escHtml(j.addr || '—')}</div>
      <div class="wide"><span class="lbl">Payment</span>${deposit}</div>
      ${j.notes && j.notes !== 'None' ? `<div class="wide"><span class="lbl">Notes</span>${escHtml(j.notes)}</div>` : ''}
    </div>
    ${actions ? `<div class="acts">${actions}</div>` : ''}
  </div>`;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Never let a board full of customer details sit in a shared cache
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  const sig = String((req.query && req.query.sig) || '');
  if (!verify('board', sig)) {
    return res.status(403).send(`<!DOCTYPE html><meta charset="utf-8">
      <body style="font-family:system-ui;padding:40px;text-align:center;color:#333;">
      <h1 style="font-size:20px;">Not authorised</h1>
      <p style="color:#666;">This board is only reachable from the signed link in your alert emails.</p>
      </body>`);
  }

  let jobs = [];
  let loadError = '';
  try {
    jobs = await listJobs(300);
  } catch (e) {
    loadError = e && e.message ? e.message : 'Storage unavailable';
  }

  const counts = jobs.reduce((a, j) => { a[j.status] = (a[j.status] || 0) + 1; return a; }, {});
  const open = jobs.filter((j) => !['completed', 'cancelled'].includes(j.status));
  const done = jobs.filter((j) => ['completed', 'cancelled'].includes(j.status));

  const summary = ['new', 'quoted', 'deposit_paid', 'scheduled', 'completed', 'cancelled']
    .map((s) => `<div class="stat"><div class="statnum">${counts[s] || 0}</div>
      <div class="statlbl">${escHtml(STATUS_LABELS[s])}</div></div>`).join('');

  const body = loadError
    ? `<div class="empty"><strong>Can't reach job storage.</strong><br>${escHtml(loadError)}</div>`
    : jobs.length === 0
      ? '<div class="empty">No jobs yet. They\'ll appear here as requests come in.</div>'
      : `<h2>Open <span class="sub">(${open.length})</span></h2>
         ${open.length ? open.map(jobCard).join('') : '<div class="empty">Nothing outstanding — all caught up.</div>'}
         ${done.length ? `<h2 style="margin-top:38px;">Closed <span class="sub">(${done.length})</span></h2>${done.map(jobCard).join('')}` : ''}`;

  return res.status(200).send(`<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Job Board — Reseal Canada</title>
<style>
  :root{--yellow:#fdd635;--black:#121212;--ink:#141414;--muted:#6d6d6d;--line:#e6e6e6;}
  *{box-sizing:border-box;}
  body{margin:0;background:#f5f5f5;color:var(--ink);
       font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.6;}
  header{background:var(--black);color:#fff;padding:22px 0;}
  .wrap{max-width:980px;margin:0 auto;padding:0 18px;}
  header h1{margin:0;font-size:20px;font-weight:800;letter-spacing:-.02em;}
  header h1 span{color:var(--yellow);}
  header p{margin:4px 0 0;color:rgba(255,255,255,.6);font-size:13px;}
  main{padding:26px 0 60px;}
  h2{font-size:15px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin:0 0 14px;}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:30px;}
  .stat{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;}
  .statnum{font-size:26px;font-weight:800;line-height:1;}
  .statlbl{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-top:5px;}
  .job{background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin-bottom:12px;}
  .jhead{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;
         padding-bottom:14px;border-bottom:1px solid var(--line);margin-bottom:14px;}
  .jname{font-size:17px;font-weight:700;}
  .sub{color:var(--muted);font-size:12.5px;font-weight:400;}
  .jgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px 22px;font-size:14px;}
  .jgrid .wide{grid-column:1/-1;}
  .lbl{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:2px;}
  .jgrid a{color:var(--ink);}
  .visit{color:#7a5c00;font-weight:700;}
  .paid{color:#14622f;font-weight:700;}
  .acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;padding-top:15px;border-top:1px solid var(--line);}
  .act{background:var(--black);color:var(--yellow);text-decoration:none;font-size:12.5px;font-weight:700;
       padding:9px 16px;border-radius:8px;}
  .act:hover{background:#000;}
  .empty{background:#fff;border:1px dashed var(--line);border-radius:14px;padding:34px;
         text-align:center;color:var(--muted);}
  @media(max-width:560px){.jhead{flex-direction:column;}.jgrid{grid-template-columns:1fr;}}
</style></head><body>
<header><div class="wrap">
  <h1>Job <span>Board</span></h1>
  <p>Reseal Canada · ${jobs.length} job${jobs.length === 1 ? '' : 's'} · updated ${escHtml(new Date().toLocaleString('en-CA'))}</p>
</div></header>
<main><div class="wrap">
  <div class="stats">${summary}</div>
  ${body}
</div></main>
</body></html>`);
};
