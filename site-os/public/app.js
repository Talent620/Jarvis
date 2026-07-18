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
  imageInputTimer: null,
  tunnelUrl: "",
  leads: [],
  audit: null
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
  imageAlt: $("#imageAltControl"),
  imageUpload: $("#imageUploadInput"),
  imageUploadBtn: $("#imageUploadBtn"),
  imageRemoveBtn: $("#imageRemoveBtn"),
  imageDropzone: $("#imageDropzone"),
  imagePreview: $("#imagePreview"),
  imageDropLabel: $("#imageDropLabel"),
  imageStatus: $("#imageStatus"),
  fontSize: $("#fontSizeControl"),
  fontWeight: $("#fontWeightControl"),
  color: $("#colorControl"),
  background: $("#backgroundControl"),
  padding: $("#paddingControl"),
  radius: $("#radiusControl"),
  aiPrompt: $("#aiPrompt"),
  aiStatus: $("#aiStatus"),
  structureList: $("#structureList"),
  structureCount: $("#structureCount"),
  auditScore: $("#auditScore"),
  auditMeter: $("#auditMeter i"),
  auditResults: $("#auditResults"),
  seoTitle: $("#seoTitle"),
  seoDescription: $("#seoDescription"),
  leadCount: $("#leadCount"),
  leadList: $("#leadList"),
  projectDialog: $("#newProjectDialog"),
  localPreview: $("#localPreviewUrl"),
  publicPreview: $("#publicPreviewUrl"),
  tunnelEmpty: $("#tunnelEmpty"),
  tunnelReady: $("#tunnelReady")
};

const PALETTES = {
  north: { ink: "#10201c", paper: "#f5f3ed", brand: "#1f6b52", accent: "#e76f51", line: "#c8cec7" },
  noir: { ink: "#111111", paper: "#f5f5f2", brand: "#111111", accent: "#9cca28", line: "#c9cbc6" },
  signal: { ink: "#10192d", paper: "#f7f9ff", brand: "#1557ff", accent: "#d59f00", line: "#cbd5eb" },
  atelier: { ink: "#33151c", paper: "#fff8f3", brand: "#7b2639", accent: "#d17e45", line: "#dfc8bd" }
};

const BLOCK_STYLES = `
  .siteos-block{--so-ink:var(--ink,var(--foreground,#10201c));--so-paper:var(--paper,var(--background,#f6f5f0));--so-brand:var(--green,var(--brand,#1f6b52));--so-accent:var(--coral,var(--accent,#e76f51));box-sizing:border-box;padding:clamp(64px,8vw,112px) clamp(24px,6vw,88px);overflow-wrap:anywhere;background:var(--so-paper);color:var(--so-ink);font-family:inherit}
  .siteos-block *{box-sizing:border-box}.siteos-block__inner{width:min(1160px,100%);margin:0 auto}.siteos-block__eyebrow{display:block;margin-bottom:14px;color:var(--so-brand);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.siteos-block h2{max-width:820px;margin:0 0 18px;font:700 clamp(34px,5vw,64px)/1.04 Georgia,serif;letter-spacing:0}.siteos-block__lead{max-width:680px;margin:0 0 34px;font-size:18px;line-height:1.6;opacity:.78}
  .siteos-grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.siteos-card{padding:28px;border:1px solid color-mix(in srgb,var(--so-ink) 18%,transparent);background:color-mix(in srgb,var(--so-paper) 88%,white)}.siteos-card b{display:block;margin-bottom:10px;font-size:19px}.siteos-card p{margin:0;line-height:1.6;opacity:.72}.siteos-button{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 21px;background:var(--so-brand);color:white;text-decoration:none;font-weight:800}.siteos-button--line{margin-left:8px;border:1px solid var(--so-ink);background:transparent;color:var(--so-ink)}
  .siteos-hero{display:grid;grid-template-columns:1.02fr .98fr;min-height:650px;padding:0}.siteos-hero__copy{display:flex;flex-direction:column;justify-content:center;padding:clamp(70px,9vw,132px) clamp(28px,6vw,90px)}.siteos-hero h1{max-width:760px;margin:0 0 24px;font:700 clamp(48px,7vw,96px)/.96 Georgia,serif;letter-spacing:0}.siteos-hero__media{min-height:520px;background:center/cover no-repeat url('https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1500&q=85')}
  .siteos-proof{display:grid;grid-template-columns:repeat(3,1fr);padding:0;border-top:1px solid color-mix(in srgb,var(--so-ink) 20%,transparent);border-bottom:1px solid color-mix(in srgb,var(--so-ink) 20%,transparent)}.siteos-proof article{padding:42px clamp(24px,5vw,70px);border-right:1px solid color-mix(in srgb,var(--so-ink) 20%,transparent)}.siteos-proof article:last-child{border-right:0}.siteos-proof b{display:block;font:700 44px Georgia,serif}.siteos-proof span{opacity:.68}
  .siteos-quote{font:600 22px/1.5 Georgia,serif}.siteos-author{margin-top:22px;font-size:13px}.siteos-price{position:relative}.siteos-price--featured{border:2px solid var(--so-brand)}.siteos-price small{display:block;color:var(--so-brand);font-weight:800;text-transform:uppercase}.siteos-price strong{display:block;margin:18px 0;font:700 38px Georgia,serif}.siteos-price ul{padding-left:18px;line-height:1.9;opacity:.76}
  .siteos-faq details{padding:19px 0;border-top:1px solid color-mix(in srgb,var(--so-ink) 18%,transparent)}.siteos-faq summary{cursor:pointer;font-weight:800}.siteos-faq p{max-width:760px;line-height:1.65;opacity:.72}.siteos-contact{display:grid;grid-template-columns:.85fr 1.15fr;gap:8vw}.siteos-form{display:grid;gap:12px}.siteos-form label{display:grid;gap:6px;font-size:12px;font-weight:700}.siteos-form input,.siteos-form textarea{width:100%;padding:14px;border:1px solid color-mix(in srgb,var(--so-ink) 25%,transparent);border-radius:0;background:white;color:#111;font:inherit}.siteos-form button{border:0;cursor:pointer}.siteos-form__status{min-height:22px;font-size:13px}.siteos-honeypot{position:absolute;left:-10000px}
  .siteos-cta{text-align:center;background:var(--so-ink);color:var(--so-paper)}.siteos-cta h2,.siteos-cta .siteos-block__lead{margin-left:auto;margin-right:auto}.siteos-cta .siteos-button{background:var(--so-accent);color:#101010}
  @media(max-width:780px){.siteos-grid-3,.siteos-contact,.siteos-hero{grid-template-columns:1fr}.siteos-hero__media{min-height:390px;order:-1}.siteos-proof{grid-template-columns:1fr}.siteos-proof article{border-right:0;border-bottom:1px solid color-mix(in srgb,var(--so-ink) 20%,transparent)}.siteos-button--line{margin:8px 0 0}.siteos-block{padding:64px 24px}}
`;

