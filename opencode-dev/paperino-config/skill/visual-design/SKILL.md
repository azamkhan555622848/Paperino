---
name: visual-design
description: >-
  Load this skill BEFORE authoring any figure, chart, table, diagram or visual — whether it goes
  into the paper (Figure Studio / LaTeX) or onto a screen (slides, README, explainer, HTML). It is
  the house design system — how to choose the form, how to assign colour, how to set type and
  marks, and what separates a publication-grade visual from a mediocre one. Triggers on "figure",
  "chart", "plot", "table", "diagram", "schematic", "visual", "graphic", "slide", "poster", or any
  request to draw, visualise or illustrate. Do NOT use it to decide which pipeline to run (that
  question is still asked of the user) — use it to decide what the picture should look like once
  the pipeline is chosen.
---

# Paperino rules — these override everything below

1. **Every number in a visual comes from `artifacts/`.** Route it through `data_query`; never
   retype it, never estimate it, never round it "for the label". Rule 8 (`provenance`) enforces
   this on **every archetype** — a fabricated "512 experts" in a schematic node fails exactly as a
   fabricated table cell does. Digits inside a *name* are exempt (`ResNet-50`, `GPT-2`, `conv3`);
   digits wearing a *unit* are not (`12ms`, `50%`, `3.2x` must trace).
   **PaperBanana's raster output is exempt from lint entirely** — nothing checks its numbers, so
   product rule 1 is on you there, with no backstop.
2. **Still ask which pipeline.** Figure Studio (vector, linted) vs PaperBanana (raster, exempt)
   is the user's choice, not yours. This skill tells you how to make the picture good; it does
   not license you to skip the question.
3. **Pick the mode before the first line of code.** Print mode and screen mode share craft and
   share nothing else. Mixing them produces a figure that fails lint or a slide that looks like
   a tax form.
4. **`artifacts/` is read-only.** Read numbers out; write pictures elsewhere.

---

# Choose the mode first

| Where does it land? | Mode | Tokens | Linted? |
|---|---|---|---|
| Inside the manuscript — `\includegraphics`, a LaTeX table, the compiled PDF | **print** | `figures-mcp/src/assets/tokens.css` | yes, 13 rules |
| Anywhere else — slides, poster, README, HTML explainer, chat, docs | **screen** | `reference/screen-tokens.css` | no |

If the user says "figure" and you are in a paper workspace, it is **print** unless they say
otherwise. When genuinely ambiguous, ask — the two are not convertible after the fact.

---

# The craft layer — both modes

This is the part that makes a visual good. It is mode-independent, and it is where almost all
the quality lives. A print figure and a Cowork-style diagram that both follow this section will
both be excellent; one that skips it will be ugly in whichever palette you chose.

## 1. Colour comes last

Most bad charts pick colour first. The order is:

1. **Pick the form.** Sometimes the right form is not a chart (see the table below).
2. **Assign colour by its job** — categorical, sequential, diverging, or status. Never cycled,
   never a rainbow.
3. **Apply the mark specs** — thin marks, surface gaps, recessive axes.
4. **Legend** for ≥2 series; **direct labels** for ≤4; a single series needs neither — the
   caption names it.
5. **Render and look at the PNG.** Label collisions, overflow, and crowding are visible in two
   seconds and invisible in code.

## 2. Sometimes it is not a chart

| The data is… | Use | Not |
|---|---|---|
| A single current value (+ maybe a trend) | value + delta, inline in prose | a one-bar bar chart |
| A handful of headline numbers | a small table | a grouped bar chart |
| A single ratio against a limit | a sentence, or a meter | a two-slice pie |
| More than ~7 classes that all matter | **a table** (or table + chart) | more colours |

Then, if a chart *is* right, the data's job picks the type:

| Job | Form | Colour job |
|---|---|---|
| Compare magnitude | bar / column; heatmap for a grid | sequential (one hue) |
| Trend over time | line; area for a single series | sequential, or 1 categorical |
| Tell distinct series apart | grouped/stacked bar, multi-line | categorical |
| **One series is the point, rest is context** | **emphasis — highlight one, grey the rest** | 1 hue + grey |
| Above/below a baseline; Δ to target | diverging bar, or line vs baseline | diverging |
| Part-to-whole | stacked bar (horizontal if names are long) | categorical |
| Before → after, per item | dumbbell | 1 hue, 2 shades |

**Sequential is the safe default.** Categorical has a cost: it buries the one point that
matters. If the story is "ours went up", that is *emphasis* — one hue plus grey — not
categorical. Never solve "too many series" with more hues; past 5 (print) or 8 (screen), fold
into "Other" or break into small multiples.

## 3. Colour encodes meaning, never sequence

- Group marks by **category** — everything of one type shares one colour. Not step 1 = blue,
  step 2 = red, step 3 = green.
- **Grey is a colour.** Use it for neutral, structural, and contextual elements — the baseline,
  the other methods, the start and end nodes. A figure that is grey plus one accent is almost
  always stronger than one using the whole palette.
- **Colour follows the entity, never its rank.** Re-sorting the bars must not repaint them.
- **Never rely on colour alone.** Pair every colour with a second cue — dash pattern for lines,
  marker shape for scatter, hatching for bars — and show both in the legend. Print figures are
  read in greyscale and by colourblind reviewers; this is not optional.

## 4. Complexity budget

- **Subtitles ≤ 5 words.** Detail goes in the caption or the body text, never in the box.
- **≤ 2 non-grey ramps** per diagram, plus grey for the structural and neutral elements. Grey +
  teal + coral is three ramps and is fine; six is not. If colour encodes meaning, add a one-line
  legend.
- **≤ 4 boxes** in a horizontal tier at full width. Five or more → shrink them, wrap to two
  rows, or split into an overview figure and a detail figure.
- **Every label lives inside a box or in the legend.** Text floating in space collides with
  things and is ambiguous. Arrow labels are usually unnecessary: if the arrow's meaning is not
  obvious from source + target, the box subtitle is the place for it.
- If you catch yourself writing "see the caption for detail", the figure must *actually* be
  sparse. Do not promise brevity and then front-load everything.

## 5. Marks

Screen figures first, with the print value after the slash. Print marks are thinner because the
figure is reduced on the page, and its stroke widths come from tokens, not from you.

- **Bars**: ≤24px / ≤18px thick, square at the baseline.
- **Lines**: 2px / `var(--stroke)` (1.6px = 1.2pt), round join and cap.
- **Markers**: ≥8px, filled, with a 2px background-coloured ring so overlapping points read.
- **Area fill**: the series hue at ~10% opacity.
- **Gridlines**: 1px, one step off the surface, recessive. **No vertical gridlines on a time
  axis.** *In print, prefer no gridlines at all* — a `var(--stroke-thin)` (1.07px = 0.8pt)
  baseline on the left and bottom is the whole axis. Nothing below 0.75px (`stroke-floor`), except
  a stroke of exactly 0, which is read as deliberately invisible and skipped.
- **Surface gap**: a 2px background-coloured gap between touching marks (stacked segments,
  adjacent bars). Never a stroke around a mark.
- **Text wears text colours, never the series colour.** Values, axis labels and legend text stay
  in primary/secondary/muted ink; a small coloured square beside the text carries identity.

## 6. Non-negotiables

- **One y-axis.** Never a dual-axis chart. Two scales → two charts, or index both to 100.
- **Sequential = one hue. Diverging = two hues + a neutral grey midpoint** (never a hue at the
  midpoint). No rainbow, ever.
- **Marks are positioned only through scales.** A hand-placed bar is a bug even when it looks
  right; the next data point will expose it.
- **Sentence case.** Never Title Case, never ALL CAPS — including axis labels and node text.
- **Check the text fits the box before you place it.** ~8px per character at 14px, ~7px at 12px.
  Text does not auto-wrap in SVG; every line break is an explicit `<tspan>`. If a subtitle needs
  wrapping, it is too long.

