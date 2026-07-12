# Figure Studio v2 — Publication-Grade Figures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every figure Figure Studio emits look native to a top-venue LaTeX paper — Computer Modern text, real typeset math, print-true sizing — with the web-card idiom made a hard lint failure.

**Architecture:** Keep the proven render→lint→review loop (browser computes every coordinate; the agent types none) and re-teach every layer that defines "good": tokens v2 with the KaTeX dist's CM-derived fonts, vendored KaTeX for math, 96dpi print-true viewports, three new lint rules over an extended bbox manifest, templates in paper idiom, self-authored exemplars, and version-aware asset refresh in scaffold.

**Tech Stack:** TypeScript MCP server on bun (`figures-mcp/`); Playwright Chromium driven from `src/render-worker.mjs` under **node** (Playwright hangs under bun in this repo — never move browser work into the bun process); KaTeX (npm, vendored — no CDN); `bun test`.

**Spec:** `docs/superpowers/specs/2026-07-13-figure-studio-publication-grade-design.md`

## Global Constraints

- Repo root is `C:/Users/azamk/Documents` (mega-repo). **Never `git add -A`** — stage explicit paths. All paths below are relative to `C:/Users/azamk/Documents/Paperino/figures-mcp/` unless prefixed with `Paperino/`.
- Everything a figure loads is served from the workspace `figures/` dir over the render worker's loopback HTTP server. **No CDN, no network at render time.**
- Colors in `figure.html` only via `var(--…)` (lint rule 5 fails raw hex/rgb).
- px↔pt mapping is Chromium's 96dpi: **12px = 9pt, 9.34px = 7pt, 528px = 5.5in, 312px = 3.25in**.
- Fonts and KaTeX are pinned via the `katex` npm package and committed as vendored assets (SIL OFL); they are design inputs, not build output.
- Tests: `bun test` inside `figures-mcp/`. Render tests need Playwright chromium already installed (it is; error remediation is `bunx playwright install chromium`).
- Commit after every task with the exact paths listed in that task.

---

### Task 1: Vendor KaTeX + `lib/math.js`

