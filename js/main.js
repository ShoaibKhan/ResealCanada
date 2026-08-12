(function ($) {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------------
     Spinner
  --------------------------------------------------------------- */
  setTimeout(function () {
    $("#spinner").removeClass("show");
  }, 1);

  /* ---------------------------------------------------------------
     Scroll reveals
  --------------------------------------------------------------- */
  if (!reduceMotion && typeof WOW === "function") {
    new WOW({ mobile: false }).init();
  } else {
    // WOW ships elements at opacity:0 — without it running, force them visible
    $(".wow").css({ visibility: "visible", opacity: 1 });
  }

  /* ---------------------------------------------------------------
     Navbar: transparent over the hero, pinned + solid once scrolled
  --------------------------------------------------------------- */
  var $nav = $(".navbar");
  var ticking = false;

  function onScroll() {
    var y = window.pageYOffset;

    $nav.toggleClass("is-stuck", y > 90);
    $(".back-to-top").toggle(y > 500);

    ticking = false;
  }

  $(window).on("scroll", function () {
    if (!ticking) {
      window.requestAnimationFrame(onScroll);
      ticking = true;
    }
  });
  onScroll();

  // Close the mobile menu after tapping a link
  $(".navbar-nav .nav-link, .navbar .dropdown-item").on("click", function () {
    var $collapse = $(".navbar-collapse");
    if ($collapse.hasClass("show")) {
      $collapse.collapse("hide");
    }
  });

  /* ---------------------------------------------------------------
     Back to top
  --------------------------------------------------------------- */
  $(".back-to-top").on("click", function (e) {
    e.preventDefault();
    $("html, body").animate({ scrollTop: 0 }, reduceMotion ? 0 : 400, "easeInOutExpo");
    return false;
  });

  /* ---------------------------------------------------------------
     Testimonials
  --------------------------------------------------------------- */
  // No `center` — it offsets the row and was the main reason this looked messy.
  $(".testimonial-carousel").owlCarousel({
    autoplay: !reduceMotion,
    autoplayHoverPause: true,
    autoplayTimeout: 6000,
    smartSpeed: 700,
    margin: 0,
    dots: true,
    loop: true,
    nav: true,
    navText: [
      '<i class="bi bi-arrow-left"></i>',
      '<i class="bi bi-arrow-right"></i>',
    ],
    responsive: {
      0: { items: 1 },
      768: { items: 2 },
      1200: { items: 3 },
    },
  });

  /* ---------------------------------------------------------------
     Project filter
  --------------------------------------------------------------- */
  var $portfolio = $(".portfolio-container");
  if ($portfolio.length) {
    var portfolioIsotope = $portfolio.isotope({
      itemSelector: ".portfolio-item",
      layoutMode: "fitRows",
    });

    $("#portfolio-flters li").on("click", function () {
      $("#portfolio-flters li").removeClass("active");
      $(this).addClass("active");
      portfolioIsotope.isotope({ filter: $(this).data("filter") });
    });
  }

  /* ---------------------------------------------------------------
     Preferred date — sealing season only

     Sealer needs warm, dry weather to cure, so the working season is
     May–October. Rather than blocking the field, we let them pick and
     explain what happens, so nobody hits a silent dead end.
  --------------------------------------------------------------- */
  var SEASON_START = 4; // May  (months are 0-indexed)
  var SEASON_END = 9;   // October

  var $date = $("#q_date");
  if ($date.length) {
    var today = new Date();
    var pad = function (n) { return String(n).padStart(2, "0"); };
    var iso = function (d) {
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    };

    // No dates in the past, and nothing more than a year out
    var maxDate = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
    $date.attr({ min: iso(today), max: iso(maxDate) });

    var $note = $("#dateNote");
    var $noteText = $("#dateNoteText");
    var defaultNote = $noteText.text();

    $date.on("change", function () {
      var val = this.value;
      if (!val) {
        $note.removeClass("notice--warn");
        $noteText.text(defaultNote);
        return;
      }

      // Parse as local, not UTC — new Date("2026-05-01") is UTC midnight
      var parts = val.split("-");
      var month = parseInt(parts[1], 10) - 1;

      if (month < SEASON_START || month > SEASON_END) {
        $note.addClass("notice--warn");
        $noteText.html(
          "That date falls outside our sealing season (May–October) — sealer won't cure " +
            "properly in the cold. You're welcome to send the request through and we'll " +
            "book you in for the spring, or pick a date within the season."
        );
      } else {
        $note.removeClass("notice--warn");
        $noteText.text(defaultNote);
      }
    });
  }

  /* ---------------------------------------------------------------
     Quote form
  --------------------------------------------------------------- */
  $("#quoteFormItem").on("submit", function (e) {
    e.preventDefault();

    var $form = $(this);
    var $btn = $("#submit");
    var original = $btn.html();

    $("#successMessage, #errorMessage").text("");
    $btn.prop("disabled", true).html('Sending<i class="fa fa-spinner fa-spin ms-2"></i>');

    $.ajax({
      type: "POST",
      url: $form.attr("action"),
      data: $form.serialize(),
      success: function (data) {
        $("#successMessage").text(
          (data && data.message) ||
            "Thanks — your request is in. We'll be in touch within 2 business days."
        );
        $form[0].reset();
        setTimeout(function () {
          $("#successMessage").text("");
        }, 12000);
      },
      error: function () {
        $("#errorMessage").text(
          "Something went wrong sending that. Please call us at 647-706-5123 and we'll sort it out."
        );
      },
      complete: function () {
        $btn.prop("disabled", false).html(original);
      },
    });
  });
})(jQuery);
