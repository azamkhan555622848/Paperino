# Figure Studio v2 — publication-grade figures

**Date:** 2026-07-13
**Status:** Approved — implementing
**Amends:** `2026-07-09-figure-studio-design.md`. That spec's architecture (5 tools, the
render→lint→review loop, annot.js, archetypes, provenance) is unchanged and stays the
record for it. This spec replaces its *aesthetic north star* and its §6 lint list.

## Problem

Figure Studio produces figures that look like SaaS dashboard cards, not paper figures.
The GQA-amplification figure that triggered this spec had good information design and
was still unsubmittable: monospace pseudo-math (`sigma_vec^2 lesssim (d/g) sigma_ch^2`),
rounded pastel "cards", pill badges, and a Segoe UI font fighting the Computer Modern
page around it. Embedded in the compiled PDF, the clash is glaring.

The agent did exactly what the system taught it. The original spec's stated purpose was
"Anthropic-quality figures (transformer-circuits style)" — but transformer-circuits is a
**web publication**. Every layer downstream encodes that:

| Layer | What it encodes |
|---|---|
| `tokens.css` | Segoe UI, `border-radius: 8px` cards, pastel `--accent-soft` fills |
| `.mono` | monospace as the only way to write symbols — the pseudo-math source |
| math rendering | none exists anywhere in the pipeline |
| review exemplars | two transformer-circuits *blog* screenshots — the vision loop steers toward web-look |
| sizing | 550/1100 **px**, then scaled arbitrarily by `\includegraphics` — font sizes are accidental |

Per the product's guiding constraint, the fix is structural (tokens, lint, exemplars),
not "ask the model nicely".

## Decisions (locked)

1. **Publication style replaces the blog look outright.** One style; no theme system.
   The blog look proved the pipeline and has no place inside a paper.
2. **One Computer-Modern-family style (v1).** Figure text matches the
   Tectonic-compiled body (realized as the KaTeX dist's CM-derived faces, §1). Covers
   NeurIPS/ICML/ICLR/ACL/IEEE/ACM, where the figure sits inline in the LaTeX page.
   A venue-aware font token (Nature wants Helvetica labels) is deferred until an actual
   Nature-family submission exists.
3. **Approach B — full retrofit, keeping the loop.** The browser still computes every
   coordinate and the agent still types none; what changes is what the loop optimizes
   toward. (Approach A "restyle only" left pseudo-math alive; approach C "emit TikZ"
   resurrects coordinate-blindness, the failure mode this subsystem exists to kill.)

## 1 · Design tokens v2 (`src/assets/tokens.css`)

- **Fonts:** the vendored KaTeX dist's `KaTeX_Main` (regular/bold/italic/bold-italic)
  and `KaTeX_Typewriter` woff2 faces (SIL OFL) via `@font-face` in tokens.css. These
  are Computer Modern-derived — they match the Tectonic-compiled body *more* literally
  than Latin Modern, and they keep a single pinned font source (the `katex` npm
  package) instead of a second supply chain. Served by the existing loopback HTTP
  server — no CDN, offline-safe. Committed as assets: pinned design inputs, not
  regenerable build output.
- **Ink:** near-black text (`#111`), two gray border weights, **two** accents — a
  restrained blue and a warm red, chosen to remain distinguishable in grayscale — and
  one optional light-gray fill. The pastel `--accent-soft` era ends.
- **Type scale in pt:** body 9pt, label 8pt, small 7pt (12 / 10.7 / 9.3 px at the 96dpi
  mapping in §3).
- **Strokes:** 0.8pt hairline, 1.2pt emphasis.
- **Classes:** `.card` becomes a square-cornered hairline box — no fill, no radius, no
  shadow. New `.panel-label` supplies the **(a) (b) (c)** idiom. `.mono` survives only
  for genuine code, in LM Mono. New `.math` marks KaTeX spans (§2).
- Version header line (`/* paperino-tokens v2 */`) — read by scaffold for migration (§7).

## 2 · Real math — KaTeX, vendored

- KaTeX dist (MIT), trimmed to woff2 fonts (~400KB), at `src/assets/lib/katex/`;
  vendored into workspaces with the rest of `lib/`.
- New `lib/math.js`: `renderMath()` auto-renders every `.math` span. `figReady()` now
  awaits `document.fonts.ready` **and** `renderMath()` before signalling
  `__FIG_READY__`, so bboxes and PDFs always see final glyphs.
- Templates demonstrate the idiom:
  `<span class="math">\sigma^2_{\mathrm{ch}} \lesssim (d/g)\,\sigma^2_{\mathrm{vec}}</span>`.
- KaTeX's fonts are Computer Modern-derived, so math and Latin Modern text sit together
  exactly as in the compiled paper.

## 3 · Print-true sizing

- `narrow` = **312px → 3.25in** (two-column width); `full` = **528px → 5.5in**
  (NeurIPS/ICML text width). Chromium's PDF export maps 96px = 1in (verified against
  `render-worker.mjs`, which already sizes the PDF page from the viewport px width), so
  the emitted PDF is physically that size and `\includegraphics[width=\linewidth]`
  includes it at ~1:1 — a 9pt label is 9pt on the page by construction.