**Files:**
- Modify: `package.json` (add `katex` devDependency — source of the vendored dist)
- Create: `src/assets/lib/katex/katex.min.css`, `src/assets/lib/katex/katex.mjs`, `src/assets/lib/katex/fonts/*.woff2` (copied from the npm dist)
- Create: `src/assets/lib/math.js`
- Test: `test/assets.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: workspace-relative module `../lib/math.js` exporting `renderMath(): Promise<void>` — templates (Task 5), exemplars (Task 7), and the GQA figure (Task 9) call `await renderMath()` **before** annotations and `figReady()`. Also the vendored dir layout `lib/katex/{katex.min.css,katex.mjs,fonts/}` that tokens.css (Task 2) references.

- [ ] **Step 1: Write the failing test**

Create `test/assets.test.ts`:

```ts
import { expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const KATEX = join(import.meta.dir, "..", "src", "assets", "lib", "katex")

test("katex dist is vendored (css, esm, woff2 fonts)", () => {
  expect(existsSync(join(KATEX, "katex.min.css"))).toBe(true)
  expect(existsSync(join(KATEX, "katex.mjs"))).toBe(true)
  const fonts = readdirSync(join(KATEX, "fonts")).filter((f) => f.endsWith(".woff2"))
  // Main (4 weights/styles), Math, Size1-4, Typewriter, AMS, Caligraphic, Fraktur, SansSerif, Script
  expect(fonts.length).toBeGreaterThanOrEqual(15)
  expect(fonts).toContain("KaTeX_Main-Regular.woff2")
  expect(fonts).toContain("KaTeX_Typewriter-Regular.woff2")
})

test("math.js exists and renders .math spans via the vendored katex", () => {
  const src = readFileSync(join(import.meta.dir, "..", "src", "assets", "lib", "math.js"), "utf8")
  expect(src).toContain("katex/katex.mjs")
  expect(src).toContain("throwOnError: true")
  expect(src).toContain("document.fonts.ready")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Users/azamk/Documents/Paperino/figures-mcp && bun test test/assets.test.ts`
Expected: FAIL — `katex.min.css` does not exist.

- [ ] **Step 3: Install katex and copy the dist**

```bash
cd C:/Users/azamk/Documents/Paperino/figures-mcp
bun add -d katex
mkdir -p src/assets/lib/katex/fonts
cp node_modules/katex/dist/katex.min.css src/assets/lib/katex/
cp node_modules/katex/dist/katex.mjs src/assets/lib/katex/
cp node_modules/katex/dist/fonts/*.woff2 src/assets/lib/katex/fonts/
```

(`katex.min.css` references `fonts/…` relatively, which matches this layout. Only woff2 is copied; Chromium always picks the woff2 source.)

- [ ] **Step 4: Write `src/assets/lib/math.js`**

```js
// figures/lib/math.js — typeset every .math span with the vendored KaTeX (offline).
//
// Templates call `await renderMath()` BEFORE annotations and figReady(), so the bbox
// manifest and the PDF always see final glyph geometry. A .math span holds raw TeX:
//   <span class="math">\sigma^2_{\mathrm{ch}} \lesssim (d/g)\,\sigma^2_{\mathrm{vec}}</span>
// Add class "display" for display-mode math.
const here = new URL(".", import.meta.url)

export async function renderMath() {
  const spans = document.querySelectorAll(".math")
  if (spans.length === 0) return

  if (!document.getElementById("katex-css")) {
    const link = document.createElement("link")
    link.id = "katex-css"
    link.rel = "stylesheet"
    link.href = new URL("katex/katex.min.css", here).href
    document.head.appendChild(link)
    await new Promise((resolve) => {
      link.onload = resolve
      link.onerror = resolve
    })
  }

  const katex = (await import(new URL("katex/katex.mjs", here).href)).default
  for (const el of spans) {
    // throwOnError: a bad formula must fail the render loudly (render-worker surfaces
    // __FIG_ERROR__ / console), never paint garbage into a paper.
    katex.render(el.textContent, el, { throwOnError: true, displayMode: el.classList.contains("display") })
  }
  // KaTeX fonts load lazily as glyphs render; geometry is only final after this.
  await document.fonts.ready
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/assets.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/figures-mcp/package.json Paperino/figures-mcp/bun.lock \
  Paperino/figures-mcp/src/assets/lib/katex Paperino/figures-mcp/src/assets/lib/math.js \
  Paperino/figures-mcp/test/assets.test.ts
git commit -m "feat(figures): vendor KaTeX + lib/math.js for real typeset math"
```

(If `bun.lock` doesn't exist, stage `bun.lockb` instead — whichever the install produced.)

---

### Task 2: tokens.css v2

**Files:**
- Modify: `src/assets/tokens.css` (full replacement)
- Test: `test/assets.test.ts` (extend)

**Interfaces:**
- Consumes: `lib/katex/fonts/` layout from Task 1 (paths are relative to the vendored `figures/tokens.css`, which sits one level above `figures/lib/`).
- Produces: CSS custom properties and classes used by templates (Task 5) and exemplars (Task 7): `--bg --surface --border --border-strong --text --text-muted --accent --accent-warm --font-text --font-mono --fs-body --fs-label --fs-small --stroke --stroke-thin`, classes `.card .panel-label .mono .muted .math`. First line is the version marker `/* paperino-tokens v2 */` consumed by scaffold (Task 6).

- [ ] **Step 1: Extend the test (failing)**

Append to `test/assets.test.ts`:

```ts
test("tokens.css is v2 publication style", () => {
  const css = readFileSync(join(import.meta.dir, "..", "src", "assets", "tokens.css"), "utf8")
  expect(css.split("\n")[0]).toBe("/* paperino-tokens v2 */")
  expect(css).toContain('font-family: "KaTeX_Main"')
  expect(css).toContain(".panel-label")
  expect(css).not.toContain("Segoe UI")
  expect(css).not.toContain("border-radius: 8px")
})
```

Run: `bun test test/assets.test.ts` → Expected: FAIL (`Segoe UI` present, no version marker).

- [ ] **Step 2: Replace `src/assets/tokens.css` entirely**

```css
/* paperino-tokens v2 */
/* Publication style (spec 2026-07-13). Figures reference ONLY these vars; raw hex/rgb
   in figure.html is a lint failure. Text faces are the KaTeX dist's Computer-Modern-
   derived fonts (SIL OFL), served from lib/katex/fonts/ — declared here so text works
   in figures that contain no math. The first line above is a version marker: scaffold
   refreshes vendored copies when it differs. */
@font-face { font-family: "KaTeX_Main"; src: url("lib/katex/fonts/KaTeX_Main-Regular.woff2") format("woff2"); font-weight: 400; font-style: normal; }
@font-face { font-family: "KaTeX_Main"; src: url("lib/katex/fonts/KaTeX_Main-Bold.woff2") format("woff2"); font-weight: 700; font-style: normal; }
@font-face { font-family: "KaTeX_Main"; src: url("lib/katex/fonts/KaTeX_Main-Italic.woff2") format("woff2"); font-weight: 400; font-style: italic; }
@font-face { font-family: "KaTeX_Main"; src: url("lib/katex/fonts/KaTeX_Main-BoldItalic.woff2") format("woff2"); font-weight: 700; font-style: italic; }
@font-face { font-family: "KaTeX_Typewriter"; src: url("lib/katex/fonts/KaTeX_Typewriter-Regular.woff2") format("woff2"); font-weight: 400; font-style: normal; }
:root {
  /* ink */
  --bg: #ffffff;
  --surface: #f5f5f5;          /* the only fill; use sparingly */
  --border: #999999;
  --border-strong: #333333;
  --text: #111111;
  --text-muted: #555555;
  /* two accents, distinguishable in grayscale (lint: <= 5 categorical) */
  --accent: #1a4f9c;           /* restrained blue */
  --accent-warm: #b03a2e;      /* warm red */
  /* type — pt-true at the 96dpi PDF mapping (12px = 9pt) */
  --font-text: "KaTeX_Main", Georgia, serif;
  --font-mono: "KaTeX_Typewriter", Consolas, monospace;
  --fs-body: 12px;             /* 9pt */
  --fs-label: 10.67px;         /* 8pt */
  --fs-small: 9.34px;          /* 7pt — the lint floor */
  /* strokes */
  --stroke: 1.6px;             /* 1.2pt emphasis */
  --stroke-thin: 1.07px;       /* 0.8pt hairline */
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-text);
  font-size: var(--fs-body);
}
/* A paper box: square corners, hairline border, no fill, no shadow. */
.card {
  background: var(--bg);
  border: var(--stroke-thin) solid var(--border-strong);
  border-radius: 0;
  padding: 8px 10px;
}
.card h3 { margin: 0 0 4px; font-size: var(--fs-body); font-weight: 700; }
.card p { margin: 0; color: var(--text-muted); font-size: var(--fs-label); }
.panel-label { font-weight: 700; font-size: var(--fs-body); }   /* (a) (b) (c) */
.mono { font-family: var(--font-mono); font-size: var(--fs-label); }  /* real code ONLY — math goes in .math spans */
.muted { color: var(--text-muted); }
/* KaTeX target; lib/math.js renders these. Keep font-size inherited. */
.math {}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `bun test test/assets.test.ts` → Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/figures-mcp/src/assets/tokens.css Paperino/figures-mcp/test/assets.test.ts
git commit -m "feat(figures): publication tokens v2 — CM faces, ink palette, pt-true scale"
```

---

### Task 3: Print-true viewports + manifest extension + crisp review PNG

**Files:**
- Modify: `src/render.ts:7` (`VIEWPORTS`)
- Modify: `src/render-worker.mjs` (newPage options; manifest evaluate block)
- Test: `test/render.test.ts` (update width expectations; assert new manifest fields)

**Interfaces:**
- Consumes: nothing new.
- Produces: `bboxes.json` manifest shape consumed by lint (Task 4):
  - each entry of `texts[]` gains `fontFamily: string` (computed) and `inKatex: boolean` (`el.closest(".katex") !== null`);
  - new top-level `elements: { selector: string; borderRadius: number; boxShadow: string }[]` — only elements with radius > 0 or a shadow, `borderRadius` = max of the four corner radii in px.
  - `VIEWPORTS = { narrow: 312, full: 528 }` (3.25in / 5.5in at 96dpi).

- [ ] **Step 1: Update `src/render.ts` line 7**

```ts
// 96dpi print mapping: 312px = 3.25in (two-column width), 528px = 5.5in (NeurIPS/ICML
// text width). page.pdf sizes the PDF page from these px, so \includegraphics at
// \linewidth lands ~1:1 and a 9pt label is 9pt on the page by construction.
const VIEWPORTS = { narrow: 312, full: 528 } as const
```

- [ ] **Step 2: Update `src/render-worker.mjs`**

(a) Replace:

```js
  const page = await browser.newPage({ viewport: { width, height: 800 } })
```

with:

```js
  // DSF only affects raster output (the review PNG); the PDF and all bbox geometry
  // stay in CSS px.
  const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 3 })
```

(b) In the `page.evaluate` manifest block, replace the `texts.push({...})` object with:

```js
        texts.push({
          selector: cssPath(el),
          text: tn.textContent.trim(),
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
          fontSize: parseFloat(cs.fontSize),
          color: cs.color,
          background: effectiveBackground(el),
          derived: el.closest("[data-derived]") !== null,
          fontFamily: cs.fontFamily,
          inKatex: el.closest(".katex") !== null,
        })
```

(c) After the `strokes` computation and before the `content` height computation, insert:

```js
    // Web-chrome audit: record every element carrying a border radius or shadow.
    // Paper figures have square corners and no shadows (lint rule 12).
    const elements = []
    for (const el of document.querySelectorAll("body *")) {
      const cs2 = getComputedStyle(el)
      const radius = Math.max(
        ...[cs2.borderTopLeftRadius, cs2.borderTopRightRadius, cs2.borderBottomLeftRadius, cs2.borderBottomRightRadius]
          .map((v) => parseFloat(v))
          .map((v) => (Number.isFinite(v) ? v : 0)),
      )
      const shadow = cs2.boxShadow
      const rr = el.getBoundingClientRect()
      if ((radius > 0 || (shadow && shadow !== "none")) && rr.width > 0 && rr.height > 0)
        elements.push({ selector: cssPath(el), borderRadius: radius, boxShadow: shadow })
    }
