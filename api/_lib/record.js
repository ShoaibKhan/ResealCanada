/* ============================================================
   Builds the normalized job record that every entry point stores.

   One place, because two endpoints create jobs (quote request and
   Helcim checkout) and a field drifting between them is exactly the
   kind of bug nobody notices until an owner alert comes through with
   a blank address.
   ============================================================ */

const { computeEstimate, consentRecord } = require('./pricing');

function buildJobRecord(b, extra, ip) {
  const est = computeEstimate(b);
  return {
    // Who
    name: String(b.name).trim().slice(0, 80),
    email: String(b.email).trim().toLowerCase().slice(0, 120),
    phone: String(b.phone).trim().slice(0, 30),
    addr: String(b.addr).trim().slice(0, 160),

    // What
    service: String(b.service),
    property: String(b.property || 'residential'),
    size: b.size ? String(b.size) : '',
    sqft: b.sqft ? String(b.sqft) : '',
    cracks: b.cracks ? String(b.cracks) : '',
    area: b.area ? String(b.area) : '',
    storeys: b.storeys ? String(b.storeys) : '',
    windows: b.windows ? String(b.windows) : '',
    inside: b.inside ? String(b.inside) : 'no',

    // When
    date: b.date ? String(b.date) : '',
    notes: String(b.notes || 'None').trim().slice(0, 600) || 'None',
    source: String(b.source || '').trim().slice(0, 60),

    // Estimate snapshot — frozen at submission so the record always
    // reflects what the customer was actually shown, even if rates change
    svcKey: est.svcKey,
    svcLabel: est.svcLabel,
    propertyLabel: est.propertyLabel,
    detailLabel: est.detailLabel,
    crackLabel: est.crackLabel || '',
    windowCountLabel: est.windowCountLabel || '',
    insideLabel: est.insideLabel || '',
    needsVisit: est.needsVisit,
    reason: est.reason,
    low: est.low,
    high: est.high,
    lines: est.lines,
    depositAmount: est.depositAmount,

    consent: consentRecord(b, ip),
    ...extra,
  };
}

module.exports = { buildJobRecord };
