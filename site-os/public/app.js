const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  token: "",
  projects: [],
  current: null,
  selected: null,
  editMode: true,
  undo: [],
  redo: [],
  saving: null,
  tunnelUrl: ""
};

const ui = {
  app: $("#app"),
  frame: $("#siteFrame"),
  projectList: $("#projectList"),
  projectName: $("#projectName"),
  projectSearch: $("#projectSearch"),
  saveState: $("#saveState"),
  status: $("#statusText"),
  stats: $("#projectStats"),
  hint: $("#canvasHint"),
  toast: $("#toast"),
  canvasStage: $("#canvasStage"),
  selectedName: $("#selectedName"),
  emptySelection: $("#emptySelection"),
  elementControls: $("#elementControls"),
  text: $("#textControl"),
  linkField: $("#linkField"),
  link: $("#linkControl"),
  imageField: $("#imageField"),
  image: $("#imageControl"),
  fontSize: $("#fontSizeControl"),
  fontWeight: $("#fontWeightControl"),
  color: $("#colorControl"),
  background: $("#backgroundControl"),
  padding: $("#paddingControl"),
  radius: $("#radiusControl"),
  aiPrompt: $("#aiPrompt"),
  aiStatus: $("#aiStatus"),
  localPreview: $("#localPreviewUrl"),
  publicPreview: $("#publicPreviewUrl"),
  tunnelEmpty: $("#tunnelEmpty"),
  tunnelReady: $("#tunnelReady")
};

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ui.toast.classList.remove("show"), 2300);
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = "Bearer " + state.token;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({ ok: false, error: "Nieprawidłowa odpowiedź serwera." }));
  if (!response.ok) throw new Error(data.error || "Błąd połączenia z Site OS.");
  return data;
}

function formatDate(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function safeName(value) {
  return String(value || "Projekt").trim().slice(0, 120) || "Projekt";
}

function renderProjects() {
  const query = ui.projectSearch.value.trim().toLowerCase();
  const list = state.projects.filter((project) => project.name.toLowerCase().includes(query));
  ui.projectList.innerHTML = "";
  for (const project of list) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "project-item" + (project.id === state.current?.id ? " active" : "");
    button.innerHTML = `<span class="project-thumb">${project.name.slice(0, 2).toUpperCase()}</span><span><strong></strong><span></span></span>`;
    $("strong", button).textContent = project.name;
    $("span", button)[2].textContent = formatDate(project.updatedAt);
    button.addEventListener("click", () => loadProject(project.id));
    ui.projectList.append(button);
  }
  if (!list.length) {
    const empty = document.createElement("p");
    empty.style.cssText = "padding:18px;color:var(--muted);font-size:11px";
    empty.textContent = "Brak pasujących projektów.";
    ui.projectList.append(empty);
  }
}

async function refreshProjects(preferredId) {
  const data = await api("/api/projects");
  state.projects = data.projects;
  renderProjects();
  const target = preferredId || state.current?.id || state.projects[0]?.id;
  if (target && target !== state.current?.id) await loadProject(target);
}

async function loadProject(id) {
  flushSave();
  const data = await api("/api/projects/" + encodeURIComponent(id));
  state.current = data.project;
  state.undo = [];
  state.redo = [];
  state.selected = null;
  ui.projectName.value = state.current.name;
  updatePreviewUrls();
  renderProjects();
  renderFrame();
  updateHistoryButtons();
}

function renderFrame() {
  if (!state.current) return;
  state.selected = null;
  updateSelectionPanel();
  ui.frame.srcdoc = state.current.html;
  ui.frame.onload = () => {
    installEditorBridge();
    updateStats();
  };
}