```

(d) Change the evaluate return to include it:

```js
    return { viewport: { width: window.innerWidth, height }, texts, strokes, elements }
```

- [ ] **Step 3: Update `test/render.test.ts` expectations**

Grep for the old widths: `grep -n "550\|1100" test/render.test.ts` — the smoke fixture uses `full`, so change those expectations to `528`. Add to the existing successful-render assertions:

```ts
      const manifest = JSON.parse(readFileSync(result.bboxes, "utf8"))
      expect(manifest.texts[0].fontFamily).toBeString()
      expect(typeof manifest.texts[0].inKatex).toBe("boolean")
      expect(Array.isArray(manifest.elements)).toBe(true)
```

(`readFileSync` from `node:fs` — add to that file's imports if missing.)

- [ ] **Step 4: Run render tests**

Run: `bun test test/render.test.ts`
Expected: PASS. (These spawn the node worker + Chromium; allow ~30s.)

- [ ] **Step 5: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/figures-mcp/src/render.ts Paperino/figures-mcp/src/render-worker.mjs \
  Paperino/figures-mcp/test/render.test.ts
git commit -m "feat(figures): print-true viewports (3.25in/5.5in), DSF-3 review PNG, manifest chrome/font fields"
```

---

### Task 4: Lint — pt floor with KaTeX exemptions + rules 11–13

**Files:**
- Modify: `src/lint.ts`
- Modify: `src/server.ts:65` (tool description: "10 rules" → 13)
- Test: `test/lint.test.ts`

**Interfaces:**
- Consumes: manifest fields from Task 3 (`fontFamily`, `inKatex`, `elements[]`).
- Produces: `LintError` rules named exactly `pseudo-math`, `web-chrome`, `font-allowlist`; `TextBox` type gains `fontFamily: string; inKatex: boolean`; `LintInput.manifest` gains `elements: ElementBox[]` with `export type ElementBox = { selector: string; borderRadius: number; boxShadow: string }`. Rule 3 floor becomes 7pt (`fontSize * 0.75 >= 7`, KaTeX-internal text exempt); rule 1 skips pairs where both boxes are `inKatex`.

- [ ] **Step 1: Write the failing tests**

In `test/lint.test.ts`, first update the shared fixtures so existing tests keep passing with the new required fields — `box()` gains:

```ts
  fontFamily: '"KaTeX_Main", Georgia, serif',
  inKatex: false,
```

and `base()`'s manifest gains `elements: []` and its viewport width changes `550` → `528`. Then append:

```ts
test("min-type-size is a 7pt floor (9.34px passes, 9px fails)", () => {
  const ok = base({ manifest: { viewport: { width: 528, height: 300 }, texts: [box({ fontSize: 9.34 })], strokes: [], elements: [] } })
  expect(rules(ok)).not.toContain("min-type-size")
  const bad = base({ manifest: { viewport: { width: 528, height: 300 }, texts: [box({ fontSize: 9 })], strokes: [], elements: [] } })
  expect(rules(bad)).toContain("min-type-size")
})

test("KaTeX-internal text is exempt from the type floor (LaTeX scripts are 7/5pt)", () => {
  const m = { viewport: { width: 528, height: 300 }, texts: [box({ fontSize: 8, inKatex: true })], strokes: [], elements: [] }
  expect(rules(base({ manifest: m }))).not.toContain("min-type-size")
})

test("intra-formula overlap is skipped; formula-vs-outside is not", () => {
  const a = box({ selector: "#f1", inKatex: true })
  const b = box({ selector: "#f2", inKatex: true, rect: { x: 12, y: 12, w: 50, h: 14 } })
  const outside = box({ selector: "#t2", rect: { x: 12, y: 12, w: 50, h: 14 } })
  const both = base({ manifest: { viewport: { width: 528, height: 300 }, texts: [a, b], strokes: [], elements: [] } })
  expect(rules(both)).not.toContain("text-overlap")
  const mixed = base({ manifest: { viewport: { width: 528, height: 300 }, texts: [a, outside], strokes: [], elements: [] } })
  expect(rules(mixed)).toContain("text-overlap")
})

test("pseudo-math: TeX-ish plain text fails; same text inside KaTeX passes", () => {
  const bad = base({ manifest: { viewport: { width: 528, height: 300 }, texts: [box({ text: "O(g sigma_vec)" })], strokes: [], elements: [] } })
  expect(rules(bad)).toContain("pseudo-math")
  const bad2 = base({ manifest: { viewport: { width: 528, height: 300 }, texts: [box({ text: "sigma_ch^2 lesssim x" })], strokes: [], elements: [] } })
  expect(rules(bad2)).toContain("pseudo-math")
  const ok = base({ manifest: { viewport: { width: 528, height: 300 }, texts: [box({ text: "\\sigma^2", inKatex: true })], strokes: [], elements: [] } })
  expect(rules(ok)).not.toContain("pseudo-math")
  const prose = base({ manifest: { viewport: { width: 528, height: 300 }, texts: [box({ text: "the alphabet of shared heads" })], strokes: [], elements: [] } })
  expect(rules(prose)).not.toContain("pseudo-math")
})

test("web-chrome: radius > 3px or any shadow fails", () => {
  const m = (elements: any[]) => base({ manifest: { viewport: { width: 528, height: 300 }, texts: [box()], strokes: [], elements } })
  expect(rules(m([{ selector: "#pill", borderRadius: 12, boxShadow: "none" }]))).toContain("web-chrome")
  expect(rules(m([{ selector: "#sh", borderRadius: 0, boxShadow: "rgba(0,0,0,0.2) 0px 2px 8px" }]))).toContain("web-chrome")
  expect(rules(m([{ selector: "#ok", borderRadius: 2, boxShadow: "none" }]))).not.toContain("web-chrome")
})

test("font-allowlist: first resolved face must be KaTeX_*", () => {
  const bad = base({ manifest: { viewport: { width: 528, height: 300 }, texts: [box({ fontFamily: '"Segoe UI", sans-serif' })], strokes: [], elements: [] } })
  expect(rules(bad)).toContain("font-allowlist")
  const ok = base({ manifest: { viewport: { width: 528, height: 300 }, texts: [box({ fontFamily: "KaTeX_Typewriter, monospace" })], strokes: [], elements: [] } })
  expect(rules(ok)).not.toContain("font-allowlist")
})
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `bun test test/lint.test.ts`
Expected: existing tests PASS (fixtures updated), the six new tests FAIL — the new rule names are never emitted, and 9px passes the old `< 9` floor. Confirm failure messages mention `pseudo-math`, `web-chrome`, `font-allowlist`, `min-type-size`.

- [ ] **Step 3: Implement in `src/lint.ts`**

(a) Types — extend `TextBox` and add `ElementBox`:

```ts
export type TextBox = {
  selector: string
  text: string
  rect: { x: number; y: number; w: number; h: number }
  fontSize: number
  color: string
  background: string
  derived: boolean
  fontFamily: string
  inKatex: boolean
}
export type ElementBox = { selector: string; borderRadius: number; boxShadow: string }
```

and in `LintInput.manifest` add `elements: ElementBox[]` after `strokes`.

(b) Rule 1 — add as the first line inside the inner `j` loop:

```ts
      // KaTeX absolutely positions glyph boxes; intra-formula overlap is its layout
      // engine's business (spec §3). Formula-vs-outside checks remain.
      if (texts[i].inKatex && texts[j].inKatex) continue