const SECTION_TEMPLATES = {
  hero: `<section class="siteos-block siteos-hero" data-siteos-label="Hero premium"><div class="siteos-hero__copy"><span class="siteos-block__eyebrow">Nowy standard w Twojej branży</span><h1>Rezultat, który widać od pierwszego dnia.</h1><p class="siteos-block__lead">Łączymy strategię, wykonanie i dbałość o szczegóły, aby Twoi klienci szybciej podejmowali decyzję.</p><div><a class="siteos-button" href="#kontakt">Umów rozmowę</a><a class="siteos-button siteos-button--line" href="#oferta">Poznaj ofertę</a></div></div><div class="siteos-hero__media" role="img" aria-label="Dopracowana przestrzeń pracy"></div></section>`,
  benefits: `<section class="siteos-block" id="oferta" data-siteos-label="Korzyści"><div class="siteos-block__inner"><span class="siteos-block__eyebrow">Dlaczego my</span><h2>Każdy element pracuje na Twój wynik.</h2><p class="siteos-block__lead">Krótko, konkretnie i bez pustych obietnic. Pokazujemy wartość, którą klient może zrozumieć i zapamiętać.</p><div class="siteos-grid-3"><article class="siteos-card"><b>Strategia przed działaniem</b><p>Najpierw porządkujemy cel i decyzje, dopiero potem projektujemy rozwiązanie.</p></article><article class="siteos-card"><b>Jedna odpowiedzialność</b><p>Masz jeden zespół, czytelny proces i pełną kontrolę nad kolejnymi krokami.</p></article><article class="siteos-card"><b>Jakość, która skaluje</b><p>Budujemy system gotowy rosnąć razem z marką, ofertą i ruchem.</p></article></div></div></section>`,
  proof: `<section class="siteos-block siteos-proof" data-siteos-label="Dowody i liczby"><article><b>42+</b><span>zrealizowane projekty</span></article><article><b>4.9/5</b><span>średnia ocena współpracy</span></article><article><b>18%</b><span>średni wzrost zapytań</span></article></section>`,
  testimonials: `<section class="siteos-block" data-siteos-label="Opinie klientów"><div class="siteos-block__inner"><span class="siteos-block__eyebrow">Głos klientów</span><h2>Współpraca, którą chce się polecać.</h2><div class="siteos-grid-3"><article class="siteos-card"><div class="siteos-quote">„Wreszcie mamy stronę, która wygląda jak nasza najlepsza usługa.”</div><div class="siteos-author"><b>Anna Kowalska</b> · CEO</div></article><article class="siteos-card"><div class="siteos-quote">„Decyzje były szybkie, proces przejrzysty, a efekt przerósł oczekiwania.”</div><div class="siteos-author"><b>Marek Nowak</b> · Founder</div></article><article class="siteos-card"><div class="siteos-quote">„Liczba jakościowych zapytań wzrosła już w pierwszym miesiącu.”</div><div class="siteos-author"><b>Julia Wiśniewska</b> · Growth Lead</div></article></div></div></section>`,
  pricing: `<section class="siteos-block" data-siteos-label="Cennik"><div class="siteos-block__inner"><span class="siteos-block__eyebrow">Prosta oferta</span><h2>Wybierz zakres dopasowany do etapu firmy.</h2><p class="siteos-block__lead">Każdy wariant ma jasno określony efekt, zakres i następny krok.</p><div class="siteos-grid-3"><article class="siteos-card siteos-price"><small>Start</small><strong>2 900 zł</strong><p>Dobry początek dla jednej oferty.</p><ul><li>Strategia strony</li><li>5 kluczowych sekcji</li><li>Wersja mobilna</li></ul></article><article class="siteos-card siteos-price siteos-price--featured"><small>Najczęściej wybierany</small><strong>6 900 zł</strong><p>Pełna strona nastawiona na konwersję.</p><ul><li>Warsztat strategiczny</li><li>Pełny projekt i treści</li><li>SEO i analityka</li></ul></article><article class="siteos-card siteos-price"><small>Partner</small><strong>Indywidualnie</strong><p>System dla rosnącej marki.</p><ul><li>Wiele podstron</li><li>Integracje i automatyzacje</li><li>Stałe wsparcie</li></ul></article></div></div></section>`,
  faq: `<section class="siteos-block siteos-faq" data-siteos-label="Najczęstsze pytania"><div class="siteos-block__inner"><span class="siteos-block__eyebrow">FAQ</span><h2>Wszystko, co warto wiedzieć przed startem.</h2><details open><summary>Ile trwa realizacja?</summary><p>Typowy projekt zamykamy w 3–5 tygodni. Dokładny harmonogram ustalamy po krótkiej rozmowie o zakresie.</p></details><details><summary>Czy mogę samodzielnie zmieniać treści?</summary><p>Tak. Otrzymujesz prosty system i instrukcję, dzięki którym codzienne aktualizacje nie wymagają pomocy technicznej.</p></details><details><summary>Co jest potrzebne na początek?</summary><p>Wystarczy cel biznesowy, podstawowa oferta i 45 minut na rozmowę. Resztę porządkujemy razem.</p></details></div></section>`,
  contact: `<section class="siteos-block" id="kontakt" data-siteos-label="Formularz leadowy"><div class="siteos-block__inner siteos-contact"><div><span class="siteos-block__eyebrow">Porozmawiajmy</span><h2>Zacznijmy od krótkiej rozmowy.</h2><p class="siteos-block__lead">Opowiedz, czego potrzebujesz. Wrócimy z konkretnym następnym krokiem w ciągu jednego dnia roboczego.</p></div><form class="siteos-form" data-siteos-form><label>Imię i nazwisko<input name="name" autocomplete="name" required></label><label>E-mail<input name="email" type="email" autocomplete="email" required></label><label>Telefon<input name="phone" type="tel" autocomplete="tel"></label><label>Jak możemy pomóc?<textarea name="message" rows="5" required></textarea></label><label class="siteos-honeypot" aria-hidden="true">Strona<input name="website" tabindex="-1" autocomplete="off"></label><button class="siteos-button" type="submit">Wyślij zapytanie</button><div class="siteos-form__status" aria-live="polite"></div></form></div></section>`,
  cta: `<section class="siteos-block siteos-cta" data-siteos-label="Finałowe wezwanie"><div class="siteos-block__inner"><span class="siteos-block__eyebrow">Dobry moment jest teraz</span><h2>Zmień pierwsze wrażenie w realną przewagę.</h2><p class="siteos-block__lead">Jedna rozmowa wystarczy, aby zobaczyć najkrótszą drogę od obecnej strony do lepszego wyniku.</p><a class="siteos-button" href="#kontakt">Umów bezpłatną konsultację</a></div></section>`
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

function projectTemplate(kind) {
  if (kind === "blank") {
    return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nowy projekt</title><meta name="description" content="Nowa strona przygotowana w JARVIS Site OS."><style>:root{--ink:#10201c;--paper:#f5f3ed;--green:#1f6b52;--coral:#e76f51;--line:#c8cec7}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 Arial,sans-serif}</style></head><body>${SECTION_TEMPLATES.hero}${SECTION_TEMPLATES.contact}</body></html>`;
  }
  const kits = {
    service: {
      title: "Aurelia Studio — strategia i design premium",
      description: "Strategia, design i wdrożenie dla marek, które chcą wyglądać tak dobrze, jak działają.",
      brand: "AURELIA",
      eyebrow: "Strategia · design · wzrost",
      heading: "Marka, która od razu budzi zaufanie.",
      lead: "Porządkujemy strategię, projektujemy doświadczenie i wdrażamy stronę gotową zamieniać uwagę w wartościowe rozmowy.",
      image: "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1600&q=85",
      primary: "#1f6b52", accent: "#e76f51", paper: "#f5f3ed", ink: "#10201c",
      proof: [["42+", "zrealizowane marki"], ["4.9/5", "ocena współpracy"], ["18%", "więcej zapytań"]]
    },
    product: {
      title: "Flowbase — praca zespołu bez chaosu",
      description: "Jedno miejsce do planowania, automatyzacji i podejmowania szybszych decyzji.",
      brand: "FLOWBASE",
      eyebrow: "System operacyjny dla zespołu",
      heading: "Mniej statusów. Więcej pracy, która ma znaczenie.",
      lead: "Flowbase łączy projekty, klientów i automatyzacje w jednym spokojnym widoku, który każdy rozumie od pierwszego dnia.",
      image: "https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=1600&q=85",
      primary: "#1557ff", accent: "#e4ab00", paper: "#f7f9ff", ink: "#10192d",
      proof: [["12 h", "odzyskanych tygodniowo"], ["31%", "szybsze projekty"], ["2 min", "do pierwszego procesu"]]
    },
    local: {
      title: "Soma House — miejsce stworzone dla regeneracji",
      description: "Kameralne spa i rytuały regeneracyjne w sercu miasta.",
      brand: "SOMA HOUSE",
      eyebrow: "Rytuały · regeneracja · spokój",
      heading: "Wróć do siebie. Resztą zajmiemy się my.",
      lead: "Kameralna przestrzeń, doświadczeni terapeuci i rytuały dobrane do tego, czego naprawdę potrzebuje dziś Twoje ciało.",
      image: "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1600&q=85",
      primary: "#7b2639", accent: "#d17e45", paper: "#fff8f3", ink: "#33151c",
      proof: [["8 lat", "doświadczenia"], ["4.9/5", "od naszych gości"], ["60 min", "tylko dla Ciebie"]]
    }
  };
  const kit = kits[kind] || kits.service;
  const proof = kit.proof.map(([value, label]) => `<article><b>${value}</b><span>${label}</span></article>`).join("");
  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${kit.title}</title><meta name="description" content="${kit.description}"><style>
:root{--ink:${kit.ink};--paper:${kit.paper};--green:${kit.primary};--coral:${kit.accent};--line:color-mix(in srgb,var(--ink) 20%,transparent)}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;overflow-x:hidden;background:var(--paper);color:var(--ink);font:16px/1.55 Arial,sans-serif}nav{height:68px;display:flex;align-items:center;justify-content:space-between;padding:0 6vw;border-bottom:1px solid var(--line)}nav strong{font-size:17px}nav a{margin-left:22px;color:inherit;text-decoration:none;font-size:14px}.siteos-hero__media{background-image:url('${kit.image}')!important}@media(max-width:760px){nav div{display:none}}
${BLOCK_STYLES}</style></head><body><nav data-siteos-label="Nawigacja"><strong>${kit.brand}</strong><div><a href="#oferta">Oferta</a><a href="#kontakt">Kontakt</a></div></nav><section class="siteos-block siteos-hero" data-siteos-label="Hero"><div class="siteos-hero__copy"><span class="siteos-block__eyebrow">${kit.eyebrow}</span><h1>${kit.heading}</h1><p class="siteos-block__lead">${kit.lead}</p><div><a class="siteos-button" href="#kontakt">Umów rozmowę</a><a class="siteos-button siteos-button--line" href="#oferta">Poznaj ofertę</a></div></div><div class="siteos-hero__media" role="img" aria-label="${kit.brand} — główne doświadczenie marki"></div></section><section class="siteos-block siteos-proof" data-siteos-label="Dowody">${proof}</section>${SECTION_TEMPLATES.benefits}${SECTION_TEMPLATES.testimonials}${SECTION_TEMPLATES.contact}<footer class="siteos-block" data-siteos-label="Stopka" style="padding-top:28px;padding-bottom:28px;border-top:1px solid var(--line)"><div class="siteos-block__inner"><b>${kit.brand}</b><span style="float:right;opacity:.65">© ${new Date().getFullYear()}</span></div></footer></body></html>`;
}

function ensureBlockStyles(doc) {
  if (doc.getElementById("siteos-block-styles")) return;
  const style = doc.createElement("style");
  style.id = "siteos-block-styles";
  style.textContent = BLOCK_STYLES;
  (doc.head || doc.documentElement).append(style);
}

function pageSections() {
  const doc = ui.frame.contentDocument;
  if (!doc) return [];
  const direct = [...doc.body.children].filter((element) => ["NAV", "HEADER", "MAIN", "SECTION", "FOOTER"].includes(element.tagName));
  if (direct.length) {
    return direct.flatMap((element) => {
      if (element.tagName !== "MAIN") return [element];
      const nested = [...element.children].filter((child) => ["HEADER", "SECTION", "FOOTER", "DIV"].includes(child.tagName));
      return nested.length ? nested : [element];
    });
  }
  return [...doc.querySelectorAll("section, header, footer")];
}

function sectionLabel(element, index) {
  const explicit = element.getAttribute("data-siteos-label");
  const heading = element.querySelector("h1,h2,h3")?.textContent?.trim();
  return (explicit || heading || element.id || element.tagName + " " + (index + 1)).slice(0, 54);
}

function renderStructure() {
  const sections = pageSections();
  ui.structureCount.textContent = sections.length;
  ui.structureList.innerHTML = "";
  sections.forEach((element, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "structure-item" + (state.selected && (element === state.selected || element.contains(state.selected)) ? " active" : "");
    button.innerHTML = `<i>${String(index + 1).padStart(2, "0")}</i><span></span><small>${element.tagName.toLowerCase()}</small>`;
    $("span", button).textContent = sectionLabel(element, index);
    button.addEventListener("click", () => {
      selectElement(element);
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      setPanel("element");
    });
    ui.structureList.append(button);
  });
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
    $$("span", button)[2].textContent = formatDate(project.updatedAt);
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
  state.audit = null;
  state.leads = [];
  state.undo = [];
  state.redo = [];
  state.selected = null;
  ui.projectName.value = state.current.name;
  updatePreviewUrls();
  renderProjects();
  renderFrame();
  updateHistoryButtons();
  void loadLeads();
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
  renderStructure();
}

function rgbToHex(value, fallback = "#ffffff") {
  if (!value || value === "transparent" || value === "rgba(0, 0, 0, 0)") return fallback;
  if (value.startsWith("#")) return value.slice(0, 7);
  const values = value.match(/[\d.]+/g);
  if (!values || values.length < 3) return fallback;
  return "#" + values.slice(0, 3).map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0")).join("");
}

function cssImageUrl(value) {
  const match = String(value || "").trim().match(/^url\((?:["']?)(.*?)(?:["']?)\)$/i);
  return match ? match[1].replace(/\\(["'])/g, "$1") : "";
}

function imageDescriptor(element) {
  if (!element) return null;
  if (element.tagName === "IMG") {
    return { kind: "element", url: element.getAttribute("src") || "", alt: element.getAttribute("alt") || "" };
  }
  const style = ui.frame.contentWindow.getComputedStyle(element);
  const url = cssImageUrl(element.style.backgroundImage) || cssImageUrl(style.backgroundImage);
  if (!url && element.getAttribute("role") !== "img") return null;
  return { kind: "background", url, alt: element.getAttribute("aria-label") || "" };
}

function setImageStatus(message, tone = "") {
  ui.imageStatus.textContent = message;
  ui.imageStatus.className = "image-status" + (tone ? " " + tone : "");
}

function updateImageEditor(descriptor) {
  ui.imageField.hidden = !descriptor;
  if (!descriptor) return;
  const embedded = descriptor.url.startsWith("data:");
  ui.image.value = embedded ? "" : descriptor.url;
  ui.image.placeholder = embedded ? "Grafika osadzona w projekcie" : "https://";
  ui.imageAlt.value = descriptor.alt;
  ui.imagePreview.hidden = !descriptor.url;
  ui.imagePreview.removeAttribute("src");
  if (descriptor.url) ui.imagePreview.src = descriptor.url;
  ui.imageDropLabel.textContent = descriptor.url ? "Kliknij, aby zmienić grafikę" : "Wybierz grafikę z komputera";
  setImageStatus(embedded
    ? "Grafika jest zoptymalizowana i bezpiecznie osadzona w projekcie."
    : "JPG, PNG lub WebP. Duże pliki zoptymalizujemy automatycznie.", embedded ? "success" : "");
}

function applyImageSource(element, source) {
  const descriptor = imageDescriptor(element);
  if (!descriptor || descriptor.kind === "element") {
    if (source) element.setAttribute("src", source);
    else element.removeAttribute("src");
    return;
  }
  element.style.backgroundImage = source ? `url(${JSON.stringify(source)})` : "none";
  if (source) {
    element.setAttribute("role", "img");
    element.style.backgroundPosition ||= "center";
    element.style.backgroundSize ||= "cover";
    element.style.backgroundRepeat ||= "no-repeat";
  }
}

function commitImageUrl() {
  clearTimeout(state.imageInputTimer);
  state.imageInputTimer = null;
  const source = ui.image.value.trim();
  mutate((element) => applyImageSource(element, source));
}

function scheduleImageUrl() {
  clearTimeout(state.imageInputTimer);
  const selected = state.selected;
  state.imageInputTimer = setTimeout(() => {
    if (state.selected === selected) commitImageUrl();
  }, 450);
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Nie udało się przetworzyć grafiki.")),
    "image/webp",
    quality
  ));
}

function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Nie udało się odczytać grafiki."));
    reader.readAsDataURL(blob);
  });
}

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Starsze silniki korzystają z kompatybilnej ścieżki poniżej.
    }
  }
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url)
    });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Nie udało się odczytać tej grafiki."));
    };
    image.src = url;
  });
}

async function optimizeImage(file) {
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(file.type)) throw new Error("Wybierz plik JPG, PNG lub WebP.");
  if (file.size > 15 * 1024 * 1024) throw new Error("Grafika jest większa niż 15 MB. Wybierz mniejszy plik.");

  const decoded = await decodeImage(file);
  try {
    let scale = Math.min(1, 1800 / Math.max(decoded.width, decoded.height));
    let quality = 0.86;
    let blob;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(decoded.width * scale));
      canvas.height = Math.max(1, Math.round(decoded.height * scale));
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("Przeglądarka nie może przetworzyć tej grafiki.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
      blob = await canvasBlob(canvas, quality);
      if (blob.size <= 700 * 1024 || Math.max(canvas.width, canvas.height) <= 720) break;
      scale *= 0.82;
      quality = Math.max(0.62, quality - 0.06);
    }
    if (!blob) throw new Error("Nie udało się przygotować grafiki.");
    return { dataUrl: await blobDataUrl(blob), size: blob.size };
  } finally {
    decoded.close();
  }
}

async function uploadSelectedImage(file) {
  if (!file || !state.selected || !imageDescriptor(state.selected)) return;
  const selected = state.selected;
  ui.imageUploadBtn.disabled = true;
  setImageStatus("Optymalizuję grafikę…");
  try {
    const result = await optimizeImage(file);
    if (state.selected !== selected) throw new Error("Zaznaczenie zmieniło się podczas wczytywania grafiki.");
    mutate((element) => applyImageSource(element, result.dataUrl));
    const kb = Math.max(1, Math.round(result.size / 1024));
    setImageStatus(`Gotowe. Grafika zajmuje ${kb} KB i jest osadzona w projekcie.`, "success");
    toast("Grafika została dodana.");
  } catch (error) {
    setImageStatus(error.message || "Nie udało się dodać grafiki.", "error");
    toast(error.message || "Nie udało się dodać grafiki.");
  } finally {
    ui.imageUploadBtn.disabled = false;
    ui.imageUpload.value = "";
  }
}

function updateSelectionPanel() {
  const element = state.selected;
  ui.emptySelection.hidden = Boolean(element);
  ui.elementControls.hidden = !element;
  if (!element) return;
  const tag = element.tagName.toLowerCase();
  const style = ui.frame.contentWindow.getComputedStyle(element);
  const publicClass = [...element.classList].find((name) => !name.startsWith("siteos-"));
  const label = element.id ? tag + "#" + element.id : publicClass ? tag + "." + publicClass : imageDescriptor(element) ? tag + ".grafika" : tag;
  ui.selectedName.textContent = label || tag;
  ui.text.disabled = element.children.length > 0 || ["IMG", "INPUT", "TEXTAREA", "SELECT", "VIDEO"].includes(element.tagName);
  ui.text.value = ui.text.disabled ? "Zaznacz element tekstowy wewnątrz tej sekcji." : element.textContent.trim();
  ui.linkField.hidden = element.tagName !== "A";
  ui.link.value = element.getAttribute("href") || "";
  updateImageEditor(imageDescriptor(element));
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
  renderStructure();
  syncSeoFields();
}

function insertSection(type) {
  const html = SECTION_TEMPLATES[type];
  const doc = ui.frame.contentDocument;
  if (!html || !doc || !state.current) return;
  const before = snapshot();
  ensureBlockStyles(doc);
  const template = doc.createElement("template");
  template.innerHTML = html.trim();
  const section = template.content.firstElementChild;
  const selectedSection = state.selected?.closest?.("section,header,main,footer");
  if (selectedSection && selectedSection !== doc.querySelector("footer")) selectedSection.after(section);
  else {
    const footer = doc.querySelector("footer");
    if (footer) footer.before(section);
    else doc.body.append(section);
  }
  recordMutation(before);
  selectElement(section);
  section.scrollIntoView({ behavior: "smooth", block: "center" });
  setPanel("element");
  toast("Sekcja dodana. Kliknij tekst, aby go zmienić.");
}

function applyPalette(name) {
  const palette = PALETTES[name];
  const doc = ui.frame.contentDocument;
  if (!palette || !doc || !state.current) return;
  const before = snapshot();
  const root = doc.documentElement.style;
  root.setProperty("--ink", palette.ink);
  root.setProperty("--foreground", palette.ink);
  root.setProperty("--paper", palette.paper);
  root.setProperty("--background", palette.paper);
  root.setProperty("--green", palette.brand);
  root.setProperty("--brand", palette.brand);
  root.setProperty("--coral", palette.accent);
  root.setProperty("--accent", palette.accent);
  root.setProperty("--line", palette.line);
  doc.body.style.backgroundColor = palette.paper;
  doc.body.style.color = palette.ink;
  recordMutation(before);
  toast("Paleta marki zastosowana.");
}

function syncSeoFields() {
  const doc = ui.frame.contentDocument;
  if (!doc) return;
  ui.seoTitle.value = doc.title || "";
  ui.seoDescription.value = doc.querySelector('meta[name="description"]')?.getAttribute("content") || "";
}

function saveSeo() {
  const doc = ui.frame.contentDocument;
  if (!doc || !state.current) return;
  const before = snapshot();
  doc.title = ui.seoTitle.value.trim() || state.current.name;
  let description = doc.querySelector('meta[name="description"]');
  if (!description) {
    description = doc.createElement("meta");
    description.setAttribute("name", "description");
    doc.head.append(description);
  }
  description.setAttribute("content", ui.seoDescription.value.trim());
  recordMutation(before);
  toast("Tytuł i opis SEO zapisane.");
}

function auditPage() {
  const doc = ui.frame.contentDocument;
  if (!doc) return null;
  const title = doc.title.trim();
  const description = doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || "";
  const h1s = doc.querySelectorAll("h1");
  const images = [...doc.querySelectorAll("img")];
  const backgroundImages = [...doc.querySelectorAll('[role="img"]')].filter((element) => imageDescriptor(element)?.kind === "background");
  const missingAlt = [
    ...images.filter((image) => !image.getAttribute("alt")?.trim()),
    ...backgroundImages.filter((image) => !image.getAttribute("aria-label")?.trim())
  ];
  const links = [...doc.querySelectorAll("a")];
  const emptyLinks = links.filter((link) => !link.getAttribute("href")?.trim());
  const buttonsWithoutType = [...doc.querySelectorAll("button:not([type])")];
  const forms = [...doc.querySelectorAll("form")];
  const fieldsWithoutLabels = [...doc.querySelectorAll("input:not([type=hidden]),textarea,select")].filter((field) => !field.closest("label") && !field.id);
  const styleText = [...doc.querySelectorAll("style")].map((style) => style.textContent).join(" ");
  const ctas = [...doc.querySelectorAll("a,button")].filter((element) => /kontakt|rozmow|kup|wyprób|zacznij|umów|zamów|ofert|demo|zapyt/i.test(element.textContent));
  const sections = pageSections();
  const checks = [
    { key: "title", label: "Tytuł ma 10–65 znaków", pass: title.length >= 10 && title.length <= 65, weight: 12 },
    { key: "description", label: "Opis SEO ma 70–170 znaków", pass: description.length >= 70 && description.length <= 170, weight: 12 },
    { key: "h1", label: "Strona ma dokładnie jeden nagłówek H1", pass: h1s.length === 1, weight: 12 },
    { key: "alt", label: "Wszystkie zdjęcia mają opis alternatywny", pass: missingAlt.length === 0, weight: 10 },
    { key: "viewport", label: "Widok mobilny jest poprawnie skonfigurowany", pass: Boolean(doc.querySelector('meta[name="viewport"]')), weight: 10 },
    { key: "responsive", label: "Projekt zawiera reguły dla telefonu", pass: /@media/i.test(styleText), weight: 10 },
    { key: "cta", label: "Jest czytelne wezwanie do działania", pass: ctas.length > 0, weight: 10 },
    { key: "structure", label: "Strona ma co najmniej cztery logiczne części", pass: sections.length >= 4, weight: 8 },
    { key: "links", label: "Linki nie są puste", pass: emptyLinks.length === 0, weight: 6 },
    { key: "forms", label: "Pola formularzy mają etykiety", pass: forms.length === 0 || fieldsWithoutLabels.length === 0, weight: 6 },
    { key: "lang", label: "Ustawiono język dokumentu", pass: Boolean(doc.documentElement.lang), weight: 4 }
  ];
  const score = Math.max(0, 100 - checks.filter((check) => !check.pass).reduce((sum, check) => sum + check.weight, 0));
  return { score, checks, missingAlt, emptyLinks, buttonsWithoutType };
}

function renderAudit() {
  const result = auditPage();
  if (!result) return;
  state.audit = result;
  ui.auditScore.textContent = result.score + "/100 · " + (result.score >= 90 ? "gotowa" : result.score >= 72 ? "blisko celu" : "wymaga pracy");
  ui.auditMeter.style.width = result.score + "%";
  ui.auditMeter.style.background = result.score >= 90 ? "var(--green)" : result.score >= 72 ? "var(--yellow)" : "var(--coral)";
  ui.auditResults.innerHTML = result.checks.map((check) => `<div class="audit-item ${check.pass ? "pass" : "warn"}"><i>${check.pass ? "✓" : "!"}</i><span>${check.label}</span></div>`).join("");
  $("#fixAuditBtn").hidden = result.checks.every((check) => check.pass);
  return result;
}

function fixAudit() {
  const doc = ui.frame.contentDocument;
  if (!doc || !state.current) return;
  const before = snapshot();
  if (!doc.documentElement.lang) doc.documentElement.lang = "pl";
  if (!doc.querySelector('meta[name="viewport"]')) {
    const viewport = doc.createElement("meta");
    viewport.name = "viewport";
    viewport.content = "width=device-width,initial-scale=1";
    doc.head.append(viewport);
  }
  if (!doc.title.trim() || doc.title.trim().length < 10) doc.title = (doc.querySelector("h1")?.textContent || state.current.name).trim().slice(0, 65);
  let description = doc.querySelector('meta[name="description"]');
  if (!description) {
    description = doc.createElement("meta");
    description.name = "description";
    doc.head.append(description);
  }
  if ((description.content || "").trim().length < 70) {
    const source = [...doc.querySelectorAll("p")].map((p) => p.textContent.trim()).find((text) => text.length >= 70) || `Poznaj ${state.current.name} i zobacz ofertę przygotowaną z myślą o jakości, wygodzie oraz mierzalnych rezultatach.`;
    description.content = source.slice(0, 170);
  }
  const h1s = [...doc.querySelectorAll("h1")];
  if (h1s.length === 0) {
    const firstHeading = doc.querySelector("h2,h3");
    if (firstHeading) {
      const h1 = doc.createElement("h1");
      [...firstHeading.attributes].forEach((attribute) => h1.setAttribute(attribute.name, attribute.value));
      h1.innerHTML = firstHeading.innerHTML;
      firstHeading.replaceWith(h1);
    }
  } else if (h1s.length > 1) {
    h1s.slice(1).forEach((heading) => {
      const h2 = doc.createElement("h2");
      [...heading.attributes].forEach((attribute) => h2.setAttribute(attribute.name, attribute.value));
      h2.innerHTML = heading.innerHTML;
      heading.replaceWith(h2);
    });
  }
  [...doc.querySelectorAll("img")].forEach((image, index) => {
    if (!image.getAttribute("alt")?.trim()) image.alt = `${state.current.name} — zdjęcie ${index + 1}`;
  });
  [...doc.querySelectorAll('[role="img"]')].forEach((image, index) => {
    if (!image.getAttribute("aria-label")?.trim()) image.setAttribute("aria-label", `${state.current.name} — grafika ${index + 1}`);
  });
  [...doc.querySelectorAll('a[target="_blank"]')].forEach((link) => link.setAttribute("rel", "noopener noreferrer"));
  [...doc.querySelectorAll("button:not([type])")].forEach((button) => button.type = "button");
  recordMutation(before);
  renderAudit();
  toast("Bezpieczne poprawki jakości zostały zastosowane.");
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadHtml() {
  if (!state.current) return;
  downloadFile(safeName(state.current.name).replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() + ".html", serializeFrame(), "text/html;charset=utf-8");
  toast("Plik HTML jest gotowy.");
}

async function loadLeads() {
  if (!state.current) return;
  try {
    const data = await api("/api/leads/" + state.current.id);
    state.leads = data.leads || [];
    ui.leadCount.textContent = state.leads.length;
    ui.leadList.innerHTML = "";
    if (!state.leads.length) {
      ui.leadList.innerHTML = "<p>Brak zapytań. Opublikuj link i dodaj formularz leadowy.</p>";
      return;
    }
    state.leads.slice(0, 6).forEach((lead) => {
      const item = document.createElement("div");
      item.className = "lead-item";
      item.innerHTML = "<strong></strong><span></span>";
      $("strong", item).textContent = lead.name || lead.email || "Nowe zapytanie";
      $("span", item).textContent = [lead.email, lead.phone, formatDate(lead.createdAt)].filter(Boolean).join(" · ");
      ui.leadList.append(item);
    });
  } catch {
    ui.leadList.innerHTML = "<p>Nie udało się pobrać zapytań.</p>";
  }
}

function exportLeads() {
  if (!state.leads.length) return toast("Nie ma jeszcze kontaktów do eksportu.");
  const quote = (value) => `"${String(value || "").replaceAll('"', '""')}"`;
  const csv = ["Imię,E-mail,Telefon,Wiadomość,Data", ...state.leads.map((lead) => [lead.name, lead.email, lead.phone, lead.message, new Date(lead.createdAt).toISOString()].map(quote).join(","))].join("\n");
  downloadFile("site-os-leady.csv", "\ufeff" + csv, "text/csv;charset=utf-8");
}

function updatePreviewUrls() {
  if (!state.current) return;
  const path = "/p/" + state.current.id;
  ui.localPreview.value = location.origin + path;
  ui.publicPreview.value = state.tunnelUrl ? state.tunnelUrl + path : "";
  $("#previewAddress").textContent = state.current.name + " · podgląd lokalny";
}

async function createProject(html, name = "Nowy projekt") {
  const data = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, html: html || undefined })
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
  if (name === "sections") renderStructure();
  if (name === "publish") void loadLeads();
}