function installEditorBridge() {
  const doc = ui.frame.contentDocument;
  if (!doc) return;
  let style = doc.getElementById("siteos-editor-style");
  if (!style) {
    style = doc.createElement("style");
    style.id = "siteos-editor-style";
    style.textContent = `
      .siteos-selected{outline:2px solid #28cbe0!important;outline-offset:2px!important}
      .siteos-hover{outline:1px dashed rgba(40,203,224,.8)!important;outline-offset:2px!important}
    `;
    (doc.head || doc.documentElement).append(style);
  }
  doc.addEventListener("mouseover", (event) => {
    if (!state.editMode) return;
    const element = event.target;
    if (!(element instanceof ui.frame.contentWindow.Element) || element === doc.documentElement || element === doc.body) return;
    if (element !== state.selected) element.classList.add("siteos-hover");
  }, true);
  doc.addEventListener("mouseout", (event) => {
    const element = event.target;
    if (element instanceof ui.frame.contentWindow.Element) element.classList.remove("siteos-hover");
  }, true);
  doc.addEventListener("click", (event) => {
    if (!state.editMode) return;
    event.preventDefault();
    event.stopPropagation();
    const element = event.target;
    if (element instanceof ui.frame.contentWindow.Element) selectElement(element);
  }, true);
  doc.addEventListener("dblclick", (event) => {
    if (!state.editMode) return;
    event.preventDefault();
    const element = event.target;
    if (element instanceof ui.frame.contentWindow.HTMLElement && element.children.length === 0) {
      element.contentEditable = "true";
      element.focus();
      const before = serializeFrame();
      const finish = () => {
        element.contentEditable = "false";
        element.removeAttribute("contenteditable");
        recordMutation(before);
        element.removeEventListener("blur", finish);
      };
      element.addEventListener("blur", finish);
    }
  }, true);
}

function selectElement(element) {
  if (state.selected) state.selected.classList.remove("siteos-selected");
  element.classList.remove("siteos-hover");
  element.classList.add("siteos-selected");
  state.selected = element;
  updateSelectionPanel();
}

function rgbToHex(value, fallback = "#ffffff") {
  if (!value || value === "transparent" || value === "rgba(0, 0, 0, 0)") return fallback;
  if (value.startsWith("#")) return value.slice(0, 7);
  const values = value.match(/[\d.]+/g);
  if (!values || values.length < 3) return fallback;
  return "#" + values.slice(0, 3).map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0")).join("");
}

function updateSelectionPanel() {
  const element = state.selected;
  ui.emptySelection.hidden = Boolean(element);
  ui.elementControls.hidden = !element;
  if (!element) return;
  const tag = element.tagName.toLowerCase();
  const style = ui.frame.contentWindow.getComputedStyle(element);
  const label = element.id ? tag + "#" + element.id : element.classList.length ? tag + "." + [...element.classList].filter((name) => !name.startsWith("siteos-"))[0] : tag;
  ui.selectedName.textContent = label || tag;
  ui.text.disabled = element.children.length > 0 || ["IMG", "INPUT", "TEXTAREA", "SELECT", "VIDEO"].includes(element.tagName);
  ui.text.value = ui.text.disabled ? "Zaznacz element tekstowy wewnątrz tej sekcji." : element.textContent.trim();
  ui.linkField.hidden = element.tagName !== "A";
  ui.link.value = element.getAttribute("href") || "";
  ui.imageField.hidden = element.tagName !== "IMG";
  ui.image.value = element.getAttribute("src") || "";
  ui.fontSize.value = Math.round(parseFloat(style.fontSize) || 16);
  ui.fontWeight.value = ["400", "500", "600", "700"].includes(style.fontWeight) ? style.fontWeight : "400";
  ui.color.value = rgbToHex(style.color, "#111111");
  ui.background.value = rgbToHex(style.backgroundColor, "#ffffff");
  ui.padding.value = Math.round(parseFloat(style.paddingTop) || 0);
  ui.radius.value = Math.round(parseFloat(style.borderTopLeftRadius) || 0);
  $$("[data-align]").forEach((button) => button.classList.toggle("active", button.dataset.align === style.textAlign));
}