```

(c) Rule 3 — replace the single line with:

```ts
  // 3 min-type-size: 7pt effective at the 96dpi print mapping. KaTeX-internal text is
  // exempt — LaTeX itself sets scripts at 7/5pt in a 10pt body.
  for (const t of texts) {
    if (t.inKatex) continue
    const pt = t.fontSize * 0.75
    if (pt < 7 - 0.01) err("min-type-size", t.selector, `${t.fontSize}px (${pt.toFixed(2)}pt)`, ">= 7pt (9.34px)")
  }
```

(d) Append rules 11–13 before the `return errors`:

```ts
  // 11 pseudo-math: TeX-ish plain text outside KaTeX output. Symbols belong in .math
  // spans — sigma_ch^2 as literal text is the single most damning artifact in a paper.
  const PSEUDO_MATH =
    /\\[a-zA-Z]+|[A-Za-z0-9]\^|[A-Za-z0-9]_[A-Za-z0-9{(]|\b(?:sigma|Sigma|delta|Delta|epsilon|lambda|theta|alpha|gamma|lesssim|gtrsim|infty|sqrt)\b|\bO\([^)]+\)/
  for (const t of texts)
    if (!t.inKatex && PSEUDO_MATH.test(t.text))
      err("pseudo-math", t.selector, t.text.slice(0, 40), "typeset via a .math span (KaTeX)")

  // 12 web-chrome: paper figures have square corners and no shadows. The radius
  // threshold also catches pill badges (radius = half their height).
  for (const e of input.manifest.elements ?? []) {
    if (e.borderRadius > 3)
      err("web-chrome", e.selector, `border-radius ${e.borderRadius}px`, "<= 3px (square corners)")
    if (e.boxShadow && e.boxShadow !== "none") err("web-chrome", e.selector, `box-shadow ${e.boxShadow.slice(0, 40)}`, "none")
  }

  // 13 font-allowlist: catches silent fallback to Segoe UI / the system serif.
  for (const t of texts) {
    const first = t.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "")
    if (!first.startsWith("KaTeX_"))
      err("font-allowlist", t.selector, first, 'a "KaTeX_*" face from tokens.css')
  }
```

(e) `src/server.ts` line 65 — replace the description string with:

```ts
      "Deterministic quality gate (13 rules: overlap, overflow, 7pt type floor, contrast, raw colors, stroke floor, palette, number provenance, svg viewBox, meta, pseudo-math, web-chrome, font allowlist). Must pass before figure_review. Patch by selector.",
```

- [ ] **Step 4: Run tests**

Run: `bun test test/lint.test.ts`
Expected: PASS (all, including the pre-existing 10-rule tests).

- [ ] **Step 5: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/figures-mcp/src/lint.ts Paperino/figures-mcp/src/server.ts Paperino/figures-mcp/test/lint.test.ts
git commit -m "feat(figures): lint 11-13 (pseudo-math, web-chrome, font allowlist) + 7pt floor with KaTeX exemptions"
```

---

### Task 5: Templates in paper idiom + every-archetype-lints-clean smoke

**Files:**
- Modify: `src/templates/schematic/figure.html`, `src/templates/gallery/figure.html`, `src/templates/chart/figure.html`, `src/templates/table/figure.html` (full replacements)
- Test: create `test/templates.test.ts`

**Interfaces:**
- Consumes: `renderMath()` (Task 1), tokens v2 classes (Task 2), `scaffold(workspace, opts)` from `src/scaffold`, `render(workspace, name)` from `src/render`, `lint` from `src/lint`.
- Produces: the four archetype starting points every future figure is scaffolded from. Contract: **a freshly scaffolded figure of any archetype renders and passes all 13 lint rules out of the box** (given minimal data for chart/table/gallery).

- [ ] **Step 1: Write the failing smoke test**

Create `test/templates.test.ts`:

```ts
import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse } from "yaml"
import { scaffold } from "../src/scaffold"
import { render } from "../src/render"
import { lint } from "../src/lint"

const DATA: Record<string, unknown> = {
  schematic: {},
  gallery: { items: [{ title: "Case A", body: "shared head" }, { title: "Case B", body: "per-channel" }] },
  chart: { series: [{ label: "VQ", value: 4.2 }, { label: "KIVI", value: 7.7 }] },
  table: { columns: ["method", "score"], rows: [{ method: "VQ", score: 4.2 }, { method: "KIVI", score: 7.7 }] },
}

for (const archetype of ["schematic", "gallery", "chart", "table"] as const) {
  test(
    `${archetype} template renders and lints clean out of the box`,
    async () => {
      const ws = mkdtempSync(join(tmpdir(), `figtpl-${archetype}-`))
      await scaffold(ws, { name: "fig-t", archetype, claim: "c", caption: "cap", width: "full" })
      writeFileSync(join(ws, "figures", "fig-t", "data.json"), JSON.stringify(DATA[archetype]))
      const result = await render(ws, "fig-t")
      if (!result.ok) throw new Error(`render failed: ${result.error}\n${result.consoleOutput.join("\n")}`)
      const dir = join(ws, "figures", "fig-t")
      const errors = lint({
        source: readFileSync(join(dir, "figure.html"), "utf8"),
        meta: parse(readFileSync(join(dir, "meta.yaml"), "utf8")),
        data: DATA[archetype],
        manifest: JSON.parse(readFileSync(result.bboxes, "utf8")),
      })
      expect(errors).toEqual([])
    },
    120_000,
  )
}
```

Run: `bun test test/templates.test.ts`
Expected: FAIL — current templates trip `font-allowlist` (Segoe UI) at minimum.

- [ ] **Step 2: Replace `src/templates/schematic/figure.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="../tokens.css" />
  <style>
    /* Layout only — colors/type/strokes come from tokens.css.
       Paper idiom: no headline inside the figure (the caption explains); panels are
       labeled (a), (b) with .panel-label; symbols go in .math spans. */
    #fig-root { display: flex; gap: 20px; padding: 12px; align-items: flex-start; }
    .col { display: flex; flex-direction: column; gap: 10px; }
  </style>
</head>
<body>
  <div id="fig-root">
    <div class="col">
      <span class="panel-label" id="panel-a">(a)</span>
      <div class="card" id="box-a">
        <h3>Stage A</h3>
        <p>Replace me — e.g. residual <span class="math">\Delta_{\mathrm{vec}}</span></p>
      </div>
      <div class="card" id="box-b">
        <h3>Stage B</h3>
        <p>Replace me</p>
      </div>
    </div>
  </div>
  <script type="module">
    import { renderMath } from "../lib/math.js"
    import { arrow, brace, highlight, figReady } from "../lib/annot.js"
    // Math first (glyph geometry must be final), then annotations, then figReady.
    await renderMath()
    arrow("#box-a", "#box-b", { bow: 0.25 })
    figReady()
  </script>
</body>
</html>
```

