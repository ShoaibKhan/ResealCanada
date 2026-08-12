/* ============================================================
   Reseal Canada — estimate engine + input validation.

   ⚠ DELIBERATE DESIGN CHOICE: this produces an ESTIMATE RANGE, never
   a fixed price. Driveway work is priced on size, surface condition
   and how much cracking there is — none of which can be judged
   reliably from a web form. Quoting a firm number here would mean
   either eating the difference or renegotiating with a customer who
   has already paid, which is worse than being upfront.

   So: the customer sees a range, pays a flat deposit to hold the
   date, and the real price is confirmed on site before work starts.
   The deposit is credited against the final invoice.

   ⚠ RATES PENDING OWNER CONFIRMATION — everything in the CONFIG block
   below is the only thing that needs editing to correct pricing.
   Driveway figures derive from the owner's stated "$100–150 per car
   spot" and "$0.60–0.70/sq ft". Pressure-washing and window-washing
   rates were never supplied and are marked PLACEHOLDER.
   ============================================================ */

/* ------------------------------------------------------------------
   CONFIG — the only block that should need editing
------------------------------------------------------------------ */

// Driveway sealing, by how many cars fit on the driveway. [low, high]
// Two cars is the smallest job taken — a single-car driveway isn't worth
// the travel, so it isn't offered.
const DRIVEWAY = {
  2: [230, 300],
  3: [330, 430],
  4: [430, 560],
};

// Long driveways can hold well over 5 cars, so past the car-spot bands we
// price on area instead. Owner's stated $0.60–0.70/sq ft.
const SQFT_RATE = [0.6, 0.7];
const SQFT_MIN = 400;    // below this the car-spot bands are the better fit
const SQFT_MAX = 12000;  // beyond this it's commercial — measure it in person

// Crack filling, included in the sealing job. `null` = must be seen in person.
const CRACKS = {
  none: [0, 0],
  some: [60, 120],
  lots: null,
};

// ⚠ PLACEHOLDER — owner has not supplied pressure washing rates.
// He prices interlock by the square foot; other surfaces unknown.
const PRESSURE = {
  small: [150, 220],   // one driveway / patio
  medium: [240, 350],  // driveway + walkways, or a deck
  large: [380, 550],   // multiple areas or full house siding
};

// ⚠ PLACEHOLDER — owner has not supplied window washing rates.
const WINDOWS = {
  1: [130, 190],
  2: [200, 300],
  3: [310, 460],
};
const WINDOW_INSIDE_MULT = 1.6; // inside + outside vs exterior only

// Flat deposit to hold a date. Credited in full against the final
// invoice. Flat rather than a percentage precisely because there is no
// firm price yet to take a percentage OF.
const BOOKING_DEPOSIT = 99;

// Sealer needs warm dry weather to cure. Months are 0-indexed.
const SEASON_START = 4; // May
const SEASON_END = 9;   // October

const POLICY_VERSION = '2026-08';

/* ------------------------------------------------------------------
   Labels
------------------------------------------------------------------ */

const SERVICES = {
  driveway: 'Driveway Sealing & Crack Filling',
  pressure: 'Pressure Washing',
  window: 'Window Washing',
};

const SIZE_LABELS = {
  2: 'Double — 2 cars',
  3: 'Double + apron — 3 cars',
  4: 'Large — 4 cars',
  sqft: 'Extra long — priced by area',
  unsure: 'Not sure of the size',
};

const CRACK_LABELS = {
  none: 'Good — barely any cracking',
  some: 'Fair — some visible cracks',
  lots: 'Poor — widespread cracking',
};

const AREA_LABELS = {
  small: 'Small — one area (driveway or patio)',
  medium: 'Medium — driveway plus walkways, or a deck',
  large: 'Large — several areas or full house siding',
};

const STOREY_LABELS = { 1: 'Single storey', 2: 'Two storeys', 3: 'Three storeys' };

const WINDOW_COUNT_LABELS = {
  under10: 'Up to 10 windows',
  '10to20': '10–20 windows',
  '20to30': '20–30 windows',
  over30: 'More than 30 windows',
};

const PROPERTY_LABELS = { residential: 'Residential', commercial: 'Commercial' };

/* ------------------------------------------------------------------
   Estimate
------------------------------------------------------------------ */

function round5(n) {
  return Math.round(n / 5) * 5;
}

/* Returns { needsVisit, low, high, lines[], depositAmount, ...labels }.

   needsVisit=true means we deliberately refuse to guess — commercial
   work, oversized driveways, or heavy cracking. Those take no payment
   and go straight to a free on-site quote. */