function serializeFrame() {
  const doc = ui.frame.contentDocument;
  if (!doc) return state.current?.html || "";
  const clone = doc.documentElement.cloneNode(true);
  clone.querySelector("#siteos-editor-style")?.remove();
  clone.querySelectorAll(".siteos-selected,.siteos-hover").forEach((element) => {
    element.classList.remove("siteos-selected", "siteos-hover");
    if (!element.className) element.removeAttribute("class");
    element.removeAttribute("contenteditable");
  });
  return "<!doctype html>\n" + clone.outerHTML;
}

function snapshot() {
  if (!state.current) return "";
  return serializeFrame();
}

function mutate(callback) {
  if (!state.selected || !state.current) return;
  const before = snapshot();
  callback(state.selected);
  recordMutation(before);
  updateSelectionPanel();
}

function recordMutation(before) {
  if (!state.current) return;
  const after = serializeFrame();
  if (after === before) return;
  state.undo.push(before);
  if (state.undo.length > 50) state.undo.shift();
  state.redo = [];
  state.current.html = after;
  state.current.updatedAt = Date.now();
  scheduleSave();
  updateHistoryButtons();
  updateStats();
}

function scheduleSave() {
  ui.saveState.textContent = "Zapisywanie…";
  clearTimeout(state.saving);
  state.saving = setTimeout(saveCurrent, 550);
}

async function saveCurrent() {
  if (!state.current) return;
  clearTimeout(state.saving);
  state.saving = null;
  try {
    const data = await api("/api/projects/" + state.current.id, {
      method: "PUT",
      body: JSON.stringify({
        name: safeName(ui.projectName.value),
        html: state.current.html,
        brief: state.current.brief,
        lead: state.current.lead
      })
    });
    state.current = data.project;
    ui.projectName.value = state.current.name;
    ui.saveState.textContent = "Zapisano";
    const summary = state.projects.find((item) => item.id === state.current.id);
    if (summary) Object.assign(summary, { name: state.current.name, updatedAt: state.current.updatedAt, size: state.current.html.length });
    renderProjects();
  } catch (error) {
    ui.saveState.textContent = "Błąd zapisu";
    toast(error.message);
  }
}

function flushSave() {
  if (state.saving) saveCurrent();
}

function updateHistoryButtons() {
  $("#undoBtn").disabled = state.undo.length === 0;
  $("#redoBtn").disabled = state.redo.length === 0;
}

function restoreHtml(html, destination) {
  if (!state.current) return;
  destination.push(state.current.html);
  state.current.html = html;
  scheduleSave();
  renderFrame();
  updateHistoryButtons();
}

function updateStats() {
  if (!state.current) return;
  const doc = ui.frame.contentDocument;
  const sections = doc ? doc.querySelectorAll("section, header, main > div, footer").length : 0;
  const size = Math.max(1, Math.round(state.current.html.length / 1024));
  ui.stats.textContent = sections + " sekcji · " + size + " KB";
}

function updatePreviewUrls() {
  if (!state.current) return;
  const path = "/p/" + state.current.id;
  ui.localPreview.value = location.origin + path;
  ui.publicPreview.value = state.tunnelUrl ? state.tunnelUrl + path : "";
  $("#previewAddress").textContent = state.current.name + " · podgląd lokalny";
}

async function createProject(html) {
  const data = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: "Nowy projekt", html: html || undefined })
  });
  state.projects.unshift({
    id: data.project.id,
    name: data.project.name,
    updatedAt: data.project.updatedAt,
    createdAt: data.project.createdAt,
    size: data.project.html.length,
    versionCount: 0
  });
  await loadProject(data.project.id);
  ui.projectName.select();
}

async function deleteProject() {
  if (!state.current || state.projects.length <= 1) return toast("Zostaw przynajmniej jeden projekt.");
  if (!confirm("Usunąć projekt „" + state.current.name + "”?")) return;
  await api("/api/projects/" + state.current.id, { method: "DELETE" });
  state.projects = state.projects.filter((item) => item.id !== state.current.id);
  state.current = null;
  await loadProject(state.projects[0].id);
  toast("Projekt usunięty.");
}

function setPanel(name) {
  $$("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  $$("[data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === name));
}