---

# Print mode

**Read `reference/print-mode.md` before authoring.** Summary of what binds:

- **Tokens only.** Every colour is a `var(--…)` from the vendored `tokens.css` (the figure links
  `../tokens.css`; the source of truth is `figures-mcp/src/assets/tokens.css`). A raw hex or
  `rgb()` **in `figure.html`** is a `no-raw-color` failure.
  Be honest about what that rule can see: it regexes `figure.html` and nothing else, so a hex
  hidden in a separate stylesheet would slip past *it*. Do not go looking for that door. Scaffold
  gives you no `style.css`, the templates put their style in `figure.html`'s inline `<style>`, and
  the computed-style rules (`contrast`, `palette`, `web-chrome`, `font-allowlist`) catch you
  anyway. Author the style where the templates do.
- **Two accents**, `--accent` (restrained blue) and `--accent-warm` (warm red), chosen to survive
  greyscale. The `palette` rule counts **distinct non-grey *text* colours** and caps them at 5 —
  it does not police fills or strokes, so restraint in the marks is on you, not the linter.
- **Square corners, no shadows, no cards-with-fills.** `border-radius > 3px` or any `box-shadow`
  is a `web-chrome` failure. A paper box is a hairline rule around white.
- **Computer Modern only.** The rule tests a `KaTeX_` prefix on the *first declared family*, so
  `KaTeX_Main`, `KaTeX_Typewriter` and KaTeX's own `KaTeX_Math` / `KaTeX_AMS` / `KaTeX_Size2` all
  pass. Any other leading family is a `font-allowlist` failure. Note the limit: it catches a
  **missing token** (you wrote `font-family: serif`, or forgot to inherit), not a font that failed
  to *load* — a declared-but-unloadable `KaTeX_Main` still passes while rendering in Georgia. If
  the PNG's glyphs look wrong, trust the PNG, not the green lint.
- **Math is real KaTeX in a `.math` span.** `sigma^2` typed as text is a `pseudo-math` failure —
  and monospace pseudo-math is what made the old figures look like a blog.
- **Print-true geometry.** Set it with `figure_scaffold`'s `width`: `full` = 528px (5.5in text
  width), `narrow` = 312px (3.25in column). That is the render viewport — **author to it.** Do not
  draw large and scale down: 12px = 9pt at Chromium's 96dpi PDF mapping, so a figure drawn at
  1000px and set to `\linewidth` renders its 9pt type at ~5pt, below the floor.
- **7pt floor** (`--fs-small`, 9.34px) on every glyph **except KaTeX internals** — LaTeX itself
  sets scripts at 7/5pt, so the rule exempts them. **4.5:1 contrast** minimum.
- **All 13 rules block.** `figure_review` refuses while any error stands; there is no "warning"
  tier. Fix them, don't triage them.

Run `figure_lint` before `figure_review`, and `figure_review` before you show the user anything.
Look at the PNG. The exemplars in the workspace are the bar.

## Tables in print

A table is a figure and gets the same care. The idiom is **booktabs**, and it is not decoration:

- **Three rules, no more**: `\toprule`, one `\midrule` under the header, `\bottomrule`. **No
  vertical rules, ever.** No rule between every row. Whitespace separates columns; ink does not.
- **Numbers right-aligned on the decimal** (`S` column via `siunitx`, or pad manually).
- **One significant-figure policy per column**, applied to every cell. `12.3` and `12.30` in the
  same column is a defect.
- **Units in the header, not in the cells** — `Latency (ms)`, then bare numbers.
- **Bold the winner, not the whole row.** ±std goes in a smaller size or parentheses, never bold.
- **The caption goes above** the table (and below a figure). State what the reader should
  conclude, not what the columns are named.
- Every cell traces to `data.json`. Rule 8 exempts data-sourced *string* cells (`"5C"`) and sees
  through thousands separators — it does not exempt a number you typed.

---

# Screen mode

