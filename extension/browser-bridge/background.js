// JARVIS Bridge background (Chromium service worker and Firefox background script). One loopback
// WebSocket to the JARVIS app; pairing code once, then a token kept in extension storage. Only
// the commands below exist; everything else is refused.
const api = globalThis.browser ?? globalThis.chrome;
const DEFAULT_PORT = 47823;
const isFirefox = typeof globalThis.browser !== "undefined" && !!globalThis.browser.runtime?.getBrowserInfo;
let ws = null;
let backoff = 1000;
let timer = null;

const setStatus = (status) => api.storage.local.set({ status, statusAt: Date.now() });
const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

async function activeTab() {
  const [t] = await api.tabs.query({ active: true, lastFocusedWindow: true });
  return t ?? null;
}

async function reportTab(t) {
  const tab = t ?? await activeTab();
  if (tab && typeof tab.id === "number" && tab.url) send({ type: "event", event: "tab", tabId: tab.id, url: tab.url, title: tab.title ?? "" });
}

async function connect() {
  clearTimeout(timer);
  const s = await api.storage.local.get(["port", "token", "pairCode"]);
  if (!s.token && !s.pairCode) { await setStatus("not paired: enter the code shown by JARVIS"); return; }
  const socket = new WebSocket(`ws://127.0.0.1:${Number(s.port) || DEFAULT_PORT}/bridge`);
  ws = socket;
  socket.onopen = () => {
    send({ type: "hello", v: 1, browser: isFirefox ? "firefox" : "chromium", extensionId: new URL(api.runtime.getURL("")).host, ...(s.token ? { token: s.token } : { pairCode: String(s.pairCode) }) });
  };
  socket.onmessage = async (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === "welcome") {
      backoff = 1000;
      if (m.token) await api.storage.local.set({ token: m.token, pairCode: null });
      await setStatus("connected");
      await reportTab();
    } else if (m.type === "error") {
      if (m.code === "unauthorized") await api.storage.local.remove(["token", "pairCode"]);
      await setStatus(`refused: ${m.message}`);
    } else if (m.type === "cmd") {
      await handle(m);
    }
  };
  socket.onclose = () => {
    if (ws === socket) ws = null;
    timer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30000);
  };
  socket.onerror = () => setStatus("JARVIS is not running or the port is wrong");
}

/** Resolves when the tab finished loading (or after `ms`); JARVIS reads the tab back itself. */
function waitLoaded(tabId, ms) {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); api.tabs.onUpdated.removeListener(on); resolve(); };
    const on = (id, info) => { if (id === tabId && info.status === "complete") done(); };
    const t = setTimeout(done, ms);
    api.tabs.onUpdated.addListener(on);
  });
}

async function handle(m) {
  try {
    let data = null;
    if (m.method === "tab.get") {
      const t = await activeTab();
      data = t ? { tabId: t.id, url: t.url ?? "", title: t.title ?? "" } : null;
    } else if (m.method === "tab.navigate") {
      const url = String(m.params?.url ?? "");
      if (!/^https?:\/\//i.test(url)) throw new Error("only http and https addresses are allowed");
      const t = await activeTab();
      if (!t) throw new Error("no active tab");
      const loaded = waitLoaded(t.id, 15000);
      await api.tabs.update(t.id, { url });
      await loaded;
      data = { tabId: t.id };
    } else if (m.method === "page.selection" || m.method === "page.copySelection") {
      const t = await activeTab();
      if (!t) throw new Error("no active tab");
      data = await api.tabs.sendMessage(t.id, { type: m.method });
    } else {
      throw new Error("unknown method");
    }
    send({ type: "result", id: m.id, ok: true, data });
  } catch (e) {
    send({ type: "result", id: m.id, ok: false, error: String(e?.message ?? e) });
  }
}

api.tabs.onActivated.addListener(() => { void reportTab(); });
api.tabs.onUpdated.addListener((_id, info, tab) => { if (tab.active && (info.status === "complete" || info.title)) void reportTab(tab); });
api.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "selection" && sender.tab?.active && typeof msg.text === "string") {
    send({ type: "event", event: "selection", tabId: sender.tab.id, text: msg.text.slice(0, 20000) });
  } else if (msg?.type === "reconnect") {
    try { ws?.close(); } catch { /* reconnect below */ }
    backoff = 1000;
    void connect();
  }
});
// Keeps the Chromium service worker alive while connected (messages extend its lifetime).
setInterval(() => send({ type: "ping" }), 20000);
void connect();