function computeEstimate(b) {
  const svc = String(b.service || '');
  const property = String(b.property || 'residential');
  const lines = [];

  const out = {
    svcKey: svc,
    svcLabel: SERVICES[svc] || svc,
    propertyLabel: PROPERTY_LABELS[property] || property,
    needsVisit: false,
    reason: '',
    low: 0,
    high: 0,
    lines,
    depositAmount: BOOKING_DEPOSIT,
    detailLabel: '',
  };

  // Commercial is always measured in person — lot sizes vary far too much.
  if (property === 'commercial') {
    out.needsVisit = true;
    out.reason = 'Commercial jobs are measured on site so the quote is accurate.';
    return out;
  }

  if (svc === 'driveway') {
    const size = String(b.size || '');
    const cracks = String(b.cracks || '');
    out.detailLabel = SIZE_LABELS[size] || '';
    out.crackLabel = CRACK_LABELS[cracks] || '';

    if (size === 'unsure') {
      out.needsVisit = true;
      out.reason = "No problem — we'll measure it when we come out, so the quote is accurate.";
      return out;
    }
    if (cracks === 'lots') {
      out.needsVisit = true;
      out.reason =
        'Heavy cracking needs a proper look — we will also tell you honestly if the ' +
        'surface needs repair rather than sealing.';
      return out;
    }

    const crack = CRACKS[cracks];
    if (!crack) {
      out.needsVisit = true;
      out.reason = 'We need a few more details before we can estimate this one.';
      return out;
    }

    if (size === 'sqft') {
      // Long driveways: area beats counting car spots
      const sqft = Math.round(Number(b.sqft));
      if (!Number.isFinite(sqft) || sqft < SQFT_MIN || sqft > SQFT_MAX) {
        out.needsVisit = true;
        out.reason = sqft > SQFT_MAX
          ? 'A driveway that size is measured on site so the quote is accurate.'
          : 'We need the approximate square footage before we can estimate this one.';
        return out;
      }
      out.sqft = sqft;
      out.detailLabel = `Extra long — approx. ${sqft.toLocaleString('en-CA')} sq ft`;
      lines.push({
        label: `Sealing — approx. ${sqft.toLocaleString('en-CA')} sq ft`,
        low: sqft * SQFT_RATE[0],
        high: sqft * SQFT_RATE[1],
      });
    } else {
      const base = DRIVEWAY[size];
      if (!base) {
        out.needsVisit = true;
        out.reason = 'We need a few more details before we can estimate this one.';
        return out;
      }
      lines.push({ label: `Sealing — ${SIZE_LABELS[size]}`, low: base[0], high: base[1] });
    }

    if (crack[1] > 0) {
      lines.push({ label: 'Crack filling (road-grade rubber)', low: crack[0], high: crack[1] });
    } else {
      lines.push({ label: 'Crack filling — not needed', low: 0, high: 0 });
    }
  } else if (svc === 'pressure') {
    const area = String(b.area || '');
    const band = PRESSURE[area];
    out.detailLabel = AREA_LABELS[area] || '';
    if (!band) {
      out.needsVisit = true;
      out.reason = 'We need a few more details before we can estimate this one.';
      return out;
    }
    lines.push({ label: `Pressure washing — ${AREA_LABELS[area]}`, low: band[0], high: band[1] });
    out.low = band[0];
    out.high = band[1];
  } else if (svc === 'window') {
    const storeys = String(b.storeys || '');
    const count = String(b.windows || '');
    const inside = String(b.inside || 'no') === 'yes';
    const band = WINDOWS[storeys];
    out.detailLabel = STOREY_LABELS[storeys] || '';
    out.windowCountLabel = WINDOW_COUNT_LABELS[count] || '';
    if (!band || !WINDOW_COUNT_LABELS[count]) {
      out.needsVisit = true;
      out.reason = 'We need a few more details before we can estimate this one.';
      return out;
    }

    // More windows pushes toward (and past) the top of the band
    const countMult = { under10: 0.85, '10to20': 1, '20to30': 1.25, over30: 1.5 }[count] || 1;
    let low = band[0] * countMult;
    let high = band[1] * countMult;
    lines.push({ label: `Window washing — ${STOREY_LABELS[storeys]}, ${WINDOW_COUNT_LABELS[count]}`, low: round5(low), high: round5(high) });

    if (inside) {
      const extraLow = low * (WINDOW_INSIDE_MULT - 1);
      const extraHigh = high * (WINDOW_INSIDE_MULT - 1);
      lines.push({ label: 'Interior glass, screens and tracks', low: round5(extraLow), high: round5(extraHigh) });
      low += extraLow;
      high += extraHigh;
    }
    out.insideLabel = inside ? 'Inside and outside' : 'Exterior only';
    out.low = low;
    out.high = high;
  } else {
    out.needsVisit = true;
    out.reason = 'Please choose a service.';
    return out;
  }

  // Round each line, then total the rounded lines — so what the customer
  // sees always adds up. Rounding the total separately can leave a
  // breakdown that's a few dollars off its own sum.
  out.lines = lines.map((l) => ({ ...l, low: round5(l.low), high: round5(l.high) }));
  out.low = out.lines.reduce((a, l) => a + l.low, 0);
  out.high = out.lines.reduce((a, l) => a + l.high, 0);
  return out;
}

