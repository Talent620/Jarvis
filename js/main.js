/* ============================================================
   V-AI v2 — interactions (vanilla, zero dependencies)
   ============================================================ */
(function () {
  "use strict";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

  /* ---------- Loader with counter ---------- */
  window.addEventListener("load", () => {
    const loader = document.getElementById("loader");
    const count = document.getElementById("loaderCount");
    if (!loader) return;
    const dur = reduce ? 0 : 1200;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / dur, 1);
      if (count) count.textContent = Math.round(p * 100) + "%";
      if (p < 1) requestAnimationFrame(tick);
      else loader.classList.add("is-done");
    };
    requestAnimationFrame(tick);
  });

  /* ---------- Split hero title ---------- */
  document.querySelectorAll("[data-split]").forEach((el) => {
    el.innerHTML = el.textContent
      .split(" ")
      .map((w) => `<span class="word">${w}</span>`)
      .join(" ");
  });
  setTimeout(() => document.querySelector(".hero__title")?.classList.add("is-in"), reduce ? 0 : 1300);

  /* ---------- Reveal ---------- */
  const revealEls = document.querySelectorAll("[data-reveal]");
  revealEls.forEach((el) => {
    const d = el.getAttribute("data-reveal-delay");
    if (d) el.style.setProperty("--reveal-delay", d + "s");
  });
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } }),
    { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
  );
  revealEls.forEach((el) => io.observe(el));

  /* ---------- Text scramble on reveal ---------- */
  const CH = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#%&@*</>";
  function scramble(el) {
    if (reduce) return;
    const text = el.dataset.text;
    const dur = 850;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min((now - start) / dur, 1);
      const reveal = Math.floor(p * text.length);
      let out = "";
      for (let i = 0; i < text.length; i++) {
        if (i < reveal || text[i] === " ") out += text[i];
        else out += CH[(Math.random() * CH.length) | 0];
      }
      el.textContent = out;
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = text;
    };
    requestAnimationFrame(step);
  }
  const scrambleIO = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.dataset.text = e.target.textContent; scramble(e.target); scrambleIO.unobserve(e.target); }
    }),
    { threshold: 0.6 }
  );
  document.querySelectorAll("[data-scramble]").forEach((el) => scrambleIO.observe(el));

  /* ---------- Stat counters ---------- */
  const countIO = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target, target = parseFloat(el.dataset.count), suf = el.dataset.suffix || "";
      if (reduce) { el.textContent = target + suf; countIO.unobserve(el); return; }
      const start = performance.now(), dur = 1500;
      const tick = (now) => {
        const p = Math.min((now - start) / dur, 1);
        el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))) + suf;
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      countIO.unobserve(el);
    }),
    { threshold: 0.5 }
  );
  document.querySelectorAll("[data-count]").forEach((el) => countIO.observe(el));

  /* ---------- Nav + progress + active dot ---------- */
  const nav = document.getElementById("nav");
  const progress = document.getElementById("scrollProgress");
  const dots = [...document.querySelectorAll(".dots .dot")];
  const sections = dots.map((d) => document.querySelector(d.getAttribute("href")));
  function onScroll() {
    const y = window.scrollY;
    nav?.classList.toggle("is-scrolled", y > 40);
    if (progress) {
      const h = document.documentElement.scrollHeight - innerHeight;
      progress.style.width = (h > 0 ? (y / h) * 100 : 0) + "%";
    }
    // active dot
    const mid = y + innerHeight / 2;
    let active = 0;
    sections.forEach((s, i) => { if (s && s.offsetTop <= mid) active = i; });
    dots.forEach((d, i) => d.classList.toggle("is-active", i === active));
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Horizontal pinned showcase ---------- */
  (function horizontal() {
    const sec = document.getElementById("showcase");
    const track = document.getElementById("hTrack");
    const bar = document.getElementById("hBar");
    if (!sec || !track || reduce) return;
    function update() {
      const rect = sec.getBoundingClientRect();
      const total = sec.offsetHeight - innerHeight;
      const scrolled = clamp(-rect.top, 0, total);
      const p = total > 0 ? scrolled / total : 0;
      const max = track.scrollWidth - innerWidth + 80;
      track.style.transform = `translateX(${-p * Math.max(max, 0)}px)`;
      if (bar) bar.style.width = (10 + p * 90) + "%";
    }
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  })();

  /* ---------- Cursor-follow glow on cells/plans/cards ---------- */
  if (fine) {
    document.querySelectorAll("[data-glow]").forEach((el) => {
      el.addEventListener("mousemove", (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", e.clientX - r.left + "px");
        el.style.setProperty("--my", e.clientY - r.top + "px");
      });
    });
  }

  /* ---------- Cursor glow + magnetic ---------- */
  if (fine && !reduce) {
    const glow = document.getElementById("cursorGlow");
    let gx = innerWidth / 2, gy = innerHeight / 2, cx = gx, cy = gy;
    addEventListener("mousemove", (e) => { gx = e.clientX; gy = e.clientY; });
    (function loop() { cx += (gx - cx) * 0.12; cy += (gy - cy) * 0.12; if (glow) glow.style.transform = `translate(${cx}px,${cy}px)`; requestAnimationFrame(loop); })();

    document.querySelectorAll("[data-magnetic]").forEach((btn) => {
      btn.addEventListener("mousemove", (e) => {
        const r = btn.getBoundingClientRect();
        btn.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.3}px, ${(e.clientY - r.top - r.height / 2) * 0.3}px)`;
      });
      btn.addEventListener("mouseleave", () => (btn.style.transform = "translate(0,0)"));
    });
  }

  /* ---------- Pricing toggle ---------- */
  (function pricing() {
    const toggle = document.getElementById("billingToggle");
    const pill = document.getElementById("togglePill");
    if (!toggle) return;
    const opts = [...toggle.querySelectorAll(".toggle__opt")];
    const amts = [...document.querySelectorAll(".amt[data-month]")];
    function movePill(btn) {
      pill.style.width = btn.offsetWidth + "px";
      pill.style.transform = `translateX(${btn.offsetLeft - 5}px)`;
    }
    function setBilling(mode) {
      amts.forEach((a) => {
        const val = mode === "year" ? a.dataset.year : a.dataset.month;
        const from = parseInt(a.textContent.replace(/\D/g, "")) || 0;
        const to = parseInt(val);
        if (reduce) { a.textContent = to; return; }
        const start = performance.now(), dur = 500;
        const tick = (now) => {
          const p = Math.min((now - start) / dur, 1);
          a.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }
    opts.forEach((btn) => btn.addEventListener("click", () => {
      opts.forEach((o) => o.classList.remove("is-active"));
      btn.classList.add("is-active");
      movePill(btn);
      setBilling(btn.dataset.billing);
    }));
    requestAnimationFrame(() => movePill(opts[0]));
    window.addEventListener("resize", () => movePill(toggle.querySelector(".is-active")));
  })();

  /* ---------- FAQ accordion ---------- */
  document.querySelectorAll(".acc__item").forEach((item) => {
    const q = item.querySelector(".acc__q");
    const a = item.querySelector(".acc__a");
    q.addEventListener("click", () => {
      const open = item.classList.contains("is-open");
      document.querySelectorAll(".acc__item").forEach((it) => {
        it.classList.remove("is-open");
        it.querySelector(".acc__a").style.maxHeight = null;
      });
      if (!open) { item.classList.add("is-open"); a.style.maxHeight = a.scrollHeight + "px"; }
    });
  });

  /* ---------- Mobile menu ---------- */
  (function mobileMenu() {
    const burger = document.getElementById("burger");
    const menu = document.getElementById("mobileMenu");
    if (!burger || !menu) return;
    const close = () => { burger.classList.remove("is-open"); menu.classList.remove("is-open"); burger.setAttribute("aria-expanded", "false"); document.body.style.overflow = ""; };
    burger.addEventListener("click", () => {
      const open = menu.classList.toggle("is-open");
      burger.classList.toggle("is-open", open);
      burger.setAttribute("aria-expanded", String(open));
      document.body.style.overflow = open ? "hidden" : "";
    });
    menu.querySelectorAll("a").forEach((a) => a.addEventListener("click", close));
    addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  })();

  /* ---------- Before / after compare slider ---------- */
  (function compare() {
    const ba = document.getElementById("ba");
    const before = document.getElementById("baBefore");
    const handle = document.getElementById("baHandle");
    if (!ba || !before || !handle) return;
    let dragging = false;
    function setPos(pct) {
      const p = clamp(pct, 0, 100);
      before.style.width = p + "%";
      handle.style.left = p + "%";
      handle.setAttribute("aria-valuenow", Math.round(p));
    }
    function fromEvent(clientX) {
      const r = ba.getBoundingClientRect();
      setPos(((clientX - r.left) / r.width) * 100);
    }
    ba.addEventListener("pointerdown", (e) => { dragging = true; fromEvent(e.clientX); ba.setPointerCapture(e.pointerId); });
    ba.addEventListener("pointermove", (e) => { if (dragging) fromEvent(e.clientX); });
    ba.addEventListener("pointerup", () => (dragging = false));
    ba.addEventListener("pointercancel", () => (dragging = false));
    handle.addEventListener("keydown", (e) => {
      const cur = parseFloat(handle.getAttribute("aria-valuenow")) || 50;
      if (e.key === "ArrowLeft") { setPos(cur - 4); e.preventDefault(); }
      if (e.key === "ArrowRight") { setPos(cur + 4); e.preventDefault(); }
    });
    // subtle auto-hint on first reveal
    if (!reduce) {
      const hintIO = new IntersectionObserver((entries) => entries.forEach((en) => {
        if (!en.isIntersecting) return;
        hintIO.disconnect();
        let v = 50, dir = 1, n = 0;
        const id = setInterval(() => {
          v += dir * 2; n++;
          if (v >= 62 || v <= 38) dir *= -1;
          setPos(v);
          if (n > 24) { clearInterval(id); setPos(50); }
        }, 24);
      }), { threshold: 0.5 });
      hintIO.observe(ba);
    }
  })();

  /* ---------- Demo modal + form ---------- */
  (function demoModal() {
    const modal = document.getElementById("modal");
    const form = document.getElementById("demoForm");
    if (!modal || !form) return;
    const body = document.getElementById("modalBody");
    const success = document.getElementById("modalSuccess");
    let lastFocus = null;

    function open(e) {
      if (e) e.preventDefault();
      lastFocus = document.activeElement;
      modal.classList.add("is-open");
      modal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      setTimeout(() => modal.querySelector("input")?.focus(), 120);
    }
    function close() {
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      lastFocus?.focus?.();
      // reset after transition
      setTimeout(() => { body.hidden = false; success.hidden = true; form.reset(); form.querySelectorAll(".field").forEach((f) => f.classList.remove("is-invalid")); }, 350);
    }
    document.querySelectorAll("[data-demo]").forEach((b) => b.addEventListener("click", open));
    modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
    addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.classList.contains("is-open")) close(); });

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    function validate() {
      let ok = true;
      const rules = [
        ["name", (v) => v.trim().length >= 2, "Podaj imię i nazwisko."],
        ["email", (v) => emailRe.test(v.trim()), "Podaj poprawny adres e-mail."],
        ["company", (v) => v.trim().length >= 2, "Podaj nazwę firmy."],
      ];
      rules.forEach(([name, test, msg]) => {
        const input = form.elements[name];
        const field = input.closest(".field");
        const err = field.querySelector("[data-err]");
        if (!test(input.value)) { field.classList.add("is-invalid"); if (err) err.textContent = msg; ok = false; }
        else field.classList.remove("is-invalid");
      });
      return ok;
    }
    // live-clear errors
    form.addEventListener("input", (e) => { const f = e.target.closest(".field"); if (f?.classList.contains("is-invalid")) f.classList.remove("is-invalid"); });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!validate()) { form.querySelector(".is-invalid input")?.focus(); return; }
      const name = form.elements["name"].value.trim().split(" ")[0];
      document.getElementById("successName").textContent = name + "!";
      body.hidden = true;
      success.hidden = false;
      // NOTE: no backend wired — this is a front-end demo submission.
    });
  })();

  /* ---------- Aurora canvas background ---------- */
  (function aurora() {
    const canvas = document.getElementById("aurora");
    if (!canvas || reduce) return;
    const ctx = canvas.getContext("2d");
    let w, h, dpr, t = 0;
    const blobs = [
      { c: [255, 122, 24], r: 0.55, sx: 0.00021, sy: 0.00017, ox: 0.0, oy: 0.0, a: 0.5 },
      { c: [232, 93, 4], r: 0.45, sx: 0.00015, sy: 0.00023, ox: 2.1, oy: 1.3, a: 0.4 },
      { c: [124, 92, 255], r: 0.4, sx: 0.00019, sy: 0.00013, ox: 4.2, oy: 3.7, a: 0.28 },
      { c: [255, 157, 60], r: 0.5, sx: 0.00012, sy: 0.0002, ox: 1.1, oy: 5.0, a: 0.32 },
    ];
    function resize() {
      dpr = Math.min(devicePixelRatio || 1, 1.5);
      w = canvas.width = innerWidth * dpr;
      h = canvas.height = innerHeight * dpr;
      canvas.style.width = innerWidth + "px";
      canvas.style.height = innerHeight + "px";
    }
    function frame() {
      t += 16;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#060710";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      blobs.forEach((b) => {
        const x = (0.5 + 0.42 * Math.sin(t * b.sx + b.ox)) * w;
        const y = (0.45 + 0.4 * Math.cos(t * b.sy + b.oy)) * h;
        const rad = b.r * Math.min(w, h);
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},${b.a})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalCompositeOperation = "source-over";
      requestAnimationFrame(frame);
    }
    addEventListener("resize", resize);
    resize();
    frame();
  })();
})();
