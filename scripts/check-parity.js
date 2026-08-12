#!/usr/bin/env node
/* ============================================================
   Asserts the estimate shown in the browser (js/booking.js) matches
   the one the server computes (api/_lib/pricing.js), across every
   combination of answers the form can produce.

   This exists because a drift between the two is silent and nasty:
   the customer sees one number, the record stores another, and
   nobody notices until someone complains about the invoice.

   Run:  npm run check-parity
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// --- server side ---
const server = require(path.join(ROOT, 'api/_lib/pricing.js'));

// --- browser side: run booking.js with just enough of a DOM to load ---
const noop = () => {};
const fakeEl = {
  addEventListener: noop, setAttribute: noop, getAttribute: () => null,
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  closest: () => null, querySelector: () => null, querySelectorAll: () => [],
  style: {}, value: '', textContent: '', innerHTML: '',
};
const sandbox = {
  window: { addEventListener: noop, scrollTo: noop, pageYOffset: 0, location: { href: '' } },
  document: {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => fakeEl,
    head: { appendChild: noop },
  },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
  console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/booking.js'), 'utf8'), sandbox);

const client = sandbox.window.__bkEstimate;
if (typeof client !== 'function') {
  console.error('FAIL: js/booking.js did not expose window.__bkEstimate');
  process.exit(1);
}

/* ---------- Every combination the form can produce ---------- */
function* cases() {
  const properties = ['residential', 'commercial'];
  for (const property of properties) {
    for (const size of ['2', '3', '4', 'unsure']) {
      for (const cracks of ['none', 'some', 'lots']) {
        yield { property, service: 'driveway', size, cracks };
      }
    }
    // Area-priced long driveways, including the boundaries either side
    // of the accepted range
    for (const sqft of [399, 400, 401, 800, 1200, 2500, 7777, 11999, 12000, 12001, 0, -50, NaN, '', 'abc']) {
      for (const cracks of ['none', 'some', 'lots']) {
        yield { property, service: 'driveway', size: 'sqft', sqft, cracks };
      }
    }
    // A stale "1" from a cached page must degrade safely, not crash
    yield { property, service: 'driveway', size: '1', cracks: 'none' };
    yield { property, service: 'driveway', size: '5', cracks: 'none' };
    for (const area of ['small', 'medium', 'large']) {
      yield { property, service: 'pressure', area };
    }
    for (const storeys of ['1', '2', '3']) {
      for (const windows of ['under10', '10to20', '20to30', 'over30']) {
        for (const inside of ['no', 'yes']) {
          yield { property, service: 'window', storeys, windows, inside };
        }
      }
    }
  }
  // Incomplete answers must degrade to "needs a visit" on both sides
  yield { property: 'residential', service: 'driveway', size: '', cracks: '' };
  yield { property: 'residential', service: 'pressure', area: '' };
  yield { property: 'residential', service: 'window', storeys: '2', windows: '' };
  yield { property: 'residential', service: '' };
}

let checked = 0;
const failures = [];

for (const c of cases()) {
  const s = server.computeEstimate(c);
  const b = client(c);
  checked++;

  const mismatches = [];
  if (s.needsVisit !== b.needsVisit) mismatches.push(`needsVisit ${s.needsVisit} vs ${b.needsVisit}`);
  if (!s.needsVisit) {
    if (s.low !== b.low) mismatches.push(`low ${s.low} vs ${b.low}`);
    if (s.high !== b.high) mismatches.push(`high ${s.high} vs ${b.high}`);
    if (s.lines.length !== b.lines.length) {
      mismatches.push(`lines ${s.lines.length} vs ${b.lines.length}`);
    } else {
      s.lines.forEach((l, i) => {
        if (l.low !== b.lines[i].low || l.high !== b.lines[i].high || l.label !== b.lines[i].label) {
          mismatches.push(`line[${i}] "${l.label}" ${l.low}-${l.high} vs "${b.lines[i].label}" ${b.lines[i].low}-${b.lines[i].high}`);
        }
      });
    }
    // A breakdown that doesn't add up to its own total is a bug either way
    const sumLow = s.lines.reduce((a, l) => a + l.low, 0);
    const sumHigh = s.lines.reduce((a, l) => a + l.high, 0);
    if (sumLow !== s.low) mismatches.push(`server lines sum ${sumLow} != total ${s.low}`);
    if (sumHigh !== s.high) mismatches.push(`server lines sum ${sumHigh} != total ${s.high}`);
    if (s.low > s.high) mismatches.push(`low ${s.low} > high ${s.high}`);
  }
  if (s.depositAmount !== b.depositAmount) {
    mismatches.push(`deposit ${s.depositAmount} vs ${b.depositAmount}`);
  }

  if (mismatches.length) failures.push({ case: JSON.stringify(c), mismatches });
}

if (failures.length) {
  console.error(`\nPARITY FAILED — ${failures.length} of ${checked} combinations disagree:\n`);
  failures.slice(0, 20).forEach((f) => {
    console.error(`  ${f.case}`);
    f.mismatches.forEach((m) => console.error(`      ${m}`));
  });
  if (failures.length > 20) console.error(`  …and ${failures.length - 20} more`);
  console.error('\nFix: js/booking.js CONFIG must match api/_lib/pricing.js CONFIG exactly.\n');
  process.exit(1);
}

console.log(`Parity OK — ${checked} combinations, browser and server agree on every one.`);
