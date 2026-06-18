/* ============================================================
   V-AI landing — interactions & animations (vanilla, no deps)
   ============================================================ */
(function () {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* ---------- Loader ---------- */
  window.addEventListener("load", () => {
    const loader = document.getElementById("loader");
    if (!loader) return;
    setTimeout(() => loader.classList.add("is-done"), reduceMotion ? 0 : 1400);
  });

  /* ---------- Split hero title into animated words ---------- */
  document.querySelectorAll("[data-split]").forEach((el) => {
    const words = el.textContent.split(" ");
    el.innerHTML = words
      .map((w) => `<span class="word">${w}</span>`)
      .join(" ");
  });
  // Trigger hero entrance
  requestAnimationFrame(() => {
    setTimeout(() => {
      document.querySelector(".hero__title")?.classList.add("is-in");
    }, reduceMotion ? 0 : 1500);
  });

  /* ---------- Scroll-reveal via IntersectionObserver ---------- */
  const revealEls = document.querySelectorAll("[data-reveal]");
  revealEls.forEach((el) => {
    const delay = el.getAttribute("data-reveal-delay");
    if (delay) el.style.setProperty("--reveal-delay", delay + "s");
  });
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
          // kick off counters when stats reveal
          if (entry.target.querySelector?.("[data-count]") || entry.target.matches("[data-count]")) {
            // handled separately below
          }
        }
      });
    },
    { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
  );
  revealEls.forEach((el) => io.observe(el));

  /* ---------- Animated stat counters ---------- */
  const counters = document.querySelectorAll("[data-count]");
  const countObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = parseFloat(el.getAttribute("data-count"));
        const suffix = el.getAttribute("data-suffix") || "";
        const duration = 1600;
        if (reduceMotion) {
          el.textContent = target + suffix;
          countObserver.unobserve(el);
          return;
        }
        const start = performance.now();
        const tick = (now) => {
          const p = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
          el.textContent = Math.round(target * eased) + suffix;
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        countObserver.unobserve(el);
      });
    },
    { threshold: 0.5 }
  );
  counters.forEach((el) => countObserver.observe(el));

  /* ---------- Nav scrolled state + scroll progress ---------- */
  const nav = document.getElementById("nav");
  const progress = document.getElementById("scrollProgress");
  const onScroll = () => {
    const y = window.scrollY;
    nav?.classList.toggle("is-scrolled", y > 40);
    if (progress) {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = (h > 0 ? (y / h) * 100 : 0) + "%";
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Cursor glow ---------- */
  if (isFinePointer && !reduceMotion) {
    const glow = document.getElementById("cursorGlow");
    let gx = window.innerWidth / 2,
      gy = window.innerHeight / 2,
      cx = gx,
      cy = gy;
    window.addEventListener("mousemove", (e) => {
      gx = e.clientX;
      gy = e.clientY;
    });
    const animateGlow = () => {
      cx += (gx - cx) * 0.12;
      cy += (gy - cy) * 0.12;
      if (glow) glow.style.transform = `translate(${cx}px, ${cy}px)`;
      requestAnimationFrame(animateGlow);
    };
    animateGlow();
  }

  /* ---------- Magnetic buttons ---------- */
  if (isFinePointer && !reduceMotion) {
    document.querySelectorAll("[data-magnetic]").forEach((btn) => {
      const strength = 0.35;
      btn.addEventListener("mousemove", (e) => {
        const r = btn.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top - r.height / 2;
        btn.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.transform = "translate(0,0)";
      });
    });
  }

  /* ---------- 3D tilt on feature cards ---------- */
  if (isFinePointer && !reduceMotion) {
    document.querySelectorAll("[data-tilt]").forEach((card) => {
      const max = 8;
      card.addEventListener("mousemove", (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        const rx = (0.5 - py) * max;
        const ry = (px - 0.5) * max;
        card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-4px)`;
      });
      card.addEventListener("mouseleave", () => {
        card.style.transform = "";
      });
    });
  }

  /* ---------- Particle network on canvas ---------- */
  (function particles() {
    const canvas = document.getElementById("particles");
    if (!canvas || reduceMotion) return;
    const ctx = canvas.getContext("2d");
    let w, h, dpr, pts;
    const COUNT = window.innerWidth < 700 ? 38 : 80;
    const LINK_DIST = 130;
    const mouse = { x: -9999, y: -9999 };

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.width = innerWidth * dpr;
      h = canvas.height = innerHeight * dpr;
      canvas.style.width = innerWidth + "px";
      canvas.style.height = innerHeight + "px";
    }
    function init() {
      pts = Array.from({ length: COUNT }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35 * dpr,
        vy: (Math.random() - 0.5) * 0.35 * dpr,
        r: (Math.random() * 1.6 + 0.6) * dpr,
      }));
    }
    function step() {
      ctx.clearRect(0, 0, w, h);
      const link = LINK_DIST * dpr;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 140, 50, 0.85)";
        ctx.fill();

        for (let j = i + 1; j < pts.length; j++) {
          const q = pts[j];
          const dx = p.x - q.x,
            dy = p.y - q.y;
          const d = Math.hypot(dx, dy);
          if (d < link) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = `rgba(255, 122, 24, ${0.18 * (1 - d / link)})`;
            ctx.lineWidth = dpr * 0.6;
            ctx.stroke();
          }
        }
        // mouse interaction
        const mdx = p.x - mouse.x,
          mdy = p.y - mouse.y;
        const md = Math.hypot(mdx, mdy);
        if (md < link * 1.4) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.strokeStyle = `rgba(255, 157, 60, ${0.25 * (1 - md / (link * 1.4))})`;
          ctx.lineWidth = dpr * 0.7;
          ctx.stroke();
        }
      }
      requestAnimationFrame(step);
    }
    window.addEventListener("mousemove", (e) => {
      mouse.x = e.clientX * dpr;
      mouse.y = e.clientY * dpr;
    });
    window.addEventListener("mouseout", () => {
      mouse.x = -9999;
      mouse.y = -9999;
    });
    window.addEventListener("resize", () => {
      resize();
      init();
    });
    resize();
    init();
    step();
  })();
})();
