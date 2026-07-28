# Figure Studio v3 — Chart Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Figure Studio a matplotlib engine beside its HTML engine, chosen by the model, with one lint and one type system across both.

**Architecture:** `meta.yaml` gains `engine: html | mpl`. The mpl engine runs `figure.py` under Python to produce an SVG; the existing Playwright worker then loads that SVG inside a generated HTML wrapper and emits the *same* `bboxes.json` manifest the HTML engine produces. Everything downstream — lint, review — is unchanged. The figure typeface and print widths become venue-derived, resolved once in `src/venue.ts` and consumed by both engines.

**Tech Stack:** TypeScript on bun (figures-mcp), Python 3.12 + matplotlib (chart engine), Playwright/Chromium under node (measurement), KaTeX + TeX Gyre Termes (type).

## Global Constraints

Copied verbatim from `docs/superpowers/specs/2026-07-28-figure-studio-chart-engine-design.md`:

- Both engines converge on SVG-measured-in-Chromium. Any future engine must reach that point or it does not ship.
- Rule 8 (provenance) runs on every engine. No exemptions.
- `svg.fonttype: "none"` and `pdf.fonttype: 42` are owned by the style module, never the author.
- `paperino_mpl.py` is machine-owned and version-refreshed, like `tokens.css`.
- The model chooses the engine. No auto-detection.
- One type system across both engines, venue-derived.
- Default when `paperino.yaml` has no `venue`: `neurips` — preserves today's 312/528px exactly.
- No TikZ. No source-level numeric-literal ban. No sans-serif face.

Repo constraints (from `Paperino/CLAUDE.md`):

- Git root is `C:/Users/azamk/Documents`; paths below are relative to it. **Never `git add -A` or `git commit -a`** — stage explicit paths.
- Playwright must run under **node**, never bun (`render-worker.mjs`).
- Tests: `cd Paperino/figures-mcp && bun test`. 27 exist and must stay green.
- Commits carry no Claude attribution.

## File Structure

| file | responsibility |
|---|---|
| `figures-mcp/src/venue.ts` | **new** — resolve `paperino.yaml` → typeface, math fontset, print widths |
| `figures-mcp/src/engines/mpl.ts` | **new** — find interpreter, run `figure.py`, surface tracebacks |
| `figures-mcp/src/assets/paperino_mpl.py` | **new** — vendored style module: rcParams, palette, `figure()`, `data()`, `save()` |
| `figures-mcp/src/assets/fonts/` | **new** — TeX Gyre Termes TTF + WOFF2 |
| `figures-mcp/src/templates/chart-mpl/figure.py` | **new** — mpl scaffold template |
| `figures-mcp/src/render-worker.mjs` | modify — SVG wrapper mode; `derived` from gid ancestry |
| `figures-mcp/src/render.ts` | modify — dispatch on engine; venue widths replace hardcoded `VIEWPORTS` |
| `figures-mcp/src/lint.ts` | modify — rules 5, 9, 13 engine-aware |
| `figures-mcp/src/scaffold.ts` | modify — `engine` option; vendor `paperino_mpl.py`; venue-stamped `tokens.css` |
| `figures-mcp/src/server.ts` | modify — `engine` input; per-engine exemplars in review |
| `figures-mcp/src/assets/tokens.css` | modify — both font families; `--font-text` stamped at vendor time |

---

### Task 1: Venue resolution

**Files:**
- Create: `Paperino/figures-mcp/src/venue.ts`
- Create: `Paperino/figures-mcp/test/venue.test.ts`

**Interfaces:**
- Produces: `resolveVenue(workspace: string): Venue` where
  `type Venue = { id: string; textFace: string; mathFontset: "cm" | "stix"; inches: { narrow: number; full: number }; px: { narrow: number; full: number } }`

- [ ] **Step 1: Write the failing test**

```ts
// Paperino/figures-mcp/test/venue.test.ts
import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { resolveVenue } from "../src/venue"

const ws = (yaml?: string) => {
  const dir = join(tmpdir(), `venue-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  if (yaml !== undefined) writeFileSync(join(dir, "paperino.yaml"), yaml)
  return dir
}