- [ ] **Step 3: Replace `src/templates/gallery/figure.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="../tokens.css" />
  <style>
    #fig-root { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; padding: 12px; }
  </style>
</head>
<body>
  <div id="fig-root"></div>
  <script type="module">
    import { renderMath } from "../lib/math.js"
    import { figReady } from "../lib/annot.js"
    // Records come from data.json (injected as window.__DATA__). Copying records
    // into HTML by hand is a lint failure.
    const root = document.querySelector("#fig-root")
    for (const [i, item] of (window.__DATA__.items ?? []).entries()) {
      const card = document.createElement("div")
      card.className = "card"
      card.id = `item-${i}`
      card.innerHTML = `<h3></h3><p></p>`
      card.querySelector("h3").textContent = item.title ?? ""
      card.querySelector("p").textContent = item.body ?? ""
      root.appendChild(card)
    }
    await renderMath()
    figReady()
  </script>
</body>
</html>
```

- [ ] **Step 4: Replace `src/templates/chart/figure.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="../tokens.css" />
  <style>
    #fig-root { padding: 12px 12px 28px; }
    .plot { position: relative; height: 160px; border-left: var(--stroke-thin) solid var(--border-strong); border-bottom: var(--stroke-thin) solid var(--border-strong); }
    .bar { position: absolute; bottom: 0; background: var(--accent); }
    .tick { position: absolute; font-size: var(--fs-small); color: var(--text-muted); }
  </style>
</head>
<body>
  <div id="fig-root"><div class="plot" id="plot"></div></div>
  <script type="module">
    import { renderMath } from "../lib/math.js"
    import { scaleLinear, scaleBand, derived } from "../lib/scale.js"
    import { figReady } from "../lib/annot.js"
    // Marks are positioned ONLY through scales. A hand-placed bar is a lint failure.
    const data = window.__DATA__.series ?? []
    const plot = document.querySelector("#plot")
    const W = plot.clientWidth || 480
    const H = 160
    const x = scaleBand(data.map((d) => d.label), [0, W])
    const y = scaleLinear([0, Math.max(...data.map((d) => d.value), 1)], [0, H])
    for (const [i, d] of data.entries()) {
      const bar = document.createElement("div")
      bar.className = "bar"
      bar.id = `bar-${i}`
      bar.style.left = `${x(d.label)}px`
      bar.style.width = `${x.bandwidth()}px`
      bar.style.height = `${y(d.value)}px`
      plot.appendChild(bar)
      const lab = derived(d.label)
      lab.className = "tick"
      lab.style.left = `${x(d.label)}px`
      lab.style.bottom = "-18px"
      plot.appendChild(lab)
    }
    await renderMath()
    figReady()
  </script>
</body>
</html>
```

- [ ] **Step 5: Replace `src/templates/table/figure.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="../tokens.css" />
  <style>
    /* Booktabs idiom: rules above/below the header and at the foot; no vertical rules. */
    #fig-root { padding: 12px; }
    .fig-table { border-collapse: collapse; width: 100%; font-size: var(--fs-label); }
    .fig-table th { text-align: left; border-top: var(--stroke) solid var(--border-strong); border-bottom: var(--stroke-thin) solid var(--border-strong); padding: 4px 8px; }
    .fig-table td { padding: 4px 8px; }
    .fig-table tr:last-child td { border-bottom: var(--stroke) solid var(--border-strong); }
  </style>
</head>
<body>
  <div id="fig-root"></div>
  <script type="module">
    import { renderMath } from "../lib/math.js"
    import { renderTable } from "../lib/table.js"
    import { figReady } from "../lib/annot.js"
    // Cells come from data.json via renderTable. Typing a number here is a lint failure.
    renderTable(document.querySelector("#fig-root"), window.__DATA__.rows ?? [], window.__DATA__.columns ?? [])
    await renderMath()
    figReady()
  </script>
</body>
</html>
```

- [ ] **Step 6: Run the smoke + full suite**

Run: `bun test test/templates.test.ts` → Expected: PASS (4 tests).
Run: `bun test` → Expected: all suites PASS. If any pre-existing test asserts old template markup (e.g. `.mono` in the gallery), update that assertion to the new markup.

- [ ] **Step 7: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/figures-mcp/src/templates Paperino/figures-mcp/test/templates.test.ts
git commit -m "feat(figures): archetype templates in paper idiom — lint-clean out of the box"
```

---

### Task 6: Scaffold version-aware asset refresh

**Files:**
- Modify: `src/scaffold.ts` (vendoring block)
- Test: `test/scaffold.test.ts` (extend)

**Interfaces:**
- Consumes: the `/* paperino-tokens v2 */` first-line marker (Task 2).
- Produces: scaffold guarantee used by Task 9 and every real workspace: after any `figure_scaffold`, `figures/tokens.css` and `figures/lib/` match the server's assets whenever the version marker differs (machine-owned, like `references.bib`).

- [ ] **Step 1: Write the failing test**

Append to `test/scaffold.test.ts` (match its existing tmp-workspace pattern; add `mkdirSync`, `readFileSync`, `writeFileSync`, `existsSync`, `mkdtempSync`, `tmpdir` to its imports if missing):

```ts
test("scaffold refreshes vendored tokens.css + lib when the version marker differs", async () => {
  const ws = mkdtempSync(join(tmpdir(), "figscaf-refresh-"))
  mkdirSync(join(ws, "figures", "lib"), { recursive: true })
  writeFileSync(join(ws, "figures", "tokens.css"), "/* paperino-tokens v1 */\n:root { --bg: #fff; }\n")
  writeFileSync(join(ws, "figures", "lib", "stale.js"), "// stale")
  await scaffold(ws, { name: "fig-r", archetype: "schematic", claim: "c", caption: "cap", width: "full" })
  const tokens = readFileSync(join(ws, "figures", "tokens.css"), "utf8")
  expect(tokens.split("\n")[0]).toBe("/* paperino-tokens v2 */")
  expect(existsSync(join(ws, "figures", "lib", "math.js"))).toBe(true)
  expect(existsSync(join(ws, "figures", "lib", "stale.js"))).toBe(false)
})
```

Run: `bun test test/scaffold.test.ts` → Expected: the new test FAILS (tokens stay v1, `stale.js` survives).

- [ ] **Step 2: Implement in `src/scaffold.ts`**

Add `rmSync` to the `node:fs` import list, then replace the two vendoring lines:

```ts
  if (!existsSync(join(figuresDir, "tokens.css"))) cpSync(join(ASSETS, "tokens.css"), join(figuresDir, "tokens.css"))
  if (!existsSync(join(figuresDir, "lib"))) cpSync(join(ASSETS, "lib"), join(figuresDir, "lib"), { recursive: true })
