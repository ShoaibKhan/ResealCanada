(function ($) {
  "use strict";

  // Spinner
  var spinner = function () {
    setTimeout(function () {
      if ($("#spinner").length > 0) {
        $("#spinner").removeClass("show");
      }
    }, 1);
  };
  spinner();

  // Initiate the wowjs
  new WOW().init();

  // Sticky Navbar with Transition
  $(window).scroll(function () {
    const navbar = $(".sticky-top");
    const dropdown = $(".dropdown-menu");
    const threshold = $(window).width() <= 992 ? 40 : 54;

    if ($(this).scrollTop() > threshold) {
      navbar.addClass("bg-dark").css("position", "fixed");
      dropdown.addClass("bg-dark");
    } else {
      navbar.removeClass("bg-dark").css("position", "relative");
      dropdown.removeClass("bg-dark");
    }
  });

  // Back to top button
  $(window).scroll(function () {
    const threshold = $(window).width() <= 992 ? 972 : 1220;
    if ($(this).scrollTop() > threshold) {
      $(".back-to-top").fadeIn("slow");
    } else {
      $(".back-to-top").fadeOut("slow");
    }
  });
  $(".back-to-top").click(function () {
    $("html, body").animate({ scrollTop: 0 }, 50, "easeInOutExpo");
    return false;
  });

  // Facts counter
  $('[data-toggle="counter-up"]').counterUp({
    delay: 10,
    time: 2000,
  });

  // Header carousel
  $(".header-carousel").owlCarousel({
    autoplay: true,
    smartSpeed: 1500,
    items: 1,
    dots: true,
    loop: true,
    nav: true,
    navText: [
      '<i class="bi bi-chevron-left"></i>',
      '<i class="bi bi-chevron-right"></i>',
    ],
  });

  // Testimonials carousel
  $(".testimonial-carousel").owlCarousel({
    autoplay: true,
    smartSpeed: 1000,
    center: true,
    dots: false,
    loop: true,
    nav: true,
    navText: [
      '<i class="bi bi-arrow-left"></i>',
      '<i class="bi bi-arrow-right"></i>',
    ],
    responsive: {
      0: {
        items: 1,
      },
      768: {
        items: 2,
      },
    },
  });

  // Portfolio isotope and filter
  var portfolioIsotope = $(".portfolio-container").isotope({
    itemSelector: ".portfolio-item",
    layoutMode: "fitRows",
  });
  $("#portfolio-flters li").on("click", function () {
    $("#portfolio-flters li").removeClass("active");
    $("#portfolio-flters li").addClass("text-light");
    $(this).addClass("active");
    $(this).removeClass("text-light");

    portfolioIsotope.isotope({ filter: $(this).data("filter") });
  });

  // Quote Submit
  $("#quoteFormItem").submit(function (e) {
    e.preventDefault();

    const formData = $(this).serialize();

    $.ajax({
      type: "POST",
      url: "https://resealcanada.ca/submit-quote",
      data: formData,
      crossDomain: true,
      success: function (data) {
        $("#successMessage").text(data.message).css("color", "green");
        setTimeout(function () {
          $("#quoteFormItem")[0].reset();
          $("#successMessage").text("");
        }, 10000);
      },
      error: function () {
        $("#errorMessage").text("An error occurred, please try again.").css("color", "red");
      },
    });
  });
})(jQuery);