async function startTunnel() {
  $("#startTunnelBtn").disabled = true;
  $("#startTunnelBtn").textContent = "Uruchamianie…";
  try {
    await api("/api/tunnel/start", { method: "POST", body: "{}" });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      const data = await api("/api/tunnel");
      if (data.error) throw new Error("Nie udało się uruchomić tunelu: " + data.error);
      if (data.tunnelUrl) {
        state.tunnelUrl = data.tunnelUrl;
        updateTunnelUi();
        toast("Publiczny podgląd jest gotowy.");
        return;
      }
    }
    throw new Error("Tunel nie wystartował. Zainstaluj cloudflared i spróbuj ponownie.");
  } catch (error) {
    toast(error.message);
  } finally {
    $("#startTunnelBtn").disabled = false;
    $("#startTunnelBtn").textContent = "Uruchom tunel";
  }
}

function updateTunnelUi() {
  const ready = Boolean(state.tunnelUrl);
  ui.tunnelEmpty.hidden = ready;
  ui.tunnelReady.hidden = !ready;
  $("#connectionState").innerHTML = "<i></i> " + (ready ? "Tunel aktywny" : "Lokalnie");
  updatePreviewUrls();
}

async function stopTunnel() {
  await api("/api/tunnel/stop", { method: "POST", body: "{}" });
  state.tunnelUrl = "";
  updateTunnelUi();
  toast("Tunel został wyłączony.");
}

function selectionDescriptor() {
  const element = state.selected;
  if (!element) return null;
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    classes: [...element.classList].filter((name) => !name.startsWith("siteos-")).slice(0, 8),
    text: element.textContent.trim().slice(0, 240)
  };
}

async function sendPrompt() {
  const prompt = ui.aiPrompt.value.trim();
  if (!prompt) return toast("Napisz polecenie dla JARVISA.");
  $("#sendPromptBtn").disabled = true;
  try {
    const data = await api("/api/commands", {
      method: "POST",
      body: JSON.stringify({ projectId: state.current.id, prompt, selection: selectionDescriptor() })
    });
    ui.aiStatus.hidden = false;
    ui.aiStatus.textContent = data.connected
      ? "JARVIS odebrał polecenie. Zmiana pojawi się tutaj automatycznie."
      : "Polecenie zapisane w kolejce. JARVIS odbierze je po połączeniu z Site OS.";
    ui.aiPrompt.value = "";
    toast("Polecenie przekazane do JARVISA.");
  } catch (error) {
    toast(error.message);
  } finally {
    $("#sendPromptBtn").disabled = false;
  }
}