```

with:

```ts
  // tokens.css + lib/ are machine-owned (like references.bib): vendored on first
  // scaffold, refreshed whenever the version marker differs so old workspaces are
  // upgraded deliberately instead of drifting on a stale design system.
  const versionOf = (css: string) => css.split("\n", 1)[0].trim()
  const shipped = versionOf(readFileSync(join(ASSETS, "tokens.css"), "utf8"))
  const vendoredTokens = join(figuresDir, "tokens.css")
  const current = existsSync(vendoredTokens) ? versionOf(readFileSync(vendoredTokens, "utf8")) : null
  if (current !== shipped) {
    cpSync(join(ASSETS, "tokens.css"), vendoredTokens)
    rmSync(join(figuresDir, "lib"), { recursive: true, force: true })
    cpSync(join(ASSETS, "lib"), join(figuresDir, "lib"), { recursive: true })
  } else if (!existsSync(join(figuresDir, "lib"))) {
    cpSync(join(ASSETS, "lib"), join(figuresDir, "lib"), { recursive: true })
  }
```

- [ ] **Step 3: Run tests**

Run: `bun test test/scaffold.test.ts` → Expected: PASS (existing + new).

- [ ] **Step 4: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/figures-mcp/src/scaffold.ts Paperino/figures-mcp/test/scaffold.test.ts
git commit -m "feat(figures): version-aware refresh of vendored tokens.css + lib"
```

---

### Task 7: Rubric rewrite + self-authored exemplars

**Files:**
- Modify: `src/server.ts` (rubric array ~line 98; exemplar image calls ~line 111)
- Create: `test/author-exemplars.ts`; Delete: `test/author-demo.ts` (it only authored the old blog-style exemplars; verify nothing imports it: `grep -rl "author-demo" test/ src/` → expect no hits)
- Replace: `src/assets/exemplars/exemplar-schematic.png`; Create: `src/assets/exemplars/exemplar-chart.png`; Delete: `src/assets/exemplars/exemplar-gallery.png`

**Interfaces:**
- Consumes: Tasks 1–6 (the whole new pipeline).
- Produces: the two exemplar PNGs `figure_review` sends, with filenames `exemplar-schematic.png` and `exemplar-chart.png` referenced from `src/server.ts`, and the venue-grade rubric text.

- [ ] **Step 1: Replace the rubric in `src/server.ts`**

Replace the `const rubric = [...]` array contents with:

```ts
    const rubric = [
      `CLAIM this figure must demonstrate: "${meta.claim}"`,
      `Caption: "${meta.caption}"`,
      "",
      "Review the FIRST image (the render). The other two images are exemplars of the bar:",
      "publication figures that sit natively inside a LaTeX paper.",
      'Answer as JSON: {"demonstrates_claim": bool, "issues": [{"severity", "selector", "problem", "fix"}], "readable_at_50pct": bool}',
      "- Would a reviewer notice this was NOT made with TikZ/pgfplots? Web-app look (rounded cards, pill badges, UI fonts) = reject.",
      "- Any pseudo-math (sigma_ch, x^2 as plain text)? Every symbol must be typeset via a .math span.",
      "- Minimal in-figure prose: the caption explains, the figure shows. No headline inside the figure; panels are (a), (b).",
      "- Is the element the caption is about the most salient thing?",
      "- Is anything encoded twice (color + position for the same variable)?",
      "- Would it survive at 50% scale? In grayscale?",
      "If issues remain, patch figure.html by selector and rerun figure_render + figure_lint. Max 4 iterations, then stop and surface to the user.",
    ].join("\n")
```

and update the exemplar image lines to:

```ts
        image(join(EXEMPLARS, "exemplar-schematic.png")),
        image(join(EXEMPLARS, "exemplar-chart.png")),
```

- [ ] **Step 2: Write the exemplar author script**

Create `test/author-exemplars.ts` (run manually — it regenerates committed assets):

```ts
// Authors the two exemplar figures WITH the new system itself and copies their PNGs
// into src/assets/exemplars/. Re-run after changing tokens or templates:
//   bun test/author-exemplars.ts
import { cpSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scaffold } from "../src/scaffold"
import { render } from "../src/render"

const ws = mkdtempSync(join(tmpdir(), "fig-exemplars-"))
const EXEMPLARS = join(import.meta.dir, "..", "src", "assets", "exemplars")

// ---- exemplar 1: schematic (two-panel mechanism sketch with real math) ----
await scaffold(ws, {
  name: "ex-schematic",
  archetype: "schematic",
  claim: "Shared residuals add coherently; independent residuals add stochastically.",
  caption: "Aggregation of quantization residuals across a query group.",
  width: "full",
})
writeFileSync(
  join(ws, "figures", "ex-schematic", "figure.html"),
  `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="../tokens.css" />
  <style>
    #fig-root { display: flex; gap: 24px; padding: 12px; align-items: flex-start; }
    .col { display: flex; flex-direction: column; gap: 10px; flex: 1; }
  </style>
</head>
<body>
  <div id="fig-root">
    <div class="col">
      <span class="panel-label" id="panel-a">(a)</span>
      <div class="card" id="kv-shared"><h3>compressed KV head</h3><p>one residual <span class="math">\\Delta_{\\mathrm{vec}}</span>, read by all <span class="math">g</span> heads</p></div>
      <div class="card" id="sum-coherent"><h3>coherent sum</h3><p><span class="math">O(g\\,\\sigma_{\\mathrm{vec}})</span></p></div>
    </div>
    <div class="col">
      <span class="panel-label" id="panel-b">(b)</span>
      <div class="card" id="kv-indep"><h3>per-channel residuals</h3><p>independent <span class="math">\\Delta_{\\mathrm{ch},h}</span> per head</p></div>
      <div class="card" id="sum-stochastic"><h3>stochastic sum</h3><p><span class="math">O(\\sqrt{g\\,d}\\,\\sigma_{\\mathrm{ch}})</span></p></div>
    </div>
  </div>
  <script type="module">
    import { renderMath } from "../lib/math.js"
    import { arrow, figReady } from "../lib/annot.js"
    await renderMath()
    arrow("#kv-shared", "#sum-coherent", { bow: 0.2 })
    arrow("#kv-indep", "#sum-stochastic", { bow: 0.2 })
    figReady()
  </script>
</body>
</html>
`,
)

// ---- exemplar 2: chart (data-bound bars, axis idiom) ----
await scaffold(ws, {
  name: "ex-chart",
  archetype: "chart",
  claim: "Perplexity grows with the GQA ratio.",
  caption: "4-bit perplexity by GQA ratio.",
  width: "narrow",
})
writeFileSync(
  join(ws, "figures", "ex-chart", "data.json"),
  JSON.stringify({ series: [
    { label: "2:1", value: 5.1 },
    { label: "4:1", value: 6.0 },
    { label: "5:1", value: 6.4 },
    { label: "8:1", value: 7.6 },
  ] }),
)

for (const [name, out] of [
  ["ex-schematic", "exemplar-schematic.png"],
  ["ex-chart", "exemplar-chart.png"],
] as const) {
  const result = await render(ws, name)
  if (!result.ok) throw new Error(`${name} render failed: ${result.error}\n${result.consoleOutput.join("\n")}`)
  cpSync(result.png, join(EXEMPLARS, out))
  console.log(`wrote ${out}`)
}
console.log("done — review both PNGs visually before committing")
```

