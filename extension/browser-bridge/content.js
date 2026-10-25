// JARVIS Bridge content script: reports the text selection of the page and answers the two
// page commands. It never reads anything else from the page.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  let last = "";
  let pending = null;
  document.addEventListener("selectionchange", () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      const text = String(document.getSelection() ?? "");
      if (text === last) return;
      last = text;
      try { api.runtime.sendMessage({ type: "selection", text: text.slice(0, 20000) }); } catch { /* extension reloaded */ }
    }, 200);
  });
  api.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === "page.selection") { reply({ text: String(document.getSelection() ?? "") }); return; }
    if (msg?.type === "page.copySelection") {
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      reply({ ok });
    }
  });
})();
