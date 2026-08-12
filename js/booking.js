/* ============================================================
   Four-section booking widget:
     1 Client Information → 2 Property Details → 3 Estimate → 4 Checkout

   ⚠ PARITY RULE: the CONFIG block below MUST stay identical to the one
   in api/_lib/pricing.js. The figures here are display only — the
   server recomputes everything and the browser never sends an amount —
   but a mismatch would show one estimate and record another. There's a
   parity check in scripts/check-parity.js; run it after any rate edit.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- CONFIG — mirrors api/_lib/pricing.js ---------- */
  var DRIVEWAY = { 2: [230, 300], 3: [330, 430], 4: [430, 560] };
  var SQFT_RATE = [0.6, 0.7];
  var SQFT_MIN = 400;
  var SQFT_MAX = 12000;
  var CRACKS = { none: [0, 0], some: [60, 120], lots: null };
  var PRESSURE = { small: [150, 220], medium: [240, 350], large: [380, 550] };
  var WINDOWS = { 1: [130, 190], 2: [200, 300], 3: [310, 460] };
  var WINDOW_INSIDE_MULT = 1.6;
  var WINDOW_COUNT_MULT = { under10: 0.85, '10to20': 1, '20to30': 1.25, over30: 1.5 };
  var BOOKING_DEPOSIT = 99;
  var SEASON_START = 4; // May
  var SEASON_END = 9;   // October

  /* ⚠ FLIP TO true ONCE HELCIM CREDENTIALS ARE SET IN VERCEL.
     While false the deposit option and the pay button still render — so
     the layout can be reviewed exactly as it will ship — but they are
     disabled and clearly marked, and the click handler refuses to fire.
     "Just send my request" is unaffected and fully working.
     The server refuses too (create-helcim-checkout returns "not
     configured"), so this is presentation, not security. */
  var PAYMENTS_ENABLED = false;

  var SERVICES = {
    driveway: 'Driveway Sealing & Crack Filling',
    pressure: 'Pressure Washing',
    window: 'Window Washing',
  };
  var SIZE_LABELS = {
    2: 'Double — 2 cars', 3: 'Double + apron — 3 cars', 4: 'Large — 4 cars',
    sqft: 'Extra long — priced by area', unsure: 'Not sure of the size',
  };
  var CRACK_LABELS = {
    none: 'Good — barely any cracking',
    some: 'Fair — some visible cracks',
    lots: 'Poor — widespread cracking',
  };
  var AREA_LABELS = {
    small: 'Small — one area (driveway or patio)',
    medium: 'Medium — driveway plus walkways, or a deck',
    large: 'Large — several areas or full house siding',
  };
  var STOREY_LABELS = { 1: 'Single storey', 2: 'Two storeys', 3: 'Three storeys' };
  var WINDOW_COUNT_LABELS = {
    under10: 'Up to 10 windows', '10to20': '10–20 windows',
    '20to30': '20–30 windows', over30: 'More than 30 windows',
  };
  var PROPERTY_LABELS = { residential: 'Residential', commercial: 'Commercial' };

  function round5(n) { return Math.round(n / 5) * 5; }
  function money(n) { return '$' + Number(n || 0).toFixed(0); }

  /* ---------- Estimate — mirrors computeEstimate() ---------- */
  function computeEstimate(b) {
    var lines = [];
    var out = {
      svcKey: b.service, svcLabel: SERVICES[b.service] || '',
      propertyLabel: PROPERTY_LABELS[b.property] || '',
      needsVisit: false, reason: '', low: 0, high: 0, lines: lines,
      depositAmount: BOOKING_DEPOSIT, detailLabel: '',
    };

    if (b.property === 'commercial') {
      out.needsVisit = true;
      out.reason = 'Commercial jobs are measured on site so the quote is accurate.';
      return out;
    }

    if (b.service === 'driveway') {
      out.detailLabel = SIZE_LABELS[b.size] || '';
      out.crackLabel = CRACK_LABELS[b.cracks] || '';
      if (b.size === 'unsure') {
        out.needsVisit = true;
        out.reason = "No problem — we'll measure it when we come out, so the quote is accurate.";
        return out;
      }
      if (b.cracks === 'lots') {
        out.needsVisit = true;
        out.reason = 'Heavy cracking needs a proper look — we will also tell you honestly if the ' +
          'surface needs repair rather than sealing.';
        return out;
      }
      var crack = CRACKS[b.cracks];
      if (!crack) {
        out.needsVisit = true;
        out.reason = 'We need a few more details before we can estimate this one.';
        return out;
      }

      if (b.size === 'sqft') {
        var sqft = Math.round(Number(b.sqft));
        if (!isFinite(sqft) || sqft < SQFT_MIN || sqft > SQFT_MAX) {
          out.needsVisit = true;
          out.reason = sqft > SQFT_MAX
            ? 'A driveway that size is measured on site so the quote is accurate.'
            : 'We need the approximate square footage before we can estimate this one.';
          return out;
        }
        out.sqft = sqft;
        out.detailLabel = 'Extra long — approx. ' + sqft.toLocaleString('en-CA') + ' sq ft';
        lines.push({
          label: 'Sealing — approx. ' + sqft.toLocaleString('en-CA') + ' sq ft',
          low: sqft * SQFT_RATE[0], high: sqft * SQFT_RATE[1],
        });
      } else {
        var base = DRIVEWAY[b.size];
        if (!base) {
          out.needsVisit = true;
          out.reason = 'We need a few more details before we can estimate this one.';
          return out;
        }
        lines.push({ label: 'Sealing — ' + SIZE_LABELS[b.size], low: base[0], high: base[1] });
      }

      if (crack[1] > 0) {
        lines.push({ label: 'Crack filling (road-grade rubber)', low: crack[0], high: crack[1] });
      } else {
        lines.push({ label: 'Crack filling — not needed', low: 0, high: 0 });
      }
    } else if (b.service === 'pressure') {
      var band = PRESSURE[b.area];
      out.detailLabel = AREA_LABELS[b.area] || '';
      if (!band) {
        out.needsVisit = true;
        out.reason = 'We need a few more details before we can estimate this one.';
        return out;
      }
      lines.push({ label: 'Pressure washing — ' + AREA_LABELS[b.area], low: band[0], high: band[1] });
    } else if (b.service === 'window') {
      var wband = WINDOWS[b.storeys];
      var mult = WINDOW_COUNT_MULT[b.windows];
      out.detailLabel = STOREY_LABELS[b.storeys] || '';
      out.windowCountLabel = WINDOW_COUNT_LABELS[b.windows] || '';
      if (!wband || !mult) {
        out.needsVisit = true;
        out.reason = 'We need a few more details before we can estimate this one.';
        return out;
      }
      var lo = wband[0] * mult, hi = wband[1] * mult;
      lines.push({
        label: 'Window washing — ' + STOREY_LABELS[b.storeys] + ', ' + WINDOW_COUNT_LABELS[b.windows],
        low: lo, high: hi,
      });
      if (b.inside === 'yes') {
        lines.push({
          label: 'Interior glass, screens and tracks',
          low: lo * (WINDOW_INSIDE_MULT - 1), high: hi * (WINDOW_INSIDE_MULT - 1),
        });
      }
      out.insideLabel = b.inside === 'yes' ? 'Inside and outside' : 'Exterior only';
    } else {
      out.needsVisit = true;
      out.reason = 'Please choose a service.';
      return out;
    }

    out.lines = lines.map(function (l) {
      return { label: l.label, low: round5(l.low), high: round5(l.high) };
    });
    out.low = out.lines.reduce(function (a, l) { return a + l.low; }, 0);
    out.high = out.lines.reduce(function (a, l) { return a + l.high; }, 0);
    return out;
  }

  // Exposed BEFORE the DOM guard below so scripts/check-parity.js can run
  // this exact function against the server's copy without a browser.
  if (typeof window !== 'undefined') window.__bkEstimate = computeEstimate;

  /* ---------- DOM ---------- */
  var root = document.getElementById('bkRoot');
  if (!root) return;

  var $ = function (id) { return document.getElementById(id); };
  var startedAt = Date.now();
  var step = 1;
  var lastEstimate = null;

  function val(id) { var e = $(id); return e ? e.value.trim() : ''; }
  function picked(name) {
    var el = root.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }

  function collect() {
    return {
      name: val('bk_name'), email: val('bk_email'), phone: val('bk_phone'),
      addr: val('bk_addr'), source: val('bk_source'),
      property: picked('property') || 'residential',
      service: picked('service'),
      size: picked('size'), sqft: val('bk_sqft'), cracks: picked('cracks'), area: picked('area'),
      storeys: picked('storeys'), windows: picked('windows'), inside: picked('inside') || 'no',
      date: val('bk_date'), notes: val('bk_notes'),
      company: val('bk_company'),
      elapsed: Math.round((Date.now() - startedAt) / 1000),
      consentEstimate: !!($('bk_c_estimate') && $('bk_c_estimate').checked),
      consentTerms: !!($('bk_c_terms') && $('bk_c_terms').checked),
      acceptedAt: new Date().toISOString(),
    };
  }

  /* ---------- Option cards ---------- */
  root.querySelectorAll('.bk-opt input').forEach(function (input) {
    input.addEventListener('change', function () {
      var group = input.closest('.bk-opts');
      if (group) {
        group.querySelectorAll('.bk-opt').forEach(function (o) { o.classList.remove('sel'); });
      }
      input.closest('.bk-opt').classList.add('sel');
      if (input.name === 'service') showServiceBlock(input.value);
      if (input.name === 'size') showSqftField(input.value === 'sqft');
      if (input.name === 'service' || input.name === 'property') clearHint('h_service');
      else clearHint('h_' + input.name);
    });
  });

  // The square-footage box only makes sense for the "extra long" option
  function showSqftField(on) {
    var wrap = $('bk_sqft_wrap');
    if (wrap) wrap.style.display = on ? '' : 'none';
    if (!on) clearHint('h_sqft');
  }

  function showServiceBlock(svc) {
    root.querySelectorAll('.bk-svc-block').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-svc') === svc);
    });
  }

  /* ---------- Validation ---------- */
  function showHint(id, on) {
    var h = $(id);
    if (h) h.classList.toggle('show', !!on);
    var field = h && h.closest('.bk-field');
    var input = field && field.querySelector('input:not([type=radio]), select, textarea');
    if (input) input.classList.toggle('err', !!on);
  }
  function clearHint(id) { showHint(id, false); }

  function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s); }
  function validPhone(s) { return (s.match(/\d/g) || []).length >= 10; }

  function validateStep1() {
    var b = collect(), ok = true;
    if (b.name.length < 2) { showHint('h_name', true); ok = false; } else clearHint('h_name');
    if (!validPhone(b.phone)) { showHint('h_phone', true); ok = false; } else clearHint('h_phone');
    if (!validEmail(b.email)) { showHint('h_email', true); ok = false; } else clearHint('h_email');
    if (b.addr.length < 6) { showHint('h_addr', true); ok = false; } else clearHint('h_addr');
    return ok;
  }

  function validateStep2() {
    var b = collect(), ok = true;
    if (!b.service) { showHint('h_service', true); ok = false; } else clearHint('h_service');

    if (b.service === 'driveway') {
      if (!b.size) { showHint('h_size', true); ok = false; } else clearHint('h_size');
      // "Extra long" needs a usable number, otherwise it silently falls
      // through to an on-site quote and the customer never learns why
      if (b.size === 'sqft') {
        var n = Math.round(Number(b.sqft));
        if (!isFinite(n) || n < SQFT_MIN) { showHint('h_sqft', true); ok = false; }
        else clearHint('h_sqft');
      } else clearHint('h_sqft');
      if (!b.cracks) { showHint('h_cracks', true); ok = false; } else clearHint('h_cracks');
    } else if (b.service === 'pressure') {
      if (!b.area) { showHint('h_area', true); ok = false; } else clearHint('h_area');
    } else if (b.service === 'window') {
      if (!b.storeys) { showHint('h_storeys', true); ok = false; } else clearHint('h_storeys');
      if (!b.windows) { showHint('h_windows', true); ok = false; } else clearHint('h_windows');
    }
    return ok;
  }

  function showErr(id, msg) {
    var e = $(id);
    if (!e) return;
    e.textContent = msg || '';
    e.classList.toggle('show', !!msg);
  }

  /* ---------- Estimate panel ---------- */
  function renderEstimate() {
    var b = collect();
    var est = computeEstimate(b);
    lastEstimate = est;

    var box = $('bkEstBox'), visit = $('bkVisitBox');

    if (est.needsVisit) {
      box.style.display = 'none';
      visit.style.display = 'block';
      $('bkVisitReason').textContent = est.reason;
    } else {
      visit.style.display = 'none';
      box.style.display = 'block';
      $('bkEstRange').innerHTML = money(est.low) + '–' + money(est.high) +
        ' <span class="plus">+ HST</span>';
      $('bkEstLines').innerHTML = est.lines.map(function (l) {
        return '<div class="bk-est-line"><span>' + esc(l.label) + '</span><span>' +
          (l.high > 0 ? money(l.low) + '–' + money(l.high) : 'Included') + '</span></div>';
      }).join('');

      var spec = [
        ['Service', est.svcLabel],
        ['Property', est.propertyLabel],
        ['Details', est.detailLabel],
        ['Cracking', est.crackLabel],
        ['Windows', est.windowCountLabel],
        ['Coverage', est.insideLabel],
        ['Preferred date', b.date ? fmtDate(b.date) : 'Not specified'],
      ].filter(function (r) { return r[1]; });
      $('bkEstSpec').innerHTML = spec.map(function (r) {
        return '<div class="r"><span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span></div>';
      }).join('');
    }

    // Everything tied to a figure disappears when there isn't one: the
    // deposit option, the pay buttons, and the "this is only an estimate"
    // consent — which reads as nonsense with no estimate above it.
    var hasEstimate = !est.needsVisit;
    var payBlock = $('bkPayBlock');
    var optDeposit = $('bkOptDeposit');
    var estConsent = $('bkConsentEstimate');
    var checkoutNote = $('bkCheckoutNote');

    payBlock.style.display = hasEstimate ? '' : 'none';
    optDeposit.style.display = hasEstimate ? '' : 'none';
    if (estConsent) estConsent.style.display = hasEstimate ? '' : 'none';

    // Deposits are switched off until the processors are configured
    var offNote = $('bkPayOffNote');
    if (offNote) offNote.style.display = (hasEstimate && !PAYMENTS_ENABLED) ? '' : 'none';
    if (optDeposit) optDeposit.classList.toggle('is-off', !PAYMENTS_ENABLED);
    if (checkoutNote) {
      checkoutNote.textContent = hasEstimate
        ? 'Two ways to finish — both send your details straight to us.'
        : 'No deposit is taken for jobs we haven\'t seen. Send your request and we\'ll arrange a free on-site quote.';
    }
    if (hasEstimate) {
      $('bkDepositAmt').textContent = money(BOOKING_DEPOSIT);
      $('bkPayCardAmt').textContent = money(BOOKING_DEPOSIT);
    }
    syncConsent();
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(d) {
    var t = Date.parse(d + 'T00:00:00Z');
    if (!isFinite(t)) return d;
    return new Date(t).toLocaleDateString('en-CA', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
    });
  }

  /* ---------- Navigation ---------- */
  function goto(n) {
    if (n === 3) renderEstimate();
    step = n;
    root.querySelectorAll('.bk-panel').forEach(function (p) {
      p.classList.toggle('active', Number(p.getAttribute('data-panel')) === n);
    });
    root.querySelectorAll('.bk-step').forEach(function (s) {
      var i = Number(s.getAttribute('data-step'));
      s.classList.toggle('active', i === n);
      s.classList.toggle('done', i < n);
    });
    root.querySelectorAll('.bk-bar').forEach(function (b) {
      b.classList.toggle('done', Number(b.getAttribute('data-bar')) < n);
    });

    var top = root.getBoundingClientRect().top + window.pageYOffset - 100;
    window.scrollTo({ top: top, behavior: 'smooth' });
  }

  root.querySelectorAll('[data-next]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = Number(btn.getAttribute('data-next'));
      showErr('err1', ''); showErr('err2', '');
      if (target === 2 && !validateStep1()) {
        showErr('err1', 'Please fill in the highlighted fields.');
        return;
      }
      if (target === 3 && !validateStep2()) {
        showErr('err2', 'Please answer the highlighted questions.');
        return;
      }
      goto(target);
    });
  });

  root.querySelectorAll('[data-back]').forEach(function (btn) {
    btn.addEventListener('click', function () { goto(Number(btn.getAttribute('data-back'))); });
  });

  /* ---------- Preferred date + season note ---------- */
  var dateEl = $('bk_date');
  if (dateEl) {
    var today = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var iso = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    var maxD = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
    dateEl.setAttribute('min', iso(today));
    dateEl.setAttribute('max', iso(maxD));

    var noteEl = $('bkDateNote'), noteText = $('bkDateNoteText');
    var defaultNote = noteText ? noteText.textContent : '';
    dateEl.addEventListener('change', function () {
      if (!noteEl) return;
      if (!dateEl.value) {
        noteEl.classList.remove('notice--warn');
        noteText.textContent = defaultNote;
        return;
      }
      // Parse as local — new Date('2026-05-01') would be UTC midnight
      var month = parseInt(dateEl.value.split('-')[1], 10) - 1;
      if (month < SEASON_START || month > SEASON_END) {
        noteEl.classList.add('notice--warn');
        noteText.textContent = "That date falls outside our sealing season (May–October) — sealer " +
          "won't cure properly in the cold. Send the request through and we'll book you in for the " +
          "spring, or pick a date within the season.";
      } else {
        noteEl.classList.remove('notice--warn');
        noteText.textContent = defaultNote;
      }
    });
  }

  /* ---------- Checkout: consent gating ---------- */
  // The estimate box only counts when an estimate is actually on screen.
  // Mirrors the same rule in api/_lib/pricing.js validateBooking().
  function consentOk() {
    var needsEstimateConsent = lastEstimate ? !lastEstimate.needsVisit : true;
    return $('bk_c_terms').checked &&
      (!needsEstimateConsent || $('bk_c_estimate').checked);
  }
  function syncConsent() {
    var ok = consentOk();
    var send = $('bkSubmitNoPay');
    if (send) send.disabled = !ok;
    // The pay button needs consent AND payments switched on
    var pay = $('bkPayCard');
    if (pay) pay.disabled = !ok || !PAYMENTS_ENABLED;
    if (ok) showErr('err4', '');
  }
  ['bk_c_estimate', 'bk_c_terms'].forEach(function (id) {
    var el = $(id);
    if (el) el.addEventListener('change', syncConsent);
  });
  syncConsent();

  // Highlight whichever checkout route they're hovering toward
  var optDep = $('bkOptDeposit'), optNo = $('bkOptNoPay');
  function markOpt(dep) {
    if (optDep) optDep.classList.toggle('sel', dep);
    if (optNo) optNo.classList.toggle('sel', !dep);
  }
  var payHover = $('bkPayCard');
  if (payHover) payHover.addEventListener('mouseenter', function () { markOpt(true); });
  var noPayBtn = $('bkSubmitNoPay');
  if (noPayBtn) noPayBtn.addEventListener('mouseenter', function () { markOpt(false); });

  /* ---------- Success ---------- */
  function showSuccess(title, text, ref) {
    $('bkForm').style.display = 'none';
    root.querySelector('.bk-steps').style.display = 'none';
    var s = $('bkSuccess');
    $('bkSuccessTitle').textContent = title;
    $('bkSuccessText').textContent = text;
    $('bkSuccessRef').textContent = ref ? 'Reference ' + ref : '';
    s.classList.add('show');
    window.scrollTo({ top: root.getBoundingClientRect().top + window.pageYOffset - 100, behavior: 'smooth' });
  }

  /* ---------- Submit without payment ---------- */
  if (noPayBtn) {
    noPayBtn.addEventListener('click', function () {
      if (!consentOk()) { showErr('err4', 'Please tick both boxes to continue.'); return; }
      var original = noPayBtn.textContent;
      noPayBtn.disabled = true;
      noPayBtn.textContent = 'Sending…';
      showErr('err4', '');

      fetch('/api/submit-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collect()),
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error((res.j && res.j.error) || 'failed');
          showSuccess('Request received',
            res.j.message || "Thanks — we'll be back to you within 2 business days.", res.j.ref);
        })
        .catch(function (e) {
          noPayBtn.disabled = false;
          noPayBtn.textContent = original;
          showErr('err4', (e && e.message) ||
            'Something went wrong. Please call 647-706-5123 and we\'ll sort it out.');
        });
    });
  }

  /* ---------- Pay deposit by card (HelcimPay.js) ---------- */
  var cardBtn = $('bkPayCard');
  if (cardBtn) {
    cardBtn.addEventListener('click', function () {
      if (!PAYMENTS_ENABLED) return;
      if (!consentOk()) { showErr('err4', 'Please tick both boxes to continue.'); return; }
      var original = cardBtn.innerHTML;
      cardBtn.disabled = true;
      cardBtn.textContent = 'Opening secure checkout…';
      showErr('err4', '');

      fetch('/api/create-helcim-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collect()),
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok || !res.j || !res.j.checkoutToken) {
            throw new Error((res.j && res.j.error) || 'checkout failed');
          }
          try { localStorage.setItem('rscRef', res.j.ref); } catch (e) {}
          openHelcim(res.j.checkoutToken);
          cardBtn.innerHTML = original;
          cardBtn.disabled = false;
        })
        .catch(function (e) {
          cardBtn.innerHTML = original;
          cardBtn.disabled = false;
          showErr('err4', (e && e.message) ||
            "We could not open card checkout. Please call 647-706-5123 and we'll take your " +
            "deposit over the phone, or send your request without one.");
        });
    });
  }

  var LOAD_FAIL = "Card checkout could not load. Please call 647-706-5123, or send your " +
    'request without a deposit and we\'ll be in touch.';

  function openHelcim(token) {
    function go() {
      try { appendHelcimPayIframe(token); }
      catch (e) { showErr('err4', LOAD_FAIL); }
    }
    if (typeof appendHelcimPayIframe === 'function') { go(); return; }
    var s = document.createElement('script');
    s.src = 'https://secure.helcim.app/helcim-pay/services/start.js';
    s.onload = go;
    s.onerror = function () { showErr('err4', LOAD_FAIL); };
    document.head.appendChild(s);
  }

  // HelcimPay.js posts the result back to the window under an event
  // name of "helcim-pay-js-<token>".
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (typeof d.eventName !== 'string' || d.eventName.indexOf('helcim-pay-js') !== 0) return;

    if (d.eventStatus === 'SUCCESS') {
      try { if (typeof removeHelcimPayIframe === 'function') removeHelcimPayIframe(); } catch (e) {}
      var ref = '';
      try { ref = localStorage.getItem('rscRef') || ''; } catch (e) {}
      window.location.href = '/payment-success?ref=' + encodeURIComponent(ref);
    } else if (d.eventStatus === 'ABORTED') {
      try { if (typeof removeHelcimPayIframe === 'function') removeHelcimPayIframe(); } catch (e) {}
      showErr('err4', 'Card payment was cancelled — no charge was made. You can try again, ' +
        'or send your request without a deposit.');
    }
  });
})();