- Review PNG renders at `deviceScaleFactor: 3` so the vision loop sees crisp glyphs;
  the PDF stays vector. Manifest rects stay in CSS px (unchanged coordinate space).
- Lint rule 3 changes from "≥9px" to "**≥7pt effective**" (9.33px) — now a print
  guarantee, not an arbitrary screen number. **KaTeX-internal text is exempt**: LaTeX
  itself sets scripts at 7/5pt in a 10pt body, so a blanket floor would fail every
  superscript; formula-internal sizing is KaTeX's business. For the same reason,
  rule 1 (text-overlap) skips pairs where **both** boxes are inside KaTeX output —
  KaTeX absolutely positions glyph boxes, and pairwise overlap over them is a
  false-positive storm. Formula-vs-outside checks remain.

## 4 · Lint rules 11–13 + manifest extension

`render-worker.mjs` additionally records computed `border-radius`, `box-shadow`, and
`font-family` per element. Three new deterministic rules, same
`{rule, selector, actual, expected}` contract:

11. **pseudo-math** — a text node *outside* a `.katex` container matching `_`/`^`
    patterns or spelled-out symbol names (`sigma`, `Delta`, `lesssim`, `sqrt`,
    `O(...)`) → fail. The structural kill for the monospace-formula disease.
12. **web-chrome** — computed border-radius > 3px or any box-shadow → fail. (The
    radius threshold also catches pill badges, whose radius is half their height.)
13. **font-allowlist** — computed font-family whose first resolved face is not a
    `KaTeX_*` face → fail (`KaTeX_Typewriter` serves `.mono`). Catches silent
    fallback to Segoe UI or the system serif.

## 5 · Templates rewritten in paper idiom

All four archetypes: **no in-figure headline** — the claim lives in the caption;
explanatory prose inside the figure is blog idiom. Panel labels (a)/(b), hairline
boxes, `.math` spans wherever symbols appear, chart axes at 8pt labels / 7pt ticks.

## 6 · Exemplars, rubric, acceptance

- The two blog screenshots are replaced by **two exemplars authored with the new system
  itself** (a schematic + a two-panel results chart) — dogfooding doubles as the
  acceptance test and avoids shipping copyrighted paper screenshots.
- Rubric reworded: *"Would a reviewer notice this was not TikZ/pgfplots? No pseudo-math,
  no web chrome, minimal in-figure prose, readable at 50%, survives grayscale."*
  (Claim/salience/double-encoding checks stay.)
- **Acceptance gate:** rebuild the GQA-amplification figure in the new idiom — same
  information design, publication clothes — lint-clean, `\includegraphics`-ed into
  `fixtures/demo-paper`, compiling, and visually native beside Computer Modern text.

## 7 · Asset migration + AGENTS.md

- `figure_scaffold` **auto-refreshes** vendored `tokens.css` + `lib/` when the version
  header differs from the server's. These are machine-owned assets, like
  `references.bib` — existing figures get upgraded deliberately, not left to drift.
  (Today scaffold vendors only-if-absent, which would strand old workspaces on v1.)
- AGENTS.md's Figure Studio section teaches the new idiom: math goes in `.math` spans,
  captions carry the prose, panels get letters, the figure never repeats the caption.

## 8 · Testing

- One fixture per new rule (11/12/13), each violating exactly that rule; the clean
  fixture updated to pass all 13.
- Rule-3 fixture re-expressed in pt.
- Template render smokes updated for the new templates (still: non-empty `bboxes.json`,
  non-trivial PNG, PDF starts `%PDF-`).
- Provenance tests untouched.
- Acceptance per §6.

## Out of scope (deliberate)

- Venue-aware font themes (Nature/Helvetica) — deferred until a Nature submission.
- Cross-figure registry / consistency lint — still v2 of the original spec.
- PaperBanana — unchanged; still the raster alternative, still lint-exempt.