/* ------------------------------------------------------------------
   Validation
------------------------------------------------------------------ */

const vName = (s) => typeof s === 'string' && s.trim().length >= 2 && s.trim().length <= 80;
const vEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s.trim()) && s.length <= 120;
const vPhone = (s) => typeof s === 'string' && (String(s).match(/\d/g) || []).length >= 10 && s.length <= 30;
const vAddr = (s) => typeof s === 'string' && s.trim().length >= 6 && s.trim().length <= 160;
const vNotes = (s) => s == null || (typeof s === 'string' && s.length <= 600);

function vDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(t)) return false;
  const today = new Date();
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const maxMs = todayMs + 400 * 24 * 60 * 60 * 1000;
  return t >= todayMs && t <= maxMs;
}

function inSeason(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const month = parseInt(dateStr.slice(5, 7), 10) - 1;
  return month >= SEASON_START && month <= SEASON_END;
}

/* Returns an error string, or null when the submission is acceptable. */
function validateBooking(b) {
  if (!b || typeof b !== 'object') return 'Missing booking details.';

  // Honeypot — a real browser never fills a hidden field
  if (String(b.company || '').trim() !== '') return 'Submission rejected.';

  // Nobody completes this form in under 8 seconds; bots do it instantly
  const elapsed = Number(b.elapsed);
  if (Number.isFinite(elapsed) && elapsed > 0 && elapsed < 8) return 'Submission rejected.';

  if (!vName(b.name)) return 'Please enter your full name.';
  if (!vEmail(b.email)) return 'Please enter a valid email address.';
  if (!vPhone(b.phone)) return 'Please enter a valid phone number.';
  if (!vAddr(b.addr)) return 'Please enter the service address.';
  if (!vNotes(b.notes)) return 'Notes are too long.';
  if (!SERVICES[String(b.service || '')]) return 'Please choose a service.';
  if (b.date && !vDate(b.date)) return 'Please choose a valid date.';

  if (b.consentTerms !== true && b.consentTerms !== 'true') {
    return 'Please accept the terms to continue.';
  }
  // Only demanded when an estimate was actually shown. Jobs routed to an
  // on-site quote never see a figure, so requiring them to agree one isn't
  // a final price would reject a perfectly valid request.
  if (!computeEstimate(b).needsVisit &&
      b.consentEstimate !== true && b.consentEstimate !== 'true') {
    return 'Please confirm you understand the estimate is not a final price.';
  }
  return null;
}

/* Proof-of-clickwrap, stored with the booking. */
function consentRecord(b, ip) {
  return {
    estimate: b.consentEstimate === true || b.consentEstimate === 'true',
    terms: b.consentTerms === true || b.consentTerms === 'true',
    policyVersion: POLICY_VERSION,
    acceptedAt: b.acceptedAt || new Date().toISOString(),
    recordedAt: new Date().toISOString(),
    ip: String(ip || '').split(',')[0].trim().slice(0, 45),
  };
}

function money(n) {
  return `$${Number(n || 0).toFixed(0)}`;
}

function estimateLabel(est) {
  return est.needsVisit ? 'On-site quote' : `${money(est.low)}–${money(est.high)}`;
}

module.exports = {
  computeEstimate, validateBooking, consentRecord,
  vName, vEmail, vPhone, vAddr, vDate, vNotes,
  inSeason, money, estimateLabel,
  SERVICES, SIZE_LABELS, CRACK_LABELS, AREA_LABELS, STOREY_LABELS,
  WINDOW_COUNT_LABELS, PROPERTY_LABELS,
  BOOKING_DEPOSIT, SEASON_START, SEASON_END, POLICY_VERSION,
  SQFT_RATE, SQFT_MIN, SQFT_MAX,
};
