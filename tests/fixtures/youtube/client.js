// Client side of the YouTube fixture. Plain ES2019, no dependencies.
(function () {
  var cfg = window.__FIXTURE__ || {};
  if (cfg.page !== "watch") return;

  var section = document.getElementById("comments");
  var contents = section.querySelector("#contents");
  var continuation = document.getElementById("continuation");
  var state = { comments: [], next: 0, loading: false, replies: {}, expanded: {} };

  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function renderComment(c, isReply) {
    var attrs = { class: isReply ? "reply" : "comment-thread", role: "article", "aria-label": "Komentarz od " + c.author };
    if (!cfg.noCommentIds) attrs["data-comment-id"] = c.id;
    var root = h(isReply ? "ytd-comment-renderer" : "ytd-comment-thread-renderer", attrs);
    if (c.pinned) root.appendChild(h("div", { id: "pinned-comment-badge", class: "pinned", text: "Przypięty przez " + c.author }));
    root.appendChild(h("a", { id: "author-text", href: "/" + c.author, text: c.author }));
    root.appendChild(h("span", { id: "content-text", class: "comment-text", text: c.text }));
    var toolbar = h("div", { id: "toolbar" }, [
      h("span", { id: "vote-count-middle", class: "likes", "aria-label": c.likes + " polubień", text: String(c.likes) }),
      h("button", { class: "reply-button", "aria-label": "Odpowiedz", text: "Odpowiedz" }),
    ]);
    root.appendChild(toolbar);
    if (!isReply && c.replyCount) {
      var open = !!state.expanded[c.id];
      var toggle = h("button", { class: "more-replies", "aria-expanded": String(open), text: open ? "Ukryj odpowiedzi" : "Pokaż " + c.replyCount + " odpowiedzi" });
      toggle.addEventListener("click", function () { toggleReplies(c); });
      root.appendChild(toggle);
      var box = h("div", { id: "replies", class: "replies" });
      if (open) (state.replies[c.id] || []).forEach(function (r) { box.appendChild(renderComment(r, true)); });
      root.appendChild(box);
    }
    return root;
  }

  // Full re-render with fresh nodes, like a framework reconciling a list. Content is identical,
  // node identity (and any selection or attribute set from outside) is not.
  function renderAll() {
    var frag = document.createDocumentFragment();
    state.comments.forEach(function (c) { frag.appendChild(renderComment(c, false)); });
    contents.replaceChildren(frag);
  }

  function toggleReplies(c) {
    if (state.expanded[c.id]) { state.expanded[c.id] = false; renderAll(); return; }
    fetch("/api/replies?v=" + encodeURIComponent(cfg.videoId) + "&c=" + encodeURIComponent(c.id) + "&delay=" + cfg.commentDelayMs)
      .then(function (r) { return r.json(); })
      .then(function (d) { state.replies[c.id] = d.items; state.expanded[c.id] = true; renderAll(); });
  }

  function loadMore() {
    if (state.loading || state.next === null) return;
    state.loading = true;
    fetch("/api/comments?v=" + encodeURIComponent(cfg.videoId) + "&page=" + state.next + "&delay=" + cfg.commentDelayMs)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.loading = false;
        state.next = d.next;
        d.items.forEach(function (c) { state.comments.push(c); contents.appendChild(renderComment(c, false)); });
        if (d.next === null) {
          continuation.innerHTML = '<span class="end">Koniec komentarzy</span>';
          io.disconnect();
        } else {
          io.unobserve(continuation);
          io.observe(continuation);
        }
      })
      .catch(function () { state.loading = false; });
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) loadMore(); });
  }, { rootMargin: "0px 0px 300px 0px" });
  io.observe(continuation);

  if (cfg.rerenderMs > 0) setInterval(function () { if (state.comments.length) renderAll(); }, cfg.rerenderMs);
  if (cfg.likeTickMs > 0) {
    setInterval(function () {
      var first = state.comments[0];
      if (!first) return;
      first.likes += 1;
      var thread = contents.querySelector("ytd-comment-thread-renderer");
      var node = thread && thread.querySelector("#vote-count-middle");
      if (node) { node.textContent = String(first.likes); node.setAttribute("aria-label", first.likes + " polubień"); }
    }, cfg.likeTickMs);
  }

  document.getElementById("play").addEventListener("click", function (e) {
    var b = e.currentTarget;
    var playing = b.getAttribute("aria-label") === "Wstrzymaj";
    b.setAttribute("aria-label", playing ? "Odtwórz" : "Wstrzymaj");
    b.textContent = playing ? "▶" : "❚❚";
  });
})();