- [ ] **Step 3: Run it, delete the old assets, LOOK at the output**

```bash
cd C:/Users/azamk/Documents/Paperino/figures-mcp
bun test/author-exemplars.ts
rm src/assets/exemplars/exemplar-gallery.png
rm test/author-demo.ts
```

Expected: `wrote exemplar-schematic.png` / `wrote exemplar-chart.png`. Then **Read both PNGs** and verify: CM serif text, real σ/Δ glyphs (no `sigma_`), square hairline boxes, no fills/pills/shadows. These two images ARE the quality bar the review loop steers toward — if anything looks off, fix the HTML in the script and re-run.

- [ ] **Step 4: Run the server suite**

Run: `bun test test/server.test.ts` → Expected: PASS. If a test asserts the old exemplar filename or the "10 rules" description, update that assertion to the new strings.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/figures-mcp/src/server.ts Paperino/figures-mcp/src/assets/exemplars \
  Paperino/figures-mcp/test/author-exemplars.ts
git rm -q Paperino/figures-mcp/test/author-demo.ts
git commit -m "feat(figures): venue-grade rubric + self-authored exemplars (schematic, chart)"
```

---

### Task 8: Teach the shipped agent + record the gotchas

**Files:**
- Modify: `Paperino/opencode-dev/paperino-config/AGENTS.md` (Figure Studio workflow, step 4)
- Modify: `Paperino/CLAUDE.md` (figures-mcp section)

**Interfaces:**
- Consumes: everything above.
- Produces: prompt-level guidance (the structural rules already enforce; this makes the agent aim right the first time).

- [ ] **Step 1: AGENTS.md — extend workflow step 4**

In `Paperino/opencode-dev/paperino-config/AGENTS.md`, find step 4 of the Figure Studio workflow (begins `4. Edit \`figure.html\`.`) and replace that single list item with:

```markdown
4. Edit `figure.html`. Layout is HTML with flex/grid. Annotations are `arrow()`,
   `brace()` and `highlight()` from `../lib/annot.js`, anchored to element IDs, with one
   scalar `bow` for the swoop. Colours are `var(--…)` from `../tokens.css` only.
   **Every symbol or formula goes in a `.math` span** (KaTeX; call `await renderMath()`
   from `../lib/math.js` before annotations — templates already do). Writing `sigma_ch`
   or `x^2` as plain text is a hard lint failure. Paper idiom is enforced: no headline
   inside the figure (the caption explains, the figure shows), panels are labeled with
   `.panel-label` as (a), (b), and rounded corners / shadows / UI fonts are lint
   failures.
```

- [ ] **Step 2: CLAUDE.md — append to the figures-mcp section**

In `Paperino/CLAUDE.md`, at the end of the `## figures-mcp` bullet list, add:

```markdown
- **v2 (2026-07-13) is publication-grade**: tokens are the KaTeX dist's CM-derived
  faces, math is real KaTeX in `.math` spans, and figures are authored print-true
  (528px = 5.5in text width, 312px = 3.25in column; 12px = 9pt). Lint has 13 rules —
  pseudo-math, web-chrome (radius/shadow), and a `KaTeX_*` font allowlist are hard
  failures. **KaTeX internals are exempt** from the 7pt floor and intra-formula
  overlap (LaTeX scripts are 7/5pt; KaTeX absolutely positions glyph boxes).
  `figure_scaffold` auto-refreshes vendored `tokens.css` + `lib/` on version drift.
  Exemplars are self-authored via `bun test/author-exemplars.ts` — regenerate after
  touching tokens or templates.
```

