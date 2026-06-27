/* =============================================================================
   JARVIS DESIGN SYSTEM — INTERACTIONS
   Sticky header · mobile nav · scroll reveal · animated counters · FAQ ·
   year stamp · smooth in-page nav close
   ========================================================================== */
(function () {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ----- Sticky header state ------------------------------------------- */
  const header = document.querySelector("[data-header]");
  if (header) {
    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ----- Mobile navigation --------------------------------------------- */
  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-nav]");
  if (toggle && nav) {
    const close = () => {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    };
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", close));
    window.addEventListener("keydown", (e) => e.key === "Escape" && close());
  }

  /* ----- Scroll reveal -------------------------------------------------- */
  const revealEls = document.querySelectorAll("[data-reveal]");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach((el) => el.classList.add("is-visible"));
  } else {
    const io = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    revealEls.forEach((el) => io.observe(el));
  }

  /* ----- Animated counters --------------------------------------------- */
  const counters = document.querySelectorAll("[data-count]");
  const animateCount = (el) => {
    const target = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || "";
    const decimals = (el.dataset.count.split(".")[1] || "").length;
    const duration = 1400;
    let start = null;
    const tick = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = (target * eased).toFixed(decimals) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  if (counters.length) {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      counters.forEach((el) => (el.textContent = el.dataset.count + (el.dataset.suffix || "")));
    } else {
      const co = new IntersectionObserver(
        (entries, obs) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              animateCount(entry.target);
              obs.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.6 }
      );
      counters.forEach((el) => co.observe(el));
    }
  }

  /* ----- FAQ: keep one open at a time (optional accordion behavior) ----- */
  const faqItems = document.querySelectorAll("[data-faq] details");
  faqItems.forEach((item) => {
    item.addEventListener("toggle", () => {
      if (item.open) {
        faqItems.forEach((other) => {
          if (other !== item) other.open = false;
        });
      }
    });
  });

  /* ----- Footer year ---------------------------------------------------- */
  const yearEl = document.querySelector("[data-year]");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
})();
