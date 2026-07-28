# Figure Studio v3: a second rendering engine, chosen by the model

**Status:** design approved 2026-07-28. Supersedes nothing; extends
`2026-07-13-figure-studio-publication-grade-design.md` (v2), which stays authoritative for
the HTML engine, the 13 lint rules and the review loop.

## The problem, stated precisely

Figure Studio cannot draw a quantitative chart. Not "draws one badly" — has no primitives
for it. The whole plotting library is `src/assets/lib/scale.js`, 71 lines: `scaleLinear`,
`scaleBand`, `niceDomain`. Both scales are linear. Marks are absolutely-positioned
`<div class="bar">` elements. The `chart` exemplar that the vision review steers every chart
toward — `src/assets/exemplars/exemplar-chart.png` — is four bars on a linear axis with one
series and no legend. That image *is* the ceiling.

A publication-grade sensitivity plot needs a log axis, percentile ribbons, lines with
markers, a reference line, two legends, two panels with unequal widths, minor ticks, and
annotation arrows. Eight of those nine have no primitive. The agent therefore does not
produce a worse chart; it cannot attempt one, and substitutes a schematic.

The gap is the toolkit, not the model. Given matplotlib the same model writes the figure in
forty lines, because matplotlib encodes chart craft — tick selection, log minor ticks,
legend layout, arrow routing — that no model should be re-deriving in CSS.

## Goal

Give the model a second engine and let it choose. Ship matplotlib for charts alongside the
existing HTML engine for diagrams, with **one lint, one review loop and one type system**
across both.

## Non-goals

Explicitly out of scope, and each for a reason:

- **TikZ/pgfplots.** The most paper-native option and the one `figure_review`'s own rubric
  names as the bar — but Tectonic emits PDF, no `dvisvgm`/`pdf2svg` is bundled, and without
  a PDF→SVG step every text-level rule goes dark, provenance included. Rule 8 going dark on
  an engine is how an invented number reaches a paper. Revisit only with a converter.
- **Source-level provenance.** Banning numeric literals in `figure.py` was considered and
  rejected: a plotting script legitimately contains `figsize=(7.16, 2.75)`, `alpha=0.15`,
  width ratios and tick counts. Unenforceable. The guarantee stays where it already works —
  measure rendered text, trace every number to `data.json`.
- **Automatic engine detection.** No heuristic guesses the engine from the caption. The
  model picks, with the trade-offs in the tool description.
- **A sans-serif (Nature-style) figure face.** Two families ship, CM and Times-metric. A
  third is a later change to the same token.

## Architecture

The two engines converge on one representation:

```
HTML engine:  figure.html ──Chromium──┐
                                      ├──▶ build/<name>.svg ──Chromium──▶ manifest ──▶ lint ──▶ review
mpl engine:   figure.py   ──Python────┘        + .png + .pdf
```

Both end at "an SVG measured in a browser." That single convergence point is why one lint
covers both, and why a third engine is later additive rather than structural.

`meta.yaml` gains `engine: html | mpl`. The HTML engine authors `figure.html`; the mpl
engine authors `figure.py`. Everything downstream of the SVG is unchanged.

### Why the mpl engine can be linted at all

Verified by probe against matplotlib 3.x on 2026-07-28, not assumed:

- With `svg.fonttype: "none"`, text is emitted as **real `<text>` nodes** carrying inline
  `font-size` and `font-family` — measurable by the existing worker via `getComputedStyle`.
  (The default, `svg.fonttype: "path"`, outlines text into `<path>` and destroys every
  text-level rule. This rcParam is load-bearing and must be set by the style module, not
  left to the author.)
- The backend emits **structural gids**: `figure_1`, `axes_1`, `xtick_N`, `ytick_N`,
  `legend_1`, `line2d_N`, `patch_N`, `FillBetweenPolyCollection_N`, `text_N`.
- **`set_gid()` survives into the SVG**, so an author names artists and lint reports by
  selector exactly as the HTML engine does with element IDs.

### Provenance, and why it gets stronger