- [ ] **Step 3: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/opencode-dev/paperino-config/AGENTS.md Paperino/CLAUDE.md
git commit -m "docs(figures): teach the agent the publication idiom; record v2 gotchas"
```

---

### Task 9: Acceptance — the GQA figure, rebuilt and embedded

**Files:**
- Create: `test/author-acceptance.ts` (kept, so acceptance is re-runnable)
- Create (generated): `Paperino/fixtures/demo-paper/figures/fig-gqa-amplification/{figure.html,data.json,meta.yaml}`
- Modify: `Paperino/fixtures/demo-paper/main.tex` (figure block before `\end{document}`)

**Interfaces:**
- Consumes: the entire v2 pipeline (this run also exercises Task 6's refresh against demo-paper's old v1 vendored assets).
- Produces: the acceptance artifact — the figure from the user's screenshot, in publication clothes, inside the compiled demo paper.

- [ ] **Step 1: Write and run the acceptance author script**

Create `test/author-acceptance.ts`:

```ts
// Rebuilds the GQA-amplification figure (the figure that triggered spec 2026-07-13)
// in the publication idiom, inside fixtures/demo-paper. Run: bun test/author-acceptance.ts
import { writeFileSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { scaffold } from "../src/scaffold"
import { render } from "../src/render"

const ws = join(import.meta.dir, "..", "..", "fixtures", "demo-paper")
const dir = join(ws, "figures", "fig-gqa-amplification")
if (existsSync(dir)) rmSync(dir, { recursive: true })

await scaffold(ws, {
  name: "fig-gqa-amplification",
  archetype: "schematic",
  claim: "Shared vector residuals aggregate coherently across a query group, while per-channel scalar residuals aggregate stochastically, so VQ error grows linearly in g and scalar error only as sqrt(g).",
  caption: "Mechanism of GQA amplification. (a) One compressed KV head is read by every query head in its group: the shared vector residual adds coherently; independent per-channel residuals add stochastically. (b) The resulting error scales and the crossover condition.",
  width: "full",
})

writeFileSync(join(dir, "data.json"), "{}\n")
writeFileSync(
  join(dir, "figure.html"),
  `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="../tokens.css" />
  <style>
    #fig-root { display: flex; gap: 22px; padding: 12px; align-items: flex-start; }
    #mechanism { flex: 3; display: flex; flex-direction: column; gap: 16px; }
    #consequence { flex: 2; display: flex; flex-direction: column; gap: 10px; }
    .lane { display: flex; gap: 12px; align-items: center; }
    .lane .card { flex: 1; }
    .heads { display: flex; gap: 6px; flex: 1.4; }
    .heads .card { flex: 1; text-align: center; }
    .tag { font-size: var(--fs-label); font-weight: 700; }
    .vq { color: var(--accent-warm); }
    .kivi { color: var(--accent); }
    .stmt b { display: block; margin-bottom: 2px; }
  </style>
</head>
<body>
  <div id="fig-root">
    <div id="mechanism">
      <span class="panel-label" id="panel-a">(a)</span>
      <div class="lane" id="lane-vq">
        <span class="tag vq" id="tag-vq">VQ</span>
        <div class="card" id="vq-kv"><h3>KV head <span class="math">j</span></h3><p>shared <span class="math">\\Delta_{\\mathrm{vec}}</span></p></div>
        <div class="heads" id="vq-heads">
          <div class="card" id="vq-h1"><p>head <span class="math">h</span></p></div>
          <div class="card" id="vq-h2"><p><span class="math">\\cdots</span></p></div>
          <div class="card" id="vq-h3"><p>head <span class="math">h{+}g{-}1</span></p></div>
        </div>
        <div class="card" id="vq-sum"><h3>coherent</h3><p><span class="math">O(g\\,\\sigma_{\\mathrm{vec}})</span></p></div>
      </div>
      <div class="lane" id="lane-kivi">
        <span class="tag kivi" id="tag-kivi">scalar</span>
        <div class="card" id="kivi-kv"><h3>KV head <span class="math">j</span></h3><p>independent <span class="math">\\Delta_{\\mathrm{ch},h}</span></p></div>
        <div class="heads" id="kivi-heads">
          <div class="card" id="kivi-h1"><p>head <span class="math">h</span></p></div>
          <div class="card" id="kivi-h2"><p><span class="math">\\cdots</span></p></div>
          <div class="card" id="kivi-h3"><p>head <span class="math">h{+}g{-}1</span></p></div>
        </div>
        <div class="card" id="kivi-sum"><h3>stochastic</h3><p><span class="math">O(\\sqrt{g\\,d}\\,\\sigma_{\\mathrm{ch}})</span></p></div>
      </div>
    </div>
    <div id="consequence">
      <span class="panel-label" id="panel-b">(b)</span>
      <div class="card stmt" id="stmt-vq"><b class="vq">shared residual</b><span class="math">\\mathcal{E}\\propto g\\,\\sigma_{\\mathrm{vec}}</span></div>
      <div class="card stmt" id="stmt-kivi"><b class="kivi">independent residuals</b><span class="math">\\mathcal{E}\\propto\\sqrt{g\\,d}\\,\\sigma_{\\mathrm{ch}}</span></div>
      <div class="card stmt" id="stmt-crossover"><b>VQ wins when</b><span class="math">\\sigma_{\\mathrm{vec}}^{2}\\lesssim (d/g)\\,\\sigma_{\\mathrm{ch}}^{2}</span></div>
    </div>
  </div>
  <script type="module">
    import { renderMath } from "../lib/math.js"
    import { arrow, figReady } from "../lib/annot.js"
    await renderMath()
    arrow("#vq-kv", "#vq-heads", { bow: 0.15 })
    arrow("#vq-heads", "#vq-sum", { bow: 0.15 })
    arrow("#kivi-kv", "#kivi-heads", { bow: 0.15 })
    arrow("#kivi-heads", "#kivi-sum", { bow: 0.15 })
    figReady()
  </script>
</body>
</html>
`,
)

const result = await render(ws, "fig-gqa-amplification")
if (!result.ok) throw new Error(`render failed: ${result.error}\n${result.consoleOutput.join("\n")}`)
console.log("rendered:", result.png)
console.log("pdf:", result.pdf)
```

Run: `cd C:/Users/azamk/Documents/Paperino/figures-mcp && bun test/author-acceptance.ts`
Expected: `rendered: …fig-gqa-amplification.png`.

- [ ] **Step 2: Lint it via the real rule set**

```bash
cd C:/Users/azamk/Documents/Paperino/figures-mcp
bun -e "
import { lint } from './src/lint'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
const d = '../fixtures/demo-paper/figures/fig-gqa-amplification'
const errors = lint({
  source: readFileSync(d + '/figure.html', 'utf8'),
  meta: parse(readFileSync(d + '/meta.yaml', 'utf8')),
  data: JSON.parse(readFileSync(d + '/data.json', 'utf8')),
  manifest: JSON.parse(readFileSync(d + '/build/bboxes.json', 'utf8')),
})
console.log(errors.length === 0 ? 'LINT CLEAN' : JSON.stringify(errors, null, 2))
"
```

Expected: `LINT CLEAN`. If not, patch the HTML inside `test/author-acceptance.ts` by the reported selectors and re-run Step 1.

- [ ] **Step 3: Embed in the demo paper and compile**

In `Paperino/fixtures/demo-paper/main.tex`, insert immediately before `\end{document}`:

```latex
\begin{figure}[t]
  \centering
  \includegraphics[width=\linewidth]{figures/fig-gqa-amplification/build/fig-gqa-amplification.pdf}
  \caption{\textbf{Mechanism of GQA amplification.} (a) One compressed KV head is read
  by every query head in its group: the shared vector residual adds coherently, while
  independent per-channel residuals add stochastically. (b) Resulting error scales and
  the crossover condition.}
  \label{fig:gqa-amplification}
\end{figure}
```

Then compile:

```bash
cd C:/Users/azamk/Documents/Paperino/fixtures/demo-paper
"C:/Users/azamk/Documents/Paperino/tools/tectonic/tectonic.exe" --keep-logs --outdir .paperino main.tex
```

Expected: exit 0, `.paperino/main.pdf` regenerated.

- [ ] **Step 4: LOOK at it (the repo rule: verify against reality, not tests)**

Read `Paperino/fixtures/demo-paper/figures/fig-gqa-amplification/build/fig-gqa-amplification.png`, then rasterize the figure's page of `.paperino/main.pdf` with the office-skill renderer and Read it:

```bash
C:/Users/azamk/Documents/Paperino/tools/pyoffice/.venv/Scripts/python.exe \
  C:/Users/azamk/Documents/Paperino/opencode-dev/paperino-config/skill/pdf/scripts/render.py \
  .paperino/main.pdf --out .paperino/pages --dpi 120
```

(Find the figure's page by checking the last pages first — the figure block sits at the document's end.) Verify: real σ/Δ/≲ glyphs, CM serif indistinguishable from the surrounding body text, square hairline boxes, no fills/pills/shadows, (a)/(b) panels, no in-figure headline.

- [ ] **Step 5: Full suite + commit**

Run: `cd C:/Users/azamk/Documents/Paperino/figures-mcp && bun test` → Expected: all PASS.

```bash
cd C:/Users/azamk/Documents
git add Paperino/figures-mcp/test/author-acceptance.ts \
  Paperino/fixtures/demo-paper/figures/fig-gqa-amplification/figure.html \
  Paperino/fixtures/demo-paper/figures/fig-gqa-amplification/data.json \
  Paperino/fixtures/demo-paper/figures/fig-gqa-amplification/meta.yaml \
  Paperino/fixtures/demo-paper/figures/tokens.css Paperino/fixtures/demo-paper/figures/lib \
  Paperino/fixtures/demo-paper/main.tex
git commit -m "feat(figures): acceptance — GQA amplification figure in publication idiom, embedded in demo-paper"
```

(`build/` stays untracked via the workspace `.gitignore` scaffold maintains. The demo-paper `figures/lib` now includes `katex/` — ~1MB of woff2, committed once, per the pinned-assets constraint.)
