# Paperino Figure Studio — Code-Authored Publication Figures

**Date:** 2026-07-09
**Status:** Approved design (v1 = brief's P0–P5)
**Replaces:** PaperBanana as sub-project 3 of the umbrella spec
(`2026-07-09-paperino-design.md`). PaperBanana moves to the backlog as an optional
pictorial add-on; its pinned-model decisions remain recorded in the umbrella spec.

## 1. Purpose

Give Paperino's agent the ability to author Anthropic-quality paper figures
(transformer-circuits style) as **code** — HTML/CSS/SVG bound to experiment data —
rather than as generated images. Vector output, deterministic linting, and structural
impossibility of number hallucination.

**The core idea: three separations plus one loop.**

- Separations: **data** (JSON from experiments) ↔ **layout** (HTML/SVG) ↔ **style**
  (CSS custom properties). An agent typing `y="347"` and `fill="#f59e0b"` produces
  garbage; an agent writing `<div class="card">` and `arrow('#a', '#b', {bow: 0.3})`
  produces the Anthropic look on the first try.
- The loop: the agent must **see what it rendered**. Blind SVG generation is the single
  biggest failure mode. Render → lint → screenshot → vision-review → patch → repeat.
  Everything in this spec exists to serve that loop.

**Locked decisions:**

- Figure Studio is the **primary** figure pipeline (schematics, galleries, charts,
  tables). PaperBanana (image generation) is deferred, optional, pictorial-only.
- v1 scope = brief phases **P0–P5**: templates + tokens + render, lint + bbox manifest,
  annot.js, vision-review loop with exemplars, data binding + table generator +
  provenance hashing, PDF/PNG/SVG dual output. **v2 (explicitly deferred):** P6
  cross-figure registry + consistency lint (`figures/registry.json` is reserved now),
  P7 the 12-spec eval set.
- **Vision review is done by the chat model itself**: `figure_review` returns the PNG as
  an MCP image block plus rubric; no pinned review VLM. Lint is deterministic and
  model-independent, so a non-vision chat model still gets quality gating from lint.
- Ships as a standalone **TypeScript MCP stdio server** (`figures-mcp`), registered in
  `paperino-config/opencode.jsonc` — never chassis code.

## 2. Architecture

```
Paperino/figures-mcp/                 # TS MCP server (bun runtime)
  src/server.ts                       # tool registration (5 tools)
  src/render.ts                       # Playwright render + bbox manifest + PDF/SVG export
  src/lint.ts                         # 10 deterministic rules
  src/scaffold.ts                     # template copy + lib vendoring
  src/templates/{schematic,gallery,chart,table}/   # figure.html + meta.yaml stubs
  src/assets/tokens.css               # the design system (Anthropic-look defaults)
  src/assets/lib/{annot.js,scale.js,table.js}      # d3-scale bundled in — no CDN
  src/assets/exemplars/*.png          # 2 reference screenshots fed to figure_review
  test/                               # lint fixtures, render smoke, provenance tests

<paper workspace>/
  figures/
    tokens.css                        # vendored ONCE by first scaffold; the only place
    lib/                              #   colors/type/strokes exist. Papers stay
    registry.json                     #   self-contained + reproducible. (registry: v2)
    fig02-jspace/
      meta.yaml                       # id, archetype, width, caption, alt, claim
      data.json                       # extracted from artifacts/ — the only numbers
      figure.html                     # the component
      build/                          # <name>.{png,pdf,svg} + bboxes.json (gitignored)
```

`meta.yaml` carries a **claim** — the one sentence the figure must demonstrate, written
*before* the figure. The review rubric is scored against it.

**Data flow (the loop):** classify archetype → `figure_scaffold` → edit `figure.html`
(+ `data.json` extract via `data_query`) → `figure_render` → `figure_lint` (gates
review) → `figure_review` (PNG + claim + rubric to the chat model) → patch by selector →
repeat, **hard cap 4 iterations**, then stop and surface the render + open issues to the
user. Final: `\includegraphics{figures/<name>/build/<name>.pdf}` in the manuscript, and
copy the PDF to `.paperino/preview.pdf` so it appears in the Preview panel (existing
channel, zero chassis changes).

## 3. Tool contracts

| Tool | Contract |
|---|---|
| `figure_scaffold(name, archetype, claim, caption, width)` | Creates `figures/<name>/` from the archetype template; writes `meta.yaml`; vendors `tokens.css` + `lib/` into `figures/` if absent. `width`: `narrow` (550px) \| `full` (1100px). Refuses to overwrite an existing figure. |
| `figure_render(name)` | Playwright headless Chromium at the fixed viewport for the figure's width; waits for `document.fonts.ready` AND `window.__FIG_READY__` (templates set it; annot.js sets it after overlay draw); emits `build/<name>.png`, `.pdf` (CDP `printToPDF`, `--font-render-hinting=none`, fonts embedded), `.svg` (serialized DOM where applicable) and `bboxes.json` — every text node's rect, computed color, computed background, computed font-size, plus every stroke's width. Returns paths + render console output. |
| `figure_lint(name)` | Runs the 10 rules against `bboxes.json` + `figure.html` source + `meta.yaml` + `data.json`. Returns `{passed, errors: [{rule, selector, actual, expected}]}` — selectors, never prose, so the agent patches by ID. |
| `figure_review(name)` | Refuses unless the latest lint passed. Returns: the PNG as an MCP image content block, the `claim`, the rubric (below), and the 2 built-in exemplar screenshots as additional image blocks. The chat model performs the review and decides its own patches. |
| `data_query(path, jq_expr)` | Read-only jq evaluation over JSON files in the workspace (`artifacts/`, `figures/*/data.json`). How numbers travel into figures without being retyped. |

**Review rubric** (returned as text with the images): Does the figure demonstrate the
claim? Is the element the caption is about the most salient thing? Is anything encoded
twice? Readable at 50% scale (two-column)? Survives grayscale? Output requested as
structured JSON: `{demonstrates_claim, issues: [{severity, selector, problem, fix}],
readable_at_50pct}`.

## 4. The annotation library (the actual unlock)

Models cannot eyeball bezier control points, so they never see one. `annot.js` is
declarative, anchored to element IDs, resolved at render time via
`getBoundingClientRect()`, drawing into ONE absolutely-positioned SVG overlay:

```js
arrow('#token-is', '#readout-box', { bow: 0.35, side: 'bottom' })
brace('#layers-40-70', { side: 'left', label: 'Workspace\nlives here' })
highlight('#jspace-column', { style: 'dashed', tone: 'accent' })
```

`bow` is the swoop — swoopy-drag reduced to one scalar an LLM can reason about
(quadratic bezier, ~40 lines). Corollary rule, taught by templates and AGENTS.md:
**compose in HTML + CSS (flex/grid does layout); SVG is connective tissue only.** The
browser computes every coordinate; the agent computes none.

## 5. Archetypes

Classification is the agent's first decision; freestyling is where it goes wrong.

| Archetype | Example | Rule |
|---|---|---|
| `schematic` | reference Figure 2 | Hand-authored structure; every arrow/brace/highlight from annot.js |
| `gallery` | reference Figure 3 | HTML grid templated from `data.json` records; manual copies are a lint failure |
| `chart` | any bar/line | Marks data-bound via `scale.js` (d3-scale wrappers); a hand-placed bar is a lint failure |
| `table` | results table | Generated by `table.js` from `data.json`; **numeric literals in cells are a lint failure** |

The table rule kills number hallucination structurally — the same move as the
machine-owned `references.bib`.

## 6. Lint spec (v1: 10 rules)

Deterministic, cheap, catches what vision misses. Run order: source checks, then
bbox-manifest checks.

1. **text-overlap** — pairwise bbox intersection over text nodes → fail (#1 LLM defect)
2. **overflow** — any bbox outside the root viewport → fail
3. **min-type-size** — computed font-size < 9px at final scale → fail
4. **contrast** — text vs computed background < 4.5:1 → fail
5. **no-raw-color** — `#[0-9a-fA-F]{3,8}` or `rgb(` in `figure.html` → fail; `var(--…)` only
6. **stroke-floor** — stroke-width < 0.75px → fail (vanishes in print)
7. **palette** — categorical colors must resolve to tokens.css vars; distinct count ≤ 5
8. **provenance** — `chart`/`table`: every rendered numeric string must trace to a value
   reachable in `data.json` (hash/lookup check) → fail otherwise
9. **root-svg** — `viewBox` required; fixed px `width`/`height` on the root svg → fail
10. **meta-complete** — `caption`, `alt`, `claim` present in `meta.yaml`

Failures return `{rule, selector, actual, expected}`. v2 adds rule 11 (registry
consistency across figures).

## 7. Error handling

- **Render failure** (JS exception, missing `__FIG_READY__` within timeout): return
  console output + a screenshot of whatever painted — the agent debugs like a person.
- **Playwright browser missing**: `figure_render` fails with the exact remediation
  (`bunx playwright install chromium`); setup docs install it up front.
- **Lint failures**: machine-patchable by selector; agent iterates without asking.
- **Review loop**: hard cap 4 iterations per figure, then stop, keep the best render,
  surface it + the open issue list to the user. Never thrash.
- **`data_query` on missing path/bad jq**: typed error naming the file tried.

## 8. Testing

- **Lint unit tests**: one fixture per rule violating exactly that rule; one clean
  fixture passing all 10.
- **Render smoke**: each archetype template renders out of the box → non-empty
  `bboxes.json`, PNG non-trivial, PDF starts `%PDF-`.
- **Provenance test**: doctor one number in a rendered table → rule 8 fails with the
  cell's selector.
- **Acceptance (exit gate):** reproduce **both Anthropic reference figures** — Figure 2
  as `schematic` (braces, swoopy layer arrows, dashed J-space highlight, three side
  cards), Figure 3 as `gallery` (six prompt cards with connector curves and layer
  readouts from `data.json`) — both lint-clean, plus one data-bound `table` from a real
  results JSON; all three `\includegraphics`-ed into the demo paper, compiling, and
  visible in the Preview panel.

## 9. Umbrella build-order change

1. Chassis — **done** (shipped 2026-07-09)
2. `literature-mcp` — unchanged
3. **`figures-mcp` (this spec)** — replaces PaperBanana at position 3
4. Writing + critic pack — unchanged
5. Backlog: PaperBanana pictorial add-on; Figure Studio v2 (P6 registry + consistency
   lint, P7 eval set of 12 figure specs scored on lint pass-rate + rubric).