`derived` — the flag exempting computed labels (axis ticks) from rule 8 — is today set by
the HTML author calling `derived()`. Forgetting it is a false failure; deliberately misusing
it is a hole.

Under matplotlib, `derived` is **inferred structurally**: a text node whose ancestor chain
contains `g[id^="xtick"]` or `g[id^="ytick"]` is a computed tick label. The worker resolves
this with `closest()`, which handles matplotlib's nesting (`<g id="xtick_1">` wraps
`<g id="text_N">`) natively. The author cannot forget it and cannot abuse it.

Everything else about rule 8 is unchanged: every non-derived rendered number must trace to a
value reachable in `data.json`.

## Components

| file | responsibility |
|---|---|
| `src/engines/mpl.ts` | resolve interpreter, run `figure.py`, surface tracebacks verbatim |
| `src/assets/paperino_mpl.py` | vendored style module — rcParams, palette, print-true sizing, `data()`, `save()` |
| `src/assets/fonts/` | TTF + WOFF2 for both families (matplotlib needs TTF; the browser needs WOFF2) |
| `src/templates/chart-mpl/figure.py` | scaffold template for the mpl engine |
| `src/render-worker.mjs` | SVG input mode; `derived` from gid ancestry |
| `src/lint.ts` | rules 5, 9, 13 become engine-aware (below) |
| `src/assets/exemplars/exemplar-chart-mpl.png` | the new bar for chart review |

`paperino_mpl.py` is **machine-owned and vendored per workspace**, on exactly the mechanism
`tokens.css` already uses: a version marker on line 1, refreshed by `figure_scaffold`
whenever it differs from the shipped copy. Vendoring only-if-absent would strand existing
workspaces on the design system they were born with.

### The style module's contract

`figure.py` never sets an rcParam and never opens `data.json` itself:

```python
from paperino_mpl import figure, data, save
d = data()                        # parsed data.json — the only source of numbers
fig, (a, b) = figure("full", panels=2, ratios=[1, 1.35])
...
save(fig)                         # emits .svg + .pdf + .png with the right backends
```

`figure()` owns figsize (venue-derived, below), `save()` owns `svg.fonttype: "none"` and
`pdf.fonttype: 42` — the latter because journals reject Type 3 fonts, a rule the author
should not have to remember.

## The type system, and a bug it fixes

v2 pinned KaTeX's Computer-Modern-derived faces. Most target venues — IEEE, ACM, NeurIPS,
ICML, ICLR, ACL — set their body text in Times. **Figures in those papers are therefore
currently set in CM inside a Times document.** This is live today, independent of this work,
and visible in the IEEE two-column paper that prompted the design.

The figure face becomes venue-derived. `paperino.yaml` gains:

```yaml
venue: ieee        # ieee | acm | neurips | icml | iclr | acl | article
```

| venue | text face | matplotlib math | HTML math |
|---|---|---|---|
| `article` | KaTeX_Main (CM) | `mathtext.fontset: "cm"` | KaTeX |
| everything else | TeX Gyre Termes (Times-metric, GUST Font License) | `mathtext.fontset: "stix"` (Times-metric math) | KaTeX + Termes body |

Both math fontsets are built into matplotlib — no math fonts are vendored. Only the two text
families ship, each in TTF (matplotlib registers via `font_manager.addfont`) and WOFF2 (the
browser).

**Consequence — print-true widths become venue-derived too.** `narrow`/`full` keep their
meaning (single column / full text width) but resolve to different inches per venue: IEEE
3.5in/7.16in, NeurIPS-family 3.25in/5.5in. Both engines read the same pair, so a chart and a
schematic in one paper are the same width by construction. This changes `VIEWPORTS` in
`render.ts`, which today hardcodes 312/528px.

Default when `paperino.yaml` has no `venue`: `neurips` — it preserves today's 312/528px
behaviour exactly, so existing workspaces do not silently reflow.

## Lint changes

Ten of thirteen rules are engine-independent and need no change. Three do:

- **Rule 5 `no-raw-color`** scans `input.source` for hex/rgb literals. For the mpl engine the
  source is `figure.py`; the same scan applies, and the palette must come from
  `paperino_mpl`, not from a literal `"#D55E00"`.
- **Rule 9 `root-svg`** requires `viewBox` and forbids fixed px dimensions on authored
  `<svg>` tags. matplotlib emits its own root `<svg>` with both a `viewBox` and `width`/
  `height` in points. The rule must apply to *authored* markup only, so it is skipped for
  the mpl engine, whose SVG no human wrote.
- **Rule 13 `font-allowlist`** hardcodes the prefix `KaTeX_`. It becomes a list of the
  shipped families (`KaTeX_*`, `TeXGyreTermes`), which is required for both the mpl engine
  and the venue token.

Rule 8 (provenance) explicitly runs unchanged on the mpl engine. This is the point of the
subsystem; an engine that escaped it would be a downgrade regardless of output quality.

## Engine selection — freedom, guided

`figure_scaffold` gains `engine`, and its description carries the decision table:

- `mpl` — anything quantitative: axes, scales, series, distributions, error bands,
  multi-panel comparisons.
- `html` — diagrams and structure: schematics, pipelines, free-form layout, rich inline
  math, annotated galleries, tables.

`figure_review` may return a `wrong_engine` verdict, on which the agent re-scaffolds under
the other engine. The choice is the model's; the trade-offs are in front of it.

**Exemplars are per engine.** `figure_review` returns the render plus exemplars of the bar.
A matplotlib chart reviewed against `exemplar-chart.png` — the four-bar div plot — would be
steered backwards. The mpl exemplar must be authored and **looked at**, not merely generated;
v2's spec records that the shipped exemplar had an unlabelled top gridline for weeks because
it was regenerated and never inspected.

## Error handling

Interpreter resolution, in order: `PAPERINO_PYTHON` → packaged `<userData>\python\python.exe`
(confirmed present at `ai.paperino.desktop\python\python.exe`) → `tools\pyoffice\.venv` →
`python` on `PATH`.

- Interpreter found, matplotlib missing → "Figure Studio's chart engine needs setup", not a
  traceback.
- `figure.py` raises → the Python traceback is returned verbatim, the way console output is
  today. The agent patches and re-renders.
- No interpreter at all → the mpl engine reports unavailable and the agent falls back to
  `html`, telling the user what it lost. It must never claim a chart is impossible.

matplotlib + numpy wheels (~50 MB) install into the same environment on first use, mirroring
the existing first-run component pattern in `main/paperino/setup.ts`.

## Testing

- **Engine parity** — the same `data.json` through both engines yields manifests of the same
  shape (texts, strokes, elements populated; viewport correct).
- **Provenance holds** — a number in a matplotlib label that is absent from `data.json` fails
  rule 8; the same number present in `data.json` passes.
- **`derived` inference** — tick labels emitted by matplotlib are marked derived; a data label
  at the same nesting depth is not.
- **Font allowlist** — a figure rendered under `venue: ieee` reports `TeXGyreTermes` and
  passes; forcing DejaVu Serif fails.
- **Venue widths** — `full` resolves to 7.16in for `ieee` and 5.5in for `neurips`; an absent
  `venue` reproduces today's 528px exactly.
- **Failure surfaces** — a `figure.py` with a deliberate `NameError` returns the traceback,
  not a generic render failure.
- **Vendor refresh** — bumping `paperino_mpl.py`'s version marker re-vendors it into an
  existing workspace.

## Locked decisions

1. Both engines converge on SVG-measured-in-Chromium. Any future engine must reach that
   point or it does not ship.
2. Rule 8 runs on every engine. No exemptions.
3. `svg.fonttype: "none"` and `pdf.fonttype: 42` are owned by the style module, never the
   author.
4. `paperino_mpl.py` is machine-owned and version-refreshed, like `tokens.css`.
5. The model chooses the engine. No auto-detection.
6. One type system across both engines, venue-derived.