function bindControls() {
  ui.projectSearch.addEventListener("input", renderProjects);
  ui.projectName.addEventListener("change", () => {
    if (!state.current) return;
    state.current.name = safeName(ui.projectName.value);
    scheduleSave();
    updatePreviewUrls();
  });
  $("#newProjectBtn").addEventListener("click", () => createProject());
  $("#deleteBtn").addEventListener("click", deleteProject);
  $("#importBtn").addEventListener("click", () => $("#importInput").click());
  $("#importInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await createProject(await file.text());
    event.target.value = "";
  });

  $("#undoBtn").addEventListener("click", () => {
    const html = state.undo.pop();
    if (html) restoreHtml(html, state.redo);
  });
  $("#redoBtn").addEventListener("click", () => {
    const html = state.redo.pop();
    if (html) restoreHtml(html, state.undo);
  });

  $$("[data-viewport]").forEach((button) => button.addEventListener("click", () => {
    $$("[data-viewport]").forEach((item) => item.classList.toggle("active", item === button));
    ui.canvasStage.dataset.viewport = button.dataset.viewport;
  }));
  $("#selectModeBtn").addEventListener("click", () => {
    state.editMode = !state.editMode;
    $("#selectModeBtn").classList.toggle("active", state.editMode);
    $("#selectModeBtn").textContent = state.editMode ? "Edycja" : "Podgląd";
    ui.hint.textContent = state.editMode ? "Kliknij element, aby go edytować" : "Tryb podglądu strony";
    if (!state.editMode && state.selected) {
      state.selected.classList.remove("siteos-selected");
      state.selected = null;
      updateSelectionPanel();
    }
  });

  $$("[data-tab]").forEach((button) => button.addEventListener("click", () => setPanel(button.dataset.tab)));
  $("#shareBtn").addEventListener("click", () => setPanel("publish"));
  $("#previewBtn").addEventListener("click", () => state.current && window.open("/p/" + state.current.id, "_blank", "noopener"));

  ui.text.addEventListener("change", () => mutate((element) => { if (!ui.text.disabled) element.textContent = ui.text.value; }));
  ui.link.addEventListener("change", () => mutate((element) => element.setAttribute("href", ui.link.value)));
  ui.image.addEventListener("change", () => mutate((element) => element.setAttribute("src", ui.image.value)));
  ui.fontSize.addEventListener("change", () => mutate((element) => { element.style.fontSize = ui.fontSize.value + "px"; }));
  ui.fontWeight.addEventListener("change", () => mutate((element) => { element.style.fontWeight = ui.fontWeight.value; }));
  ui.color.addEventListener("change", () => mutate((element) => { element.style.color = ui.color.value; }));
  ui.background.addEventListener("change", () => mutate((element) => { element.style.backgroundColor = ui.background.value; }));
  ui.padding.addEventListener("change", () => mutate((element) => { element.style.padding = ui.padding.value + "px"; }));
  ui.radius.addEventListener("change", () => mutate((element) => { element.style.borderRadius = ui.radius.value + "px"; }));
  $$("[data-align]").forEach((button) => button.addEventListener("click", () => mutate((element) => { element.style.textAlign = button.dataset.align; })));

  $("#duplicateBtn").addEventListener("click", () => mutate((element) => element.after(element.cloneNode(true))));
  $("#removeElementBtn").addEventListener("click", () => {
    if (!state.selected) return;
    const before = snapshot();
    state.selected.remove();
    state.selected = null;
    recordMutation(before);
    updateSelectionPanel();
  });
  $("#moveUpBtn").addEventListener("click", () => mutate((element) => {
    if (element.previousElementSibling) element.parentElement.insertBefore(element, element.previousElementSibling);
  }));
  $("#moveDownBtn").addEventListener("click", () => mutate((element) => {
    if (element.nextElementSibling) element.parentElement.insertBefore(element.nextElementSibling, element);
  }));

  $$("[data-prompt]").forEach((button) => button.addEventListener("click", () => {
    ui.aiPrompt.value = button.dataset.prompt;
    ui.aiPrompt.focus();
  }));
  $("#sendPromptBtn").addEventListener("click", sendPrompt);
  $("#startTunnelBtn").addEventListener("click", startTunnel);
  $("#stopTunnelBtn").addEventListener("click", stopTunnel);
  $$("[data-copy]").forEach((button) => button.addEventListener("click", async () => {
    const input = $("#" + button.dataset.copy);
    await navigator.clipboard.writeText(input.value);
    toast("Link skopiowany.");
  }));
  window.addEventListener("beforeunload", flushSave);
}

async function checkRemoteProjectUpdate() {
  if (!state.current || state.saving || document.hidden) return;
  try {
    const data = await api("/api/projects");
    const remote = data.projects.find((item) => item.id === state.current.id);
    if (remote && remote.updatedAt > state.current.updatedAt + 250) {
      await loadProject(state.current.id);
      toast("JARVIS zastosował nową wersję projektu.");
    }
  } catch {
    // Kolejna próba nastąpi automatycznie.
  }
}

async function init() {
  bindControls();
  try {
    const session = await api("/api/session");
    state.token = session.token;
    const health = await api("/api/health");
    state.tunnelUrl = health.tunnelUrl || "";
    updateTunnelUi();
    await refreshProjects();
    ui.app.dataset.ready = "true";
    ui.status.textContent = "Site OS " + health.version + " · gotowy";
    setInterval(checkRemoteProjectUpdate, 5000);
  } catch (error) {
    ui.status.textContent = "Brak połączenia";
    toast(error.message);
  }
}

init();