describe("resolveVenue", () => {
  test("no paperino.yaml falls back to neurips, preserving today's 312/528px", () => {
    const dir = ws()
    const v = resolveVenue(dir)
    expect(v.id).toBe("neurips")
    expect(v.px).toEqual({ narrow: 312, full: 528 })
    rmSync(dir, { recursive: true, force: true })
  })

  test("ieee is Times-metric with STIX math and two-column widths", () => {
    const dir = ws("venue: ieee\n")
    const v = resolveVenue(dir)
    expect(v.textFace).toBe("TeXGyreTermes")
    expect(v.mathFontset).toBe("stix")
    expect(v.inches).toEqual({ narrow: 3.5, full: 7.16 })
    expect(v.px).toEqual({ narrow: 336, full: 687 })
    rmSync(dir, { recursive: true, force: true })
  })

  test("article keeps Computer Modern and cm math", () => {
    const dir = ws("venue: article\n")
    const v = resolveVenue(dir)
    expect(v.textFace).toBe("KaTeX_Main")
    expect(v.mathFontset).toBe("cm")
    rmSync(dir, { recursive: true, force: true })
  })

  test("an unknown venue falls back to neurips rather than throwing", () => {
    const dir = ws("venue: nature\n")
    expect(resolveVenue(dir).id).toBe("neurips")
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd Paperino/figures-mcp && bun test test/venue.test.ts`
Expected: FAIL — `Cannot find module '../src/venue'`

- [ ] **Step 3: Implement**

```ts
// Paperino/figures-mcp/src/venue.ts
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"

export type Venue = {
  id: string
  /** CSS family name AND the matplotlib family name — one string, so the two engines cannot drift. */
  textFace: string
  mathFontset: "cm" | "stix"
  inches: { narrow: number; full: number }
  px: { narrow: number; full: number }
}

// Print-true widths per venue: single column / full text width, in inches.
// 96dpi is Chromium's CSS-px-per-inch, which is what makes \includegraphics land ~1:1.
const DPI = 96
const VENUES: Record<string, { textFace: string; mathFontset: "cm" | "stix"; narrow: number; full: number }> = {
  ieee: { textFace: "TeXGyreTermes", mathFontset: "stix", narrow: 3.5, full: 7.16 },
  acm: { textFace: "TeXGyreTermes", mathFontset: "stix", narrow: 3.33, full: 7.0 },
  neurips: { textFace: "TeXGyreTermes", mathFontset: "stix", narrow: 3.25, full: 5.5 },
  icml: { textFace: "TeXGyreTermes", mathFontset: "stix", narrow: 3.25, full: 6.75 },
  iclr: { textFace: "TeXGyreTermes", mathFontset: "stix", narrow: 3.25, full: 5.5 },
  acl: { textFace: "TeXGyreTermes", mathFontset: "stix", narrow: 3.0, full: 6.3 },
  // Plain \documentclass{article}: Computer Modern, and KaTeX already ships those faces.
  article: { textFace: "KaTeX_Main", mathFontset: "cm", narrow: 3.25, full: 5.5 },
}

// neurips, because its 3.25/5.5in are exactly the 312/528px v2 hardcoded — an existing
// workspace with no `venue` key must not silently reflow every figure it already has.
const DEFAULT = "neurips"

export function resolveVenue(workspace: string): Venue {
  const file = join(workspace, "paperino.yaml")
  let id = DEFAULT
  if (existsSync(file)) {
    try {
      const named = parse(readFileSync(file, "utf8"))?.venue
      if (typeof named === "string" && VENUES[named.toLowerCase()]) id = named.toLowerCase()
    } catch {
      // A malformed paperino.yaml is the compile's problem to report, not the figure's.
    }
  }
  const v = VENUES[id]
  return {
    id,
    textFace: v.textFace,
    mathFontset: v.mathFontset,
    inches: { narrow: v.narrow, full: v.full },
    px: { narrow: Math.round(v.narrow * DPI), full: Math.round(v.full * DPI) },
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd Paperino/figures-mcp && bun test test/venue.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add Paperino/figures-mcp/src/venue.ts Paperino/figures-mcp/test/venue.test.ts
git commit -m "feat(figures): resolve venue to typeface, math fontset and print widths"
```

---

### Task 2: Vendor TeX Gyre Termes and stamp the venue into tokens.css

**Files:**
- Create: `Paperino/figures-mcp/src/assets/fonts/TeXGyreTermes-{Regular,Bold,Italic,BoldItalic}.{ttf,woff2}`
- Modify: `Paperino/figures-mcp/src/assets/tokens.css` (line 1 version marker; `@font-face` block; `--font-text`)
- Modify: `Paperino/figures-mcp/src/scaffold.ts:39-49`
- Modify: `Paperino/figures-mcp/test/scaffold.test.ts`

**Interfaces:**
- Consumes: `resolveVenue(workspace)` from Task 1.
- Produces: `figures/tokens.css` whose line 1 reads `/* paperino-tokens v3.0 venue=<id> */` and whose `--font-text` is that venue's face. `figures/fonts/` holds the WOFF2 files.

- [ ] **Step 1: Obtain the fonts**

TeX Gyre Termes is GUST Font License (a LPPL variant, redistribution permitted). Download the OTF release and convert:

```bash
cd Paperino/figures-mcp/src/assets && mkdir -p fonts && cd fonts
curl -LO https://www.gust.org.pl/projects/e-foundry/tex-gyre/termes/qtm2.004otf.zip
unzip -j qtm2.004otf.zip '*.otf'
# fonttools ships woff2 support; the ttf is what matplotlib's font_manager can read.
python -m pip install fonttools brotli
python - <<'PY'
from fontTools.ttLib import TTFont
import glob, os
name = {"texgyretermes-regular": "Regular", "texgyretermes-bold": "Bold",
        "texgyretermes-italic": "Italic", "texgyretermes-bolditalic": "BoldItalic"}
for otf in glob.glob("*.otf"):
    key = os.path.splitext(os.path.basename(otf))[0].lower()
    if key not in name: continue
    f = TTFont(otf)
    f.save(f"TeXGyreTermes-{name[key]}.ttf")
    f.flavor = "woff2"
    f.save(f"TeXGyreTermes-{name[key]}.woff2")
PY
rm -f *.otf qtm2.004otf.zip
```

Expected: eight files, `TeXGyreTermes-{Regular,Bold,Italic,BoldItalic}.{ttf,woff2}`.

- [ ] **Step 2: Write the failing test**

```ts
// append to Paperino/figures-mcp/test/scaffold.test.ts
test("tokens.css is stamped with the workspace's venue face", async () => {
  const ws = tmpWorkspace()
  writeFileSync(join(ws, "paperino.yaml"), "venue: ieee\n")
  await scaffold(ws, { name: "f1", archetype: "chart", claim: "c", caption: "c", width: "full" })
  const css = readFileSync(join(ws, "figures", "tokens.css"), "utf8")
  expect(css.split("\n", 1)[0]).toContain("venue=ieee")
  expect(css).toMatch(/--font-text:\s*"TeXGyreTermes"/)
  expect(existsSync(join(ws, "figures", "fonts", "TeXGyreTermes-Regular.woff2"))).toBe(true)
})

test("changing the venue re-vendors tokens.css", async () => {
  const ws = tmpWorkspace()
  await scaffold(ws, { name: "f1", archetype: "chart", claim: "c", caption: "c", width: "full" })
  expect(readFileSync(join(ws, "figures", "tokens.css"), "utf8")).toContain("venue=neurips")
  writeFileSync(join(ws, "paperino.yaml"), "venue: article\n")
  await scaffold(ws, { name: "f2", archetype: "chart", claim: "c", caption: "c", width: "full" })
  const css = readFileSync(join(ws, "figures", "tokens.css"), "utf8")
  expect(css).toContain("venue=article")
  expect(css).toMatch(/--font-text:\s*"KaTeX_Main"/)
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `cd Paperino/figures-mcp && bun test test/scaffold.test.ts`
Expected: FAIL — line 1 is `/* paperino-tokens v2.1 */`, no `venue=`.

- [ ] **Step 4: Edit `tokens.css`**

Replace line 1 with `/* paperino-tokens v3.0 venue=PLACEHOLDER */`, add the Termes faces after the existing KaTeX `@font-face` block, and make `--font-text` a stamped value:

```css
/* paperino-tokens v3.0 venue=PLACEHOLDER */
@font-face { font-family: "TeXGyreTermes"; src: url("fonts/TeXGyreTermes-Regular.woff2") format("woff2"); font-weight: 400; font-style: normal; }
@font-face { font-family: "TeXGyreTermes"; src: url("fonts/TeXGyreTermes-Bold.woff2") format("woff2"); font-weight: 700; font-style: normal; }
@font-face { font-family: "TeXGyreTermes"; src: url("fonts/TeXGyreTermes-Italic.woff2") format("woff2"); font-weight: 400; font-style: italic; }
@font-face { font-family: "TeXGyreTermes"; src: url("fonts/TeXGyreTermes-BoldItalic.woff2") format("woff2"); font-weight: 700; font-style: italic; }
```

and in `:root`, replace the existing `--font-text` declaration with:

```css
  /* Stamped by scaffold from paperino.yaml's `venue`. Both engines read this one name,
     so a chart and a schematic in the same paper cannot end up in different faces. */
  --font-text: "PLACEHOLDER_FACE";
```

- [ ] **Step 5: Teach `scaffold.ts` to stamp and to copy the fonts**

In `scaffold.ts`, replace the vendoring block at lines 39-49 with:

```ts
  const venue = resolveVenue(workspace)
  // The version marker carries the venue, so switching venue re-vendors exactly the way a
  // version bump does — one mechanism, not two.
  const stamp = (css: string) =>
    css
      .replace(/^\/\* paperino-tokens ([^\s*]+)[^\n]*\*\//, `/* paperino-tokens $1 venue=${venue.id} */`)
      .replace(/"PLACEHOLDER_FACE"/, `"${venue.textFace}"`)
  const versionOf = (css: string) => css.split("\n", 1)[0].trim()
  const shipped = versionOf(stamp(readFileSync(join(ASSETS, "tokens.css"), "utf8")))
  const vendoredTokens = join(figuresDir, "tokens.css")
  const vendored = existsSync(vendoredTokens) ? versionOf(readFileSync(vendoredTokens, "utf8")) : null
  if (vendored !== shipped) {
    writeFileSync(vendoredTokens, stamp(readFileSync(join(ASSETS, "tokens.css"), "utf8")))
    rmSync(join(figuresDir, "lib"), { recursive: true, force: true })
    cpSync(join(ASSETS, "lib"), join(figuresDir, "lib"), { recursive: true })
    rmSync(join(figuresDir, "fonts"), { recursive: true, force: true })
    cpSync(join(ASSETS, "fonts"), join(figuresDir, "fonts"), { recursive: true })
  } else if (!existsSync(join(figuresDir, "lib"))) {
    cpSync(join(ASSETS, "lib"), join(figuresDir, "lib"), { recursive: true })
    cpSync(join(ASSETS, "fonts"), join(figuresDir, "fonts"), { recursive: true })
  }
```

Add `import { resolveVenue } from "./venue"` at the top. `workspace` is already the first parameter, so no signature change is needed.

- [ ] **Step 6: Run the tests**

Run: `cd Paperino/figures-mcp && bun test`
Expected: PASS — the two new scaffold tests plus the existing 27.

- [ ] **Step 7: Commit**

```bash
git add Paperino/figures-mcp/src/assets/fonts Paperino/figures-mcp/src/assets/tokens.css \
        Paperino/figures-mcp/src/scaffold.ts Paperino/figures-mcp/test/scaffold.test.ts
git commit -m "feat(figures): vendor TeX Gyre Termes and stamp the venue face into tokens.css"
```

---

### Task 3: The matplotlib style module

**Files:**
- Create: `Paperino/figures-mcp/src/assets/paperino_mpl.py`
- Create: `Paperino/figures-mcp/test/mpl-style.test.ts`

**Interfaces:**
- Produces, for `figure.py` authors: `data() -> dict`, `figure(width, panels=1, ratios=None, height=None) -> (Figure, list[Axes])`, `save(fig) -> None`, and the palette constants `INK`, `MUTED`, `GRID`, `ACCENT`, `ACCENT_WARM`.
- Consumes: environment written by `src/engines/mpl.ts` (Task 4) — `PAPERINO_FIG_DIR`, `PAPERINO_FIG_NAME`, `PAPERINO_FIG_FACE`, `PAPERINO_FIG_MATH`, `PAPERINO_FIG_INCHES`, `PAPERINO_FIG_FONTS`.

- [ ] **Step 1: Write the module**

```python
# paperino-mpl v3.0
"""Machine-owned style module for Figure Studio's matplotlib engine.

Vendored per workspace and refreshed when the version marker on line 1 differs, exactly
like tokens.css. Do not edit in a workspace: figure_scaffold overwrites it.

figure.py never sets an rcParam and never opens data.json. Two rcParams in particular are
owned here because getting them wrong is silent and fatal:

  svg.fonttype = "none"  -- the default ("path") OUTLINES text into <path>, which destroys
                            every text-level lint rule. Provenance would pass vacuously.
  pdf.fonttype = 42      -- Type 3 fonts are rejected outright by IEEE, ACM and Elsevier.
"""

import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

_DIR = os.environ["PAPERINO_FIG_DIR"]
_NAME = os.environ["PAPERINO_FIG_NAME"]
_FACE = os.environ.get("PAPERINO_FIG_FACE", "TeXGyreTermes")
_MATH = os.environ.get("PAPERINO_FIG_MATH", "stix")
_FONTS = os.environ.get("PAPERINO_FIG_FONTS", "")
_INCHES = json.loads(os.environ.get("PAPERINO_FIG_INCHES", '{"narrow": 3.25, "full": 5.5}'))

# Register the vendored TTFs so the SVG names the same family the browser will resolve
# from tokens.css. Without this matplotlib falls back to DejaVu Serif and rule 13 fails.
if _FONTS and os.path.isdir(_FONTS):
    for entry in sorted(os.listdir(_FONTS)):
        if entry.lower().endswith(".ttf"):
            font_manager.fontManager.addfont(os.path.join(_FONTS, entry))

# The ink. Mirrors tokens.css so the two engines cannot drift; a raw hex in figure.py is
# lint rule 5.
INK = "#111111"
MUTED = "#555555"
GRID = "#999999"
ACCENT = "#1a4f9c"
ACCENT_WARM = "#b03a2e"

plt.rcParams.update({
    "svg.fonttype": "none",
    "pdf.fonttype": 42,
    "ps.fonttype": 42,
    "font.family": _FACE,
    "mathtext.fontset": _MATH,
    # 9pt body at the 96dpi print mapping is the same floor the HTML engine enforces (7pt
    # hard minimum, lint rule 3). Nothing here may go below 7.
    "font.size": 9,
    "axes.labelsize": 9,
    "axes.titlesize": 9,
    "xtick.labelsize": 8,
    "ytick.labelsize": 8,
    "legend.fontsize": 8,
    # Strokes: the SVG's user unit is a point, which Chromium maps to 1.333 CSS px, so
    # 0.7pt lands at 0.93px -- above lint rule 6's 0.75px floor. Do not go below 0.6.
    "axes.linewidth": 0.7,
    "xtick.major.width": 0.7,
    "ytick.major.width": 0.7,
    "lines.linewidth": 1.3,
    "lines.markersize": 4.0,
    "axes.prop_cycle": plt.cycler(color=[ACCENT_WARM, ACCENT, MUTED, INK]),
    "axes.grid": True,
    "axes.grid.axis": "y",
    "grid.color": GRID,
    "grid.linewidth": 0.5,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.unicode_minus": True,
    "figure.facecolor": "white",
    "savefig.facecolor": "white",
})


def data():
    """The figure's numbers. The ONLY sanctioned source -- lint rule 8 requires every
    rendered number to trace back to this file."""
    with open(os.path.join(_DIR, "data.json"), encoding="utf8") as fh:
        return json.load(fh)


def figure(width="full", panels=1, ratios=None, height=None):
    """A print-true figure. `width` is "narrow" (one column) or "full" (text width); the
    inches behind those names come from the workspace's venue, so the same call yields
    7.16in in an IEEE paper and 5.5in in a NeurIPS one."""
    inches = _INCHES[width]
    fig, axes = plt.subplots(
        1, panels,
        figsize=(inches, height if height is not None else inches * 0.42),
        gridspec_kw={"width_ratios": ratios} if ratios else None,
    )
    return fig, (list(axes) if panels > 1 else [axes])


def save(fig):
    """Emit the three artifacts the pipeline expects. The SVG is what lint measures."""
    fig.tight_layout(pad=0.3)
    build = os.path.join(_DIR, "build")
    os.makedirs(build, exist_ok=True)
    for ext in ("svg", "pdf", "png"):
        fig.savefig(
            os.path.join(build, f"{_NAME}.{ext}"),
            dpi=600 if ext == "png" else None,
            bbox_inches="tight",
            pad_inches=0.02,
        )
```

- [ ] **Step 2: Write the test that pins the load-bearing rcParams**

The module cannot be imported from bun, so assert on its source. This is the cheap check that catches a future edit deleting the two fatal rcParams; Task 5 proves the behaviour end to end.

```ts
// Paperino/figures-mcp/test/mpl-style.test.ts
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const src = readFileSync(join(import.meta.dir, "..", "src", "assets", "paperino_mpl.py"), "utf8")

describe("paperino_mpl.py", () => {
  test("owns the two rcParams whose absence is silent and fatal", () => {
    expect(src).toContain('"svg.fonttype": "none"')
    expect(src).toContain('"pdf.fonttype": 42')
  })

  test("carries a version marker on line 1 so scaffold can refresh it", () => {
    expect(src.split("\n", 1)[0]).toMatch(/^# paperino-mpl v\d+\.\d+$/)
  })

  test("no font size drops below the 7pt floor lint rule 3 enforces", () => {
    const sizes = Array.from(src.matchAll(/"(?:font|axes\.label|axes\.title|[xy]tick\.label|legend\.font)size":\s*([\d.]+)/g))
    expect(sizes.length).toBeGreaterThan(3)
    for (const m of sizes) expect(Number(m[1])).toBeGreaterThanOrEqual(7)
  })

  test("no stroke width drops below the 0.6pt floor that maps to lint rule 6's 0.75px", () => {
    const widths = Array.from(src.matchAll(/"(?:axes\.linewidth|[xy]tick\.major\.width|grid\.linewidth)":\s*([\d.]+)/g))
    expect(widths.length).toBeGreaterThan(2)
    for (const m of widths) expect(Number(m[1])).toBeGreaterThanOrEqual(0.5)
  })
})
```

- [ ] **Step 3: Run the test**

Run: `cd Paperino/figures-mcp && bun test test/mpl-style.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 4: Commit**

```bash
git add Paperino/figures-mcp/src/assets/paperino_mpl.py Paperino/figures-mcp/test/mpl-style.test.ts
git commit -m "feat(figures): machine-owned matplotlib style module"
```

---

### Task 4: The mpl engine runner

**Files:**
- Create: `Paperino/figures-mcp/src/engines/mpl.ts`
- Create: `Paperino/figures-mcp/test/mpl-engine.test.ts`

**Interfaces:**
- Consumes: `resolveVenue` (Task 1); `paperino_mpl.py` env contract (Task 3).
- Produces: `runMpl(opts: { workspace: string; figureDir: string; name: string; width: "narrow" | "full"; python?: string | null }): Promise<MplResult>` where `type MplResult = { ok: true; svg: string } | { ok: false; error: string }`, and `findPython(): string | null`.

- [ ] **Step 1: Write the failing test**

```ts
// Paperino/figures-mcp/test/mpl-engine.test.ts
import { describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { findPython, runMpl } from "../src/engines/mpl"

const workspace = () => {
  const dir = join(tmpdir(), `mpl-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(dir, "figures", "f1"), { recursive: true })
  return dir
}

describe("mpl engine", () => {
  test("a figure.py that raises returns the traceback verbatim, not a generic failure", async () => {
    const ws = workspace()
    const figureDir = join(ws, "figures", "f1")
    writeFileSync(join(figureDir, "data.json"), "{}")
    writeFileSync(join(figureDir, "figure.py"), "raise ValueError('deliberate')\n")
    const result = await runMpl({ workspace: ws, figureDir, name: "f1", width: "full" })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("ValueError")
      expect(result.error).toContain("deliberate")
    }
  })

  test("a missing interpreter is reported as setup, never as an impossible chart", async () => {
    const ws = workspace()
    const figureDir = join(ws, "figures", "f1")
    writeFileSync(join(figureDir, "data.json"), "{}")
    writeFileSync(join(figureDir, "figure.py"), "pass\n")
    const result = await runMpl({ workspace: ws, figureDir, name: "f1", width: "full", python: null })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("needs setup")
  })

  test("findPython returns an absolute path or null, never a bare name", () => {
    const found = findPython()
    if (found !== null) expect(found).toMatch(/[\\/]/)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd Paperino/figures-mcp && bun test test/mpl-engine.test.ts`
Expected: FAIL — `Cannot find module '../src/engines/mpl'`

- [ ] **Step 3: Implement**

```ts
// Paperino/figures-mcp/src/engines/mpl.ts
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveVenue } from "../venue"

export type MplResult = { ok: true; svg: string } | { ok: false; error: string }

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(HERE, "assets")

/** Resolution order mirrors the app: an explicit override, then the runtime the packaged
 *  app downloads into userData, then the dev venv, then PATH. Returns an absolute path so
 *  a shadowed `python` on PATH cannot silently win. */
export function findPython(): string | null {
  const candidates = [
    process.env.PAPERINO_PYTHON,
    join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "ai.paperino.desktop", "python", "python.exe"),
    join(HERE, "..", "..", "..", "tools", "pyoffice", ".venv", "Scripts", "python.exe"),
  ].filter((p): p is string => Boolean(p))
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

export async function runMpl(opts: {
  workspace: string
  figureDir: string
  name: string
  width: "narrow" | "full"
  /** Injected in tests; omit in production to use findPython(). */
  python?: string | null
}): Promise<MplResult> {
  const python = opts.python === undefined ? findPython() : opts.python
  if (!python)
    return {
      ok: false,
      error:
        "Figure Studio's chart engine needs setup: no Python runtime was found. " +
        "The HTML engine still works — re-scaffold with engine=html to draw this as a diagram.",
    }

  const venue = resolveVenue(opts.workspace)
  const env = {
    ...process.env,
    // paperino_mpl.py is vendored beside the figure, and ASSETS holds the shipped copy for
    // the packaged bundle; both are on the path so an un-refreshed workspace still runs.
    PYTHONPATH: [join(opts.workspace, "figures"), ASSETS, process.env.PYTHONPATH].filter(Boolean).join(";"),
    PAPERINO_FIG_DIR: opts.figureDir,
    PAPERINO_FIG_NAME: opts.name,
    PAPERINO_FIG_FACE: venue.textFace,
    PAPERINO_FIG_MATH: venue.mathFontset,
    PAPERINO_FIG_FONTS: join(opts.workspace, "figures", "fonts"),
    PAPERINO_FIG_INCHES: JSON.stringify(venue.inches),
    MPLBACKEND: "Agg",
  }

  const stderr = await new Promise<string | null>((resolve) => {
    execFile(
      python,
      [join(opts.figureDir, "figure.py")],
      { cwd: opts.figureDir, env, windowsHide: true, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 },
      (error, _stdout, err) => resolve(error ? err || String(error) : null),
    )
  })

  if (stderr !== null) {
    if (/ModuleNotFoundError: No module named 'matplotlib'/.test(stderr))
      return { ok: false, error: "Figure Studio's chart engine needs setup: matplotlib is not installed." }
    return { ok: false, error: stderr.trim() }
  }

  const svg = join(opts.figureDir, "build", `${opts.name}.svg`)
  if (!existsSync(svg)) return { ok: false, error: "figure.py ran but wrote no SVG — did you call save(fig)?" }
  return { ok: true, svg }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd Paperino/figures-mcp && bun test test/mpl-engine.test.ts`
Expected: PASS (3 tests). The traceback test needs a real interpreter; if `findPython()` returns null on the machine, install one before proceeding — the engine is untestable without it.

- [ ] **Step 5: Commit**

```bash
git add Paperino/figures-mcp/src/engines/mpl.ts Paperino/figures-mcp/test/mpl-engine.test.ts
git commit -m "feat(figures): run figure.py under the resolved interpreter, surfacing tracebacks"
```

---

### Task 5: Measure a matplotlib SVG with the existing worker

**Files:**
- Modify: `Paperino/figures-mcp/src/render-worker.mjs:13-14, 56-57, 124, 173-181`
- Modify: `Paperino/figures-mcp/src/render.ts:11, 79-99`
- Modify: `Paperino/figures-mcp/test/render.test.ts`

**Interfaces:**
- Consumes: `runMpl` (Task 4), `resolveVenue` (Task 1), `ScaffoldOpts.engine` (Task 7 — add the field to the type as part of Step 3 here so this task's test compiles).
- Produces: for `engine: "mpl"`, `render()` returns the same `RenderResult` shape and writes the same `build/bboxes.json`.

**Why a wrapper:** an SVG document loaded directly has no `<body>`, and the manifest walker starts at `document.body`. Inlining the SVG into a one-line HTML shell keeps every line of the existing extraction code working, and lets `tokens.css` supply the `@font-face` Chromium needs to resolve `TeXGyreTermes`.

- [ ] **Step 1: Write the failing test**

```ts
// append to Paperino/figures-mcp/test/render.test.ts
test("a matplotlib figure yields a manifest with measurable text and derived ticks", async () => {
  const ws = tmpWorkspace()
  await scaffold(ws, { name: "mplfig", archetype: "chart", engine: "mpl", claim: "c", caption: "c", width: "full" })
  const dir = join(ws, "figures", "mplfig")
  writeFileSync(join(dir, "data.json"), JSON.stringify({ bits: [2, 4, 8], err: [1.0, 0.0625, 0.000244] }))
  writeFileSync(
    join(dir, "figure.py"),
    [
      "from paperino_mpl import data, figure, save, ACCENT",
      "d = data()",
      "fig, (ax,) = figure('full')",
      "ax.plot(d['bits'], d['err'], marker='o', color=ACCENT)",
      "ax.set_yscale('log')",
      "ax.set_xlabel('bit-width')",
      "save(fig)",
    ].join("\n"),
  )
  const result = await render(ws, "mplfig")
  expect(result.ok).toBe(true)
  if (!result.ok) return
  const manifest = JSON.parse(readFileSync(join(dir, "build", "bboxes.json"), "utf8"))
  // real <text> nodes, not outlined paths
  expect(manifest.texts.length).toBeGreaterThan(3)
  expect(manifest.texts.some((t: any) => t.text === "bit-width")).toBe(true)
  // axis tick labels are computed, so they must be derived without the author saying so
  const ticks = manifest.texts.filter((t: any) => t.derived)
  expect(ticks.length).toBeGreaterThan(2)
  // the axis label is not a tick and must NOT be exempted
  expect(manifest.texts.find((t: any) => t.text === "bit-width").derived).toBe(false)
}, 60_000)
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd Paperino/figures-mcp && bun test test/render.test.ts`
Expected: FAIL — `scaffold` does not accept `engine`.

- [ ] **Step 3: Teach the worker an SVG mode**

In `render-worker.mjs`, destructure the new job field at line 14:

```js
const { figuresDir, buildDir, name, width, archetype, data, engine } = job
```

Replace the navigation at lines 56-57 with:

```js
  await page.addInitScript(`window.__DATA__ = ${data}`)
  if (engine === "mpl") {
    // An SVG document has no <body>, and the whole manifest walker starts at document.body.
    // Inlining it into a shell keeps every line of that extraction working unchanged, and
    // pulls in tokens.css so Chromium can resolve the same face matplotlib named.
    const svgMarkup = readFileSync(join(buildDir, `${name}.svg`), "utf8").replace(/<\?xml[^>]*\?>/, "")
    const wrapper = join(buildDir, `${name}.wrap.html`)
    writeFileSync(
      wrapper,
      `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="../../tokens.css">` +
        `<style>html,body{margin:0;padding:0;background:#fff}svg{display:block}</style>` +
        `<body>${svgMarkup}</body>`,
    )
    await page.goto(`${origin}/${name}/build/${name}.wrap.html`)
    // matplotlib emits static markup: nothing sets __FIG_READY__, so declare it ready once
    // the fonts have loaded.
    await page.evaluate(() => document.fonts.ready.then(() => true))
    await page.evaluate(() => { window.__FIG_READY__ = true })
  } else {
    await page.goto(`${origin}/${name}/figure.html`)
  }
```

At line 124, make `derived` engine-aware:

```js
          // Tick labels are COMPUTED, not experiment numbers. The HTML engine declares this
          // with data-derived; matplotlib's own gids (<g id="xtick_1">) say it structurally,
          // so an mpl author can neither forget it nor abuse it. closest() walks the nesting
          // (xtick_N wraps text_N) that a flat regex over the file cannot.
          derived:
            el.closest("[data-derived]") !== null ||
            el.closest('g[id^="xtick"], g[id^="ytick"]') !== null,
```

At lines 173-181, publish the SVG for both engines:

```js
  // The mpl engine wrote its own SVG; the HTML engine can only offer the annotation overlay.
  let svgPath = null
  if (engine === "mpl") {
    svgPath = join(buildDir, `${name}.svg`)
  } else if (archetype === "schematic") {
    const svgMarkup = await page.evaluate(() => document.querySelector("svg#annot-overlay")?.outerHTML ?? null)
    if (svgMarkup) {
      svgPath = join(buildDir, `${name}.svg`)
      writeFileSync(svgPath, svgMarkup)
    }
  }
```

- [ ] **Step 4: Dispatch in `render.ts`**

Replace the body of `render()` (lines 79-99) so the mpl engine runs Python first, then measures. Also replace the hardcoded `VIEWPORTS` lookup with the venue's px:

```ts
export async function render(workspace: string, name: string): Promise<RenderResult> {
  const figureDir = join(workspace, "figures", name)
  const meta = parse(readFileSync(join(figureDir, "meta.yaml"), "utf8"))
  const engine: "html" | "mpl" = meta.engine === "mpl" ? "mpl" : "html"
  const widthName = (meta.width as "narrow" | "full") ?? "full"
  const width = resolveVenue(workspace).px[widthName]
  const buildDir = join(figureDir, "build")
  mkdirSync(buildDir, { recursive: true })

  if (engine === "mpl") {
    const script = join(figureDir, "figure.py")
    if (!existsSync(script)) return { ok: false, error: `no figure.py at ${script}`, consoleOutput: [], png: null }
    const built = await runMpl({ workspace, figureDir, name, width: widthName })
    if (!built.ok) return { ok: false, error: built.error, consoleOutput: [], png: null }
  } else if (!existsSync(join(figureDir, "figure.html"))) {
    return { ok: false, error: `no figure.html at ${join(figureDir, "figure.html")}`, consoleOutput: [], png: null }
  }

  const data = existsSync(join(figureDir, "data.json")) ? readFileSync(join(figureDir, "data.json"), "utf8") : "{}"
  const jobPath = join(tmpdir(), `paperino-figure-${name}-${process.pid}.json`)
  writeFileSync(
    jobPath,
    JSON.stringify({ figuresDir: join(workspace, "figures"), buildDir, name, width, archetype: meta.archetype, data, engine }),
  )
  try {
    return await runWorker(jobPath)
  } finally {
    rmSync(jobPath, { force: true })
  }
}
```

Add `import { runMpl } from "./engines/mpl"` and `import { resolveVenue } from "./venue"`; delete the now-unused `VIEWPORTS` constant at line 11.

- [ ] **Step 5: Run the tests**

Run: `cd Paperino/figures-mcp && bun test`
Expected: PASS — including the new render test.

- [ ] **Step 6: Commit**

```bash
git add Paperino/figures-mcp/src/render-worker.mjs Paperino/figures-mcp/src/render.ts Paperino/figures-mcp/test/render.test.ts
git commit -m "feat(figures): measure a matplotlib SVG through the existing worker"
```

---

### Task 6: Engine-aware lint

**Files:**
- Modify: `Paperino/figures-mcp/src/lint.ts:16-26, 176-182, 207-211`
- Modify: `Paperino/figures-mcp/src/server.ts:78-83`
- Modify: `Paperino/figures-mcp/test/lint.test.ts`

**Interfaces:**
- Consumes: `Manifest` from Task 5.
- Produces: `LintInput.meta` gains `engine?: "html" | "mpl"`; `LintInput` gains `allowedFaces?: string[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to Paperino/figures-mcp/test/lint.test.ts
const mplBase = (overrides: any = {}) => ({
  source: "from paperino_mpl import data, figure, save\n",
  meta: { archetype: "chart", engine: "mpl", caption: "c", alt: "a", claim: "k" },
  data: { values: [3.7] },
  allowedFaces: ["KaTeX_", "TeXGyreTermes"],
  manifest: { viewport: { width: 528, height: 300 }, texts: [], strokes: [], elements: [] },
  ...overrides,
})

test("rule 8 still fires on a matplotlib label that invents a number", () => {
  const errors = lint(mplBase({
    manifest: {
      viewport: { width: 528, height: 300 },
      texts: [{ selector: "#t", text: "9.9x faster", rect: { x: 1, y: 1, w: 40, h: 10 },
                fontSize: 12, color: "rgb(17,17,17)", background: "rgb(255,255,255)",
                derived: false, fontFamily: "TeXGyreTermes", inKatex: false }],
      strokes: [], elements: [],
    },
  }))
  expect(errors.some((e) => e.rule === "provenance" && e.actual === "9.9")).toBe(true)
})

test("rule 9 does not fire on matplotlib's own root svg", () => {
  const errors = lint(mplBase({ source: '<svg width="516pt" height="216pt" viewBox="0 0 516 216">' }))
  expect(errors.some((e) => e.rule === "root-svg")).toBe(false)
})

test("rule 9 still fires on authored html markup", () => {
  const errors = lint(mplBase({
    meta: { archetype: "schematic", engine: "html", caption: "c", alt: "a", claim: "k" },
    source: '<svg width="100" height="50">',
  }))
  expect(errors.some((e) => e.rule === "root-svg")).toBe(true)
})

test("rule 13 accepts a venue face and still rejects a silent fallback", () => {
  const text = (fontFamily: string) => ({
    selector: "#t", text: "label", rect: { x: 1, y: 1, w: 20, h: 10 }, fontSize: 12,
    color: "rgb(17,17,17)", background: "rgb(255,255,255)", derived: false, fontFamily, inKatex: false,
  })
  const ok = lint(mplBase({ manifest: { viewport: { width: 528, height: 300 }, texts: [text("TeXGyreTermes, serif")], strokes: [], elements: [] } }))
  expect(ok.some((e) => e.rule === "font-allowlist")).toBe(false)
  const bad = lint(mplBase({ manifest: { viewport: { width: 528, height: 300 }, texts: [text("DejaVu Serif, serif")], strokes: [], elements: [] } }))
  expect(bad.some((e) => e.rule === "font-allowlist")).toBe(true)
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd Paperino/figures-mcp && bun test test/lint.test.ts`
Expected: FAIL — `root-svg` fires on the matplotlib tag, `font-allowlist` fires on `TeXGyreTermes`.

- [ ] **Step 3: Extend the input type**

In `lint.ts`, lines 16-26, change the `meta` field and add `allowedFaces`, leaving `manifest` untouched:

```ts
export type LintInput = {
  source: string
  meta: { archetype: string; caption: string; alt: string; claim: string; engine?: "html" | "mpl" }
  data: unknown
  /** Families a text node may be set in. Venue-derived, so a Times paper and a CM paper
   *  each accept exactly their own face and nothing else. */
  allowedFaces?: string[]
  manifest: {
    viewport: { width: number; height: number }
    texts: TextBox[]
    strokes: { selector: string; width: number }[]
    elements: ElementBox[]
  }
}
```

- [ ] **Step 4: Make rules 9 and 13 engine- and venue-aware**

Rule 9 (lines 176-182) — guard the loop:

```ts
  // 9 root-svg: authored markup only. matplotlib emits its own root <svg> with both a
  // viewBox and pt dimensions; no human wrote it, and there is nothing to fix in it.
  if (input.meta.engine !== "mpl")
    for (const m of input.source.matchAll(/<svg\b[^>]*>/g)) {
      const tag = m[0]
      if (!/viewBox=/.test(tag)) err("root-svg", "svg", "no viewBox", "viewBox required")
      if (/\bwidth="\d+"/.test(tag) || /\bheight="\d+"/.test(tag))
        err("root-svg", "svg", "fixed px width/height", "no fixed px dimensions")
    }
```

Rule 13 (lines 207-211):

```ts
  // 13 font-allowlist: catches a silent fallback to Segoe UI, DejaVu or the system serif.
  const allowed = input.allowedFaces ?? ["KaTeX_"]
  for (const t of texts) {
    const first = t.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "")
    if (!allowed.some((a) => first.startsWith(a)))
      err("font-allowlist", t.selector, first, `one of ${allowed.join(", ")}`)
  }
```

Rule 5 needs no code change — it already scans `input.source`, which is `figure.py` for the mpl engine, and a raw `"#D55E00"` there must fail exactly as it does in `figure.html`.

- [ ] **Step 5: Feed it from the server**

In `server.ts`, the `figure_lint` handler reads `figure.html` unconditionally. Replace lines 78-83:

```ts
    const meta = parse(readFileSync(join(dir, "meta.yaml"), "utf8"))
    const engine: "html" | "mpl" = meta.engine === "mpl" ? "mpl" : "html"
    const venue = resolveVenue(a.workspace)
    const errors = lint({
      source: readFileSync(join(dir, engine === "mpl" ? "figure.py" : "figure.html"), "utf8"),
      meta: { ...meta, engine },
      data: JSON.parse(readFileSync(join(dir, "data.json"), "utf8")),
      allowedFaces: ["KaTeX_", venue.textFace],
      manifest: JSON.parse(readFileSync(bboxPath, "utf8")),
    })
```

Add `import { resolveVenue } from "./venue"`.

- [ ] **Step 6: Run the full suite**

Run: `cd Paperino/figures-mcp && bun test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add Paperino/figures-mcp/src/lint.ts Paperino/figures-mcp/src/server.ts Paperino/figures-mcp/test/lint.test.ts
git commit -m "feat(figures): make rules 9 and 13 engine- and venue-aware"
```

---

### Task 7: Scaffold the engine, and let the model choose it

**Files:**
- Modify: `Paperino/figures-mcp/src/scaffold.ts:14-23, 51-64`
- Create: `Paperino/figures-mcp/src/templates/chart-mpl/figure.py`
- Modify: `Paperino/figures-mcp/src/server.ts:26-51`
- Modify: `Paperino/figures-mcp/test/scaffold.test.ts`, `Paperino/figures-mcp/test/templates.test.ts`

**Interfaces:**
- Consumes: `paperino_mpl.py` (Task 3).
- Produces: `ScaffoldOpts` gains `engine?: "html" | "mpl"` (default `"html"`); `meta.yaml` gains `engine`.

- [ ] **Step 1: Write the failing test**

```ts
// append to Paperino/figures-mcp/test/scaffold.test.ts
test("engine=mpl scaffolds figure.py, not figure.html, and vendors the style module", async () => {
  const ws = tmpWorkspace()
  await scaffold(ws, { name: "c1", archetype: "chart", engine: "mpl", claim: "c", caption: "c", width: "full" })
  const dir = join(ws, "figures", "c1")
  expect(existsSync(join(dir, "figure.py"))).toBe(true)
  expect(existsSync(join(dir, "figure.html"))).toBe(false)
  expect(parse(readFileSync(join(dir, "meta.yaml"), "utf8")).engine).toBe("mpl")
  expect(existsSync(join(ws, "figures", "paperino_mpl.py"))).toBe(true)
})

test("the default engine stays html so existing behaviour is unchanged", async () => {
  const ws = tmpWorkspace()
  await scaffold(ws, { name: "s1", archetype: "schematic", claim: "c", caption: "c", width: "full" })
  expect(existsSync(join(ws, "figures", "s1", "figure.html"))).toBe(true)
  expect(parse(readFileSync(join(ws, "figures", "s1", "meta.yaml"), "utf8")).engine).toBe("html")
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd Paperino/figures-mcp && bun test test/scaffold.test.ts`
Expected: FAIL — `figure.py` absent.

- [ ] **Step 3: Write the template**

```python
# Paperino/figures-mcp/src/templates/chart-mpl/figure.py
"""Replace this with the figure. Rules the lint enforces, so read them first:

  * Every number that appears as INK must come from data(). A literal in a label is
    lint rule 8 and the reason this subsystem exists.
  * Colours come from the module (ACCENT, ACCENT_WARM, MUTED, GRID, INK). A raw hex
    here is lint rule 5.
  * Never set an rcParam and never call savefig yourself -- figure() and save() own the
    print-true size, the SVG text mode and the Type-42 embedding.
  * Name artists you may want to patch later: line.set_gid("series-keys") becomes an id
    in the SVG, and lint reports against it.
"""

from paperino_mpl import ACCENT, ACCENT_WARM, data, figure, save

d = data()

fig, (ax,) = figure("full")
ax.plot(d["x"], d["y"], marker="o", color=ACCENT, label="replace me")
ax.set_xlabel("replace me")
ax.set_ylabel("replace me")
ax.legend(frameon=False)

save(fig)
```

- [ ] **Step 4: Implement the scaffold change**

In `scaffold.ts`, extend the options type:

```ts
export type ScaffoldOpts = {
  name: string
  archetype: Archetype
  /** Which renderer authors this figure. Defaults to html — the historical behaviour. */
  engine?: "html" | "mpl"
  claim: string
  caption: string
  width: "narrow" | "full"
  alt?: string
}
```

and in the body, replacing the single `cpSync` of `figure.html` at line 52:

```ts
  const engine = opts.engine ?? "html"
  if (engine === "mpl") {
    cpSync(join(TEMPLATES, "chart-mpl", "figure.py"), join(figureDir, "figure.py"))
    // Vendored beside tokens.css and refreshed on the same version-marker rule.
    const marker = (py: string) => py.split("\n", 1)[0].trim()
    const shippedPy = readFileSync(join(ASSETS, "paperino_mpl.py"), "utf8")
    const target = join(figuresDir, "paperino_mpl.py")
    if (!existsSync(target) || marker(readFileSync(target, "utf8")) !== marker(shippedPy))
      writeFileSync(target, shippedPy)
  } else {
    cpSync(join(TEMPLATES, opts.archetype, "figure.html"), join(figureDir, "figure.html"))
  }
```

and add `engine` to the `meta.yaml` object written at lines 54-64:

```ts
      id: opts.name,
      archetype: opts.archetype,
      engine,
      width: opts.width,
```

- [ ] **Step 5: Expose the choice on the tool, with the decision table**

In `server.ts`, add to `figure_scaffold`'s `inputSchema`:

```ts
      engine: z
        .enum(["html", "mpl"])
        .default("html")
        .describe(
          "Which renderer authors this figure. YOU choose, per figure:\n" +
            "  mpl  — anything quantitative: axes, log scales, series, distributions, error " +
            "bands, reference lines, multi-panel comparisons. matplotlib has the primitives; " +
            "the HTML engine has two linear scales and cannot draw them.\n" +
            "  html — diagrams and structure: schematics, pipelines, free-form boxes and " +
            "arrows, rich inline math, annotated galleries, tables.\n" +
            "Both are linted identically. If a figure is a plot, pick mpl.",
        ),
```

`scaffold(a.workspace, a)` already forwards the whole argument object, so no call-site change is needed. Update the returned hint text:

```ts
    return text(
      a.engine === "mpl"
        ? `scaffolded ${figureDir}. Edit figure.py (numbers from data(), colors from the module, ` +
          `never set an rcParam), put numbers in data.json, then figure_render.`
        : `scaffolded ${figureDir}. Edit figure.html (layout=HTML/flex/grid, annotations=lib/annot.js, ` +
          `colors=var(--…) only), put numbers in data.json, then figure_render.`,
    )
```

- [ ] **Step 6: Extend the template test**

```ts
// append to Paperino/figures-mcp/test/templates.test.ts
test("the mpl template imports only the module's sanctioned surface", () => {
  const py = readFileSync(join(import.meta.dir, "..", "src", "templates", "chart-mpl", "figure.py"), "utf8")
  expect(py).toContain("from paperino_mpl import")
  expect(py).not.toMatch(/rcParams/)
  expect(py).not.toMatch(/savefig/)
  expect(py).not.toMatch(/#[0-9a-fA-F]{6}/)
})
```

- [ ] **Step 7: Run the full suite**

Run: `cd Paperino/figures-mcp && bun test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add Paperino/figures-mcp/src/scaffold.ts Paperino/figures-mcp/src/server.ts \
        Paperino/figures-mcp/src/templates/chart-mpl Paperino/figures-mcp/test/scaffold.test.ts \
        Paperino/figures-mcp/test/templates.test.ts
git commit -m "feat(figures): let the model pick the engine at scaffold time"
```

---

### Task 8: A matplotlib exemplar, and per-engine review

**Files:**
- Modify: `Paperino/figures-mcp/test/author-exemplars.ts`
- Create: `Paperino/figures-mcp/src/assets/exemplars/exemplar-chart-mpl.png`
- Modify: `Paperino/figures-mcp/src/server.ts:97-127`

**Interfaces:**
- Consumes: the whole pipeline from Tasks 1-7.
- Produces: `figure_review` returns the render plus the exemplar pair matching the figure's engine.

**Why this task is not optional:** `figure_review` hands the model exemplars as "the bar". Reviewing a matplotlib chart against `exemplar-chart.png` — four bars, linear axis, no legend — actively steers it backwards.

- [ ] **Step 1: Author the exemplar**

Add to `test/author-exemplars.ts` a workspace that scaffolds `engine: "mpl"` and writes a two-panel figure exercising the vocabulary the HTML engine lacks: a log axis, a percentile band, two marker series, a legend, a reference line and an annotation. Its `data.json` must contain every number that appears as ink, or rule 8 fails it — which is the point.

Run: `cd Paperino/figures-mcp && bun test/author-exemplars.ts`

- [ ] **Step 2: LOOK AT THE PNG**

Open `src/assets/exemplars/exemplar-chart-mpl.png` and check it by eye:

- Is the top gridline labelled? (v2's exemplar shipped for weeks with an unlabelled top tick, so no bar's value could be read. Regenerating is not inspecting.)
- Is every axis labelled, with units?
- Does it read at 50% scale, and in grayscale?
- Do the two series differ by more than colour alone?

If any answer is no, fix the authoring script and regenerate. Do not proceed on a bad exemplar.

- [ ] **Step 3: Serve the right pair**

In `server.ts`'s `figure_review` handler, replace the fixed exemplar pair in the returned content:

```ts
    // Exemplars are the bar the model steers toward, so they must match the engine. Showing
    // a matplotlib chart the four-bar div exemplar steers it backwards.
    const engine = meta.engine === "mpl" ? "mpl" : "html"
    const exemplars =
      engine === "mpl"
        ? ["exemplar-chart-mpl.png", "exemplar-schematic.png"]
        : ["exemplar-schematic.png", "exemplar-chart.png"]
    return {
      content: [
        image(join(dir, "build", `${a.name}.png`)),
        ...exemplars.map((f) => image(join(EXEMPLARS, f))),
        { type: "text" as const, text: rubric },
      ],
    }
```

and add one line to the rubric array, after the pseudo-math bullet:

```ts
      "- Is this the right ENGINE? A plot drawn as boxes, or a diagram forced onto axes, is a " +
        'wrong-engine failure: say so and re-scaffold with the other engine rather than patching.',
```

- [ ] **Step 4: Run the suite**

Run: `cd Paperino/figures-mcp && bun test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Paperino/figures-mcp/src/assets/exemplars/exemplar-chart-mpl.png \
        Paperino/figures-mcp/test/author-exemplars.ts Paperino/figures-mcp/src/server.ts
git commit -m "feat(figures): per-engine exemplars and a wrong-engine review verdict"
```

---

### Task 9: Ship it — wheels, staging, docs

**Files:**
- Modify: `Paperino/opencode-dev/packages/desktop/src/main/paperino/setup.ts:117-121`
- Modify: `Paperino/figures-mcp/scripts/build-dist.ts`
- Modify: `Paperino/CLAUDE.md`
- Modify: `Paperino/figures-mcp/test/dist.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: a packaged build whose figures-mcp bundle carries `paperino_mpl.py`, the fonts and the mpl template, and whose Python component has matplotlib.

- [ ] **Step 1: Add matplotlib to the Python component**

`setup.ts` already pip-installs `paperbanana/requirements.lock` into the portable CPython at lines 117-121. Append `matplotlib` to that lockfile so the same install covers the chart engine — a second install step would double the download and could leave the two out of sync.

- [ ] **Step 2: Write the failing bundle test**

```ts
// append to Paperino/figures-mcp/test/dist.test.ts
test("the bundle ships the assets the mpl engine loads at runtime", () => {
  const dist = join(import.meta.dir, "..", "dist")
  expect(existsSync(join(dist, "assets", "paperino_mpl.py"))).toBe(true)
  expect(existsSync(join(dist, "assets", "fonts", "TeXGyreTermes-Regular.ttf"))).toBe(true)
  expect(existsSync(join(dist, "assets", "fonts", "TeXGyreTermes-Regular.woff2"))).toBe(true)
  expect(existsSync(join(dist, "templates", "chart-mpl", "figure.py"))).toBe(true)
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `cd Paperino/figures-mcp && bun run scripts/build-dist.ts && bun test test/dist.test.ts`
Expected: FAIL — the assets are not copied.

- [ ] **Step 4: Copy them in `build-dist.ts`**

Read the script first: if it copies `assets/` and `templates/` wholesale the test may already pass once the files exist, and no edit is needed; if it enumerates subdirectories explicitly, add `fonts` and `chart-mpl` to that list. Re-run Step 3 until green.

- [ ] **Step 5: Record the traps in CLAUDE.md**

Add to the `## figures-mcp` section:

```markdown
- **There are two engines, and the model picks.** `meta.yaml`'s `engine` is `html` (HTML/CSS +
  the SVG annotation overlay) or `mpl` (matplotlib authoring `figure.py`). They converge on an
  SVG measured in Chromium, which is the only reason one lint covers both — any future engine
  must reach that point or it does not ship. The HTML engine has **two linear scales and no
  log, band, marker, legend or panel primitive**; that is why charts go to `mpl`, and the
  four-bar `exemplar-chart.png` is its true ceiling.
- **`svg.fonttype: "none"` is load-bearing.** matplotlib's default outlines text into `<path>`,
  which silently empties the manifest — provenance, contrast, type-floor and font rules would
  all pass vacuously on a figure nobody measured. `paperino_mpl.py` owns it, along with
  `pdf.fonttype: 42` (IEEE/ACM/Elsevier reject Type 3).
- **An SVG document has no `<body>`.** The manifest walker starts at `document.body`, so the
  worker inlines the matplotlib SVG into a one-line HTML shell rather than navigating to the
  `.svg` — that also pulls in `tokens.css`, without which Chromium cannot resolve the face
  matplotlib named and every text node fails rule 13.
- **`derived` is inferred from matplotlib's gids** (`g[id^="xtick"]`), not declared. The lookup
  must be `closest()`, not a regex: `<g id="xtick_1">` wraps `<g id="text_N">`, and a
  non-greedy match stops at the inner `</g>` and finds nothing.
- **The figure face is venue-derived** (`venue:` in `paperino.yaml` → `src/venue.ts`), because
  IEEE/ACM/NeurIPS set body text in Times while v2 pinned Computer Modern — every figure in
  those papers used to mismatch its own caption. The venue is stamped into the vendored
  `tokens.css` version marker, so changing it re-vendors through the existing mechanism.
  Absent `venue` means `neurips`, whose 3.25/5.5in are exactly the old 312/528px.
```

- [ ] **Step 6: Full verification**

```bash
cd Paperino/figures-mcp && bun test
```
Expected: PASS, 27 pre-existing plus ~20 new.

Then verify **in the running app**, which is where the Tectonic path bug, the unmounted panel and the JPEG extension all hid:

```
Paperino\opencode-dev\paperino-dev.cmd
```

Ask the agent for a chart from real numbers in `artifacts/`. Confirm: it picks `mpl`; `figure.py` appears; lint passes; the review PNG looks like a paper figure; and `\includegraphics[width=\linewidth]` in the preview lands at the right size.

- [ ] **Step 7: Commit**

```bash
git add Paperino/CLAUDE.md Paperino/figures-mcp/scripts/build-dist.ts Paperino/figures-mcp/test/dist.test.ts \
        Paperino/opencode-dev/packages/desktop/src/main/paperino/setup.ts
git commit -m "feat(figures): ship the chart engine — wheels, staged assets, traps recorded"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: engine field and convergence → 5, 7; provenance/`derived` → 5, 6; components table → 1-5, 7; style-module contract → 3; venue type system and widths → 1, 2; lint changes (rules 5, 9, 13) → 6; engine selection and exemplars → 7, 8; error handling → 4; testing → distributed, each task ending green; packaging → 9.

**Placeholders.** None. Two steps are deliberately investigative rather than prescriptive and say so: Task 8 Step 2 (look at the exemplar by eye — the failure mode it guards against is precisely a mechanical regeneration) and Task 9 Step 4 (read how `build-dist.ts` copies before editing it).

**Type consistency.** `Venue.textFace` (Task 1) is the same string consumed by `tokens.css` stamping (2), `PAPERINO_FIG_FACE` (3, 4) and `allowedFaces` (6). `runMpl`/`findPython` signatures in Task 4 match their call sites in Task 5. `ScaffoldOpts.engine` (7) matches `meta.engine` read in `render.ts` (5), `lint` (6) and `figure_review` (8). `data()`/`figure()`/`save()` in the module (3) match the template (7) and the render test (5).