async function importedHtml(file) {
  if (!/\.html?$/i.test(file.name) && !["text/html", "application/xhtml+xml"].includes(file.type)) {
    throw new Error("Wybierz plik HTML.");
  }
  if (file.size > 7 * 1024 * 1024) throw new Error("Plik HTML jest większy niż 7 MB.");
  const html = await file.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!html.trim() || !doc.documentElement || (!doc.body.children.length && !doc.head.children.length)) {
    throw new Error("Plik nie zawiera poprawnej strony HTML.");
  }
  return html;
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
  $("#newProjectBtn").addEventListener("click", () => ui.projectDialog.showModal());
  $("#closeProjectDialog").addEventListener("click", () => ui.projectDialog.close());
  ui.projectDialog.addEventListener("click", (event) => {
    if (event.target === ui.projectDialog) ui.projectDialog.close();
  });
  $$("[data-starter]").forEach((button) => button.addEventListener("click", async () => {
    const names = { service: "Aurelia Studio", product: "Flowbase", local: "Soma House", blank: "Nowy projekt" };
    button.disabled = true;
    try {
      await createProject(projectTemplate(button.dataset.starter), names[button.dataset.starter]);
      ui.projectDialog.close();
      toast("Projekt jest gotowy do edycji.");
    } finally {
      button.disabled = false;
    }
  }));
  $("#deleteBtn").addEventListener("click", deleteProject);
  $("#importBtn").addEventListener("click", () => $("#importInput").click());
  $("#importInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await createProject(await importedHtml(file));
      toast("Strona HTML została zaimportowana.");
    } catch (error) {
      toast(error.message || "Nie udało się zaimportować strony.");
    } finally {
      event.target.value = "";
    }
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
  $$("[data-section]").forEach((button) => button.addEventListener("click", () => insertSection(button.dataset.section)));
  $$("[data-palette]").forEach((button) => button.addEventListener("click", () => applyPalette(button.dataset.palette)));

  ui.text.addEventListener("change", () => mutate((element) => { if (!ui.text.disabled) element.textContent = ui.text.value; }));
  ui.link.addEventListener("change", () => mutate((element) => element.setAttribute("href", ui.link.value)));
  ui.image.addEventListener("input", scheduleImageUrl);
  ui.image.addEventListener("change", commitImageUrl);
  ui.image.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitImageUrl();
      ui.image.blur();
    }
  });
  ui.imageAlt.addEventListener("change", () => mutate((element) => {
    const descriptor = imageDescriptor(element);
    if (descriptor?.kind === "element") element.setAttribute("alt", ui.imageAlt.value.trim());
    else {
      element.setAttribute("role", "img");
      element.setAttribute("aria-label", ui.imageAlt.value.trim());
    }
  }));
  ui.imageUploadBtn.addEventListener("click", () => ui.imageUpload.click());
  ui.imageDropzone.addEventListener("click", () => ui.imageUpload.click());
  ui.imageUpload.addEventListener("change", () => uploadSelectedImage(ui.imageUpload.files?.[0]));
  ["dragenter", "dragover"].forEach((name) => ui.imageDropzone.addEventListener(name, (event) => {
    event.preventDefault();
    ui.imageDropzone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((name) => ui.imageDropzone.addEventListener(name, (event) => {
    event.preventDefault();
    ui.imageDropzone.classList.remove("dragging");
  }));
  ui.imageDropzone.addEventListener("drop", (event) => uploadSelectedImage(event.dataTransfer?.files?.[0]));
  ui.imagePreview.addEventListener("error", () => {
    ui.imagePreview.hidden = true;
    setImageStatus("Nie udało się wczytać grafiki spod tego adresu.", "error");
  });
  ui.imageRemoveBtn.addEventListener("click", () => mutate((element) => applyImageSource(element, "")));
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
  $("#runAuditBtn").addEventListener("click", () => renderAudit());
  $("#fixAuditBtn").addEventListener("click", fixAudit);
  $("#runPublishAuditBtn").addEventListener("click", () => {
    renderAudit();
    setPanel("jarvis");
  });
  $("#saveSeoBtn").addEventListener("click", saveSeo);
  $("#downloadHtmlBtn").addEventListener("click", downloadHtml);
  $("#exportLeadsBtn").addEventListener("click", exportLeads);
  $("#startTunnelBtn").addEventListener("click", startTunnel);
  $("#stopTunnelBtn").addEventListener("click", stopTunnel);
  $$("[data-copy]").forEach((button) => button.addEventListener("click", async () => {
    const input = $("#" + button.dataset.copy);
    await navigator.clipboard.writeText(input.value);
    toast("Link skopiowany.");
  }));
  document.addEventListener("keydown", (event) => {
    const command = event.ctrlKey || event.metaKey;
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable;
    if (command && event.key.toLowerCase() === "s") {
      event.preventDefault();
      flushSave();
      toast("Projekt zapisany.");
    }
    if (!typing && command && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      $("#undoBtn").click();
    }
    if (!typing && command && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) {
      event.preventDefault();
      $("#redoBtn").click();
    }
    if (event.key === "Escape" && ui.projectDialog.open) ui.projectDialog.close();
  });
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
