const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
async function refresh() {
  const s = await api.storage.local.get(["status", "port", "token"]);
  if (s.port) $("port").value = s.port;
  $("status").textContent = `${s.token ? "Sparowane. " : ""}Stan: ${s.status ?? "brak połączenia"}`;
}
$("pair").addEventListener("click", async () => {
  const code = $("code").value.trim();
  const port = Number($("port").value) || 47823;
  if (!/^\d{6}$/.test(code)) { $("status").textContent = "Kod ma 6 cyfr."; return; }
  await api.storage.local.set({ pairCode: code, port, token: null });
  await api.runtime.sendMessage({ type: "reconnect" });
  setTimeout(refresh, 800);
});
$("forget").addEventListener("click", async () => {
  await api.storage.local.remove(["token", "pairCode"]);
  await api.runtime.sendMessage({ type: "reconnect" });
  setTimeout(refresh, 300);
});
api.storage.onChanged.addListener(refresh);
void refresh();
