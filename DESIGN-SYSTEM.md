# Jarvis Website Design System

A clean, premium, conversion-focused design system for a modern marketing site.
Built mobile-first with a single token source of truth, then composed into
reusable components and a full landing page.

> **Feel:** modern · professional · elegant · trustworthy · animated · high-end · fast · mobile-first

---

## 1. Structure

```
.
├── index.html                 # Full 11-section landing page
├── assets/
│   ├── css/
│   │   ├── tokens.css         # :root design tokens (source of truth)
│   │   ├── base.css           # reset, typography, layout utilities, reveal
│   │   └── components.css      # all UI components + responsive rules
│   └── js/
│       └── main.js            # header, nav, scroll-reveal, counters, FAQ
└── DESIGN-SYSTEM.md           # this file
```

Load order matters: `tokens → base → components`.

---

## 2. Design Tokens (audited & mapped)

All tokens live in `assets/css/tokens.css` under `:root`, grouped by domain.
Components consume **semantic** tokens, never raw palette values.

### Colors
| Token | Value | Use |
|---|---|---|
| `--color-primary` | indigo 500 | buttons, links, focus |
| `--color-secondary` | cyan 500 | highlights |
| `--color-accent` | violet 500 | accents, gradients |
| `--color-bg` / `--color-bg-subtle` | white / slate-50 | page & alt sections |
| `--color-surface` | white | cards, panels |
| `--color-text` / `--color-text-muted` | slate-900 / slate-500 | body / secondary text |
| `--color-border` | slate-200 | dividers, inputs |
| `--gradient-brand` | indigo → violet | primary CTA, marks |
| `--gradient-text` | white → violet → cyan | hero headline |

A full dark theme is available via `[data-theme="dark"]` (token overrides only).

### Typography
- **Family:** Inter (display + body), JetBrains Mono (code).
- **Scale:** fluid `clamp()` steps `--text-xs … --text-5xl` (mobile → desktop).
- **Weights:** 300–800 mapped to `--font-light … --font-extra`.
- **Roles:** headings, body (`--leading-normal`), labels (`.eyebrow`), buttons (`--font-semibold`).

### Spacing
8px base scale (`--space-1 … --space-20`) plus layout tokens:
`--section-py`, `--container-max`, `--container-pad`, `--grid-gap`, `--card-pad`.

### Radius
`--radius-md` buttons · `--radius-lg` cards · `--radius-xl` panels · `--radius-pill`.

### Shadows
`--shadow-soft` · `--shadow-elevated` · `--shadow-hover` · `--shadow-glow`.

### Motion
Durations `--t-fast/base/smooth/slow` × easings `--ease-out/in-out/spring`,
composed into `--transition-fast/base/hover`. All motion respects
`prefers-reduced-motion`.

---

## 3. Responsive Breakpoints

| Target | Width | Behavior |
|---|---|---|
| Desktop | 1440px | full multi-column layouts |
| Laptop | 1024px | 4-col → 2-col, hero split → stacked |
| Tablet | 768px | grids → 1-col, hamburger nav |
| Mobile | 390px | single column, full-width CTAs |

Mobile-first: base styles target small screens; `max-width` media queries
progressively adapt up. Type and spacing also scale fluidly via `clamp()`.

---

## 4. Component Variants

| Component | Variants |
|---|---|
| **Header** | `--transparent` · `--solid` · sticky (`.is-scrolled`, JS-toggled) |
| **Hero** | `--split` · `--media` (image/video bg) · gradient (default) |
| **Buttons** | `--primary` · `--secondary` · `--outline` · `--ghost` (+ `--on-dark`, `--lg/sm`, `--block`, `--pill`) |
| **Cards** | `--service` · `--portfolio` · `--testimonial` · pricing (`.price-card`, `--featured`) |
| **Forms** | contact (`.form-card` + `.form-grid`) · lead · newsletter (`.newsletter`) |
| **Sections** | `--light` · `--subtle` · `--dark` · `--accent` · `--image` |

---

## 5. Landing Page Structure

`index.html` ships the full conversion flow:

1. **Hero** — headline + dual CTA + animated metrics + product mock
2. **Problem** — three pain points
3. **Solution** — animated stat band on dark/image section
4. **Services** — six-feature grid
5. **Portfolio / case studies** — outcome cards with metrics
6. **Benefits** — split feature list + visual
7. **Process** — three numbered steps
8. **Testimonials** — three review cards
9. **Pricing** — three tiers, featured plan
10. **FAQ** — accessible `<details>` accordion
11. **Final CTA + Footer** — gradient banner + 4-column footer

---

## 6. Interactions (`main.js`)

- Sticky header state on scroll (`.is-scrolled`)
- Accessible mobile nav (hamburger, ESC-to-close, link auto-close)
- `IntersectionObserver` scroll reveals (`[data-reveal]`, `data-delay`)
- Animated counters (`[data-count]`, `data-suffix`)
- One-open-at-a-time FAQ accordion
- Auto-updating footer year

All progressive enhancement — the page is fully readable with JS disabled.

---

## 7. Usage

Open `index.html` in any browser — no build step. To reuse the system,
copy `assets/css/*` into a project and compose components with the documented
class names. Tune the brand by editing **only** `tokens.css`.

### Note on the Stitch / Figma MCP import
The requested `claude mcp add stitch …` server is registered from your **local**
Claude Code CLI; it cannot be added from this remote container, and the API key
is intentionally not stored in the repo. Once configured locally (or once a
`claude.ai/design` project is connected), this component library can be pushed
incrementally with the `/design-sync` workflow — the tokens and component files
here are already structured for that sync.