**Read `reference/screen-mode.md` before authoring**, and use
`reference/screen-tokens.css`. This is the Cowork/CDS look, deliberately and completely: it is
what you want for slides, posters, READMEs, HTML explainers and anything a human reads on a
display rather than in a PDF column.

Headlines:

- **Flat.** No gradients, mesh, noise, glow, or decorative effects. Clean flat surfaces.
- **Tokens, not hex** — `var(--surface-1)`, `var(--text-secondary)`, `var(--border)`. A hardcoded
  `#333` is invisible in dark mode. Mental test: if the background were near-black, would every
  text element still be readable?
- **Type**: two weights only — 400 and 500. Never 600 or 700. h1 22px / h2 18px / h3 16px; body
  16px at 1.7 line-height. Nothing below 11px.
- **SVG**: `viewBox="0 0 680 H"` with `width="100%"` — the 680 is load-bearing, it makes SVG units
  render 1:1 with CSS pixels. Set `H` to the bottom-most element + 40px. Content stays inside
  x=40..640. Two font sizes only: 14px labels, 12px subtitles. Every `<text>` carries a class
  (`t`, `ts`, `th`); every connector `<path>` carries `fill="none"`.
- **Colour**: the 9 CDS ramps (`c-purple`, `c-teal`, `c-coral`, `c-pink`, `c-gray`, `c-blue`,
  `c-green`, `c-amber`, `c-red`) for categorical work; the 8-slot Tidepool palette for chart
  series, in fixed order, never cycled. Prefer purple/teal/coral/pink for generic categories —
  blue/green/amber/red carry semantic weight (info/success/warning/error), so reserve them.
  Text on a coloured fill uses a dark stop **of that same ramp** — never black, never grey. Title
  and subtitle in a box take *different* stops (light: 800 title / 600 subtitle; dark: 100 / 200),
  or the box reads flat. `screen-tokens.css` wires all of this; just apply `c-{ramp}` and the
  `t`/`ts`/`th` classes.
- **Charts** are Chart.js: canvas cannot resolve CSS variables, so hardcode the Tidepool hex.
  Disable the default legend and build a custom HTML one — small squares, tight spacing, the
  value in the label.
- Full ramp tables, mark specs, SVG scaffolds and the Chart.js recipe are in
  `reference/screen-mode.md`.

---

# The review loop — this is not optional

Neither mode is finished when it renders. The difference between a competent figure and a
stunning one is entirely in the loop:

1. `figure_render` → **open the PNG and look at it.** Not the code. The picture.
2. Ask the three questions:
   - **What is the one thing a reader should take away?** Is that thing the most visually
     salient element? If the takeaway is "ours is best" and "ours" is the fourth bar in the same
     blue as the others, the figure has failed regardless of how clean the code is.
   - **What can I delete?** Gridlines, tick marks, the legend for a single series, the box
     around the plot, the third decimal place, the redundant axis title, the arrow label that
     restates the arrow. Excellence here is subtractive.
   - **Would this survive greyscale and a 50% reduction?** Print figures get both.
3. `figure_lint` → fix every error. The rules encode failures that already happened.
4. `figure_review` → compare against the exemplars. Hard cap 4 rounds; if you are still fighting
   at round 3, the problem is the *form*, not the styling — go back to §2.

---

# Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Figure looks like a web dashboard | Screen tokens in a print figure | Switch modes; square the corners, drop the fills |
| Figure looks like a spreadsheet | No hierarchy — everything the same weight | Emphasis: one accent, everything else grey |
| Reviewer can't tell the series apart | Colour-only encoding | Add dash/hatch/marker cues |
| Type is tiny in the compiled PDF | Authored large, scaled down | Author at final size (528px / 312px) |
| Numbers don't match the text | Retyped from memory | `data_query`; never retype |
| Diagram is unreadable | Too many boxes, subtitles too long | Complexity budget: ≤4 per tier, ≤5 words |
| It renders but feels cheap | Skipped the loop | Look at the PNG. Delete something. |
