# Print mode — figures that land in the manuscript

Authored through **Figure Studio** (`figures-mcp`): HTML for structure, CSS custom properties for
style, `data.json` for every number, one SVG overlay for arrows and braces.

**All 13 lint rules block.** There is no severity tier — `figure_review` refuses to run while any
error stands. Three of them (`pseudo-math`, `web-chrome`, `font-allowlist`) were added in v2
specifically to stop the figure from looking like a web page.

Inside the figure's own directory `figure_scaffold` writes three files — **`figure.html`,
`data.json`, `meta.yaml`** — and nothing else. (It also vendors `figures/tokens.css` and
`figures/lib/` at the workspace level, and adds `figures/*/build/` to `.gitignore`; those are
shared, not yours to edit.)

**There is no `style.css`, and you should not create one.** The style lives in `figure.html`'s
inline `<style>`, exactly as the templates do it. Tokens come from the vendored `../tokens.css`;
the source of truth is `figures-mcp/src/assets/tokens.css` (`/* paperino-tokens v2 */`). Reference
the vars; never write a hex.

---

## Geometry — author at final size

| `figure_scaffold` `width:` | Viewport | Target |
|---|---|---|
| `full` | **528px** | 5.5in — full text width |
| `narrow` | **312px** | 3.25in — single column |

That enum is the whole mechanism: `width` lands in `meta.yaml`, and `render.ts` sets the Chromium
viewport from it. You do not set a page width in CSS — you *author to the viewport you asked for*.

12px = 9pt at Chromium's 96dpi PDF mapping, so `\includegraphics[width=\linewidth]` lands ~1:1.

**Never draw large and scale down.** A figure authored at 1000px and scaled to `\linewidth`
shrinks its 9pt type to ~5pt — below the 7pt floor, and the single most common reason a figure
gets kicked back by a copy editor. Author at 528 or 312 and every glyph in the PDF is the size
you set.

---

## Type

| Token | px | pt | Use |
|---|---|---|---|
| `--fs-body` | 12px | 9pt | body, node labels |
| `--fs-label` | 10.67px | 8pt | axis labels, captions in-figure |
| `--fs-small` | 9.34px | **7pt — the floor** | ticks, footnotes |

- Faces are `KaTeX_Main` and `KaTeX_Typewriter` — Computer-Modern-derived, matching the
  manuscript's body text. The rule tests a **`KaTeX_` prefix on the first declared family**, so
  KaTeX's own `KaTeX_Math`, `KaTeX_AMS` and `KaTeX_Size2` pass too — your formulas are safe. Any
  other leading family is a **`font-allowlist` failure**.
- **What the rule cannot see:** it reads the *declared* stack, not the rendered glyphs. A
  `KaTeX_Main` that is declared but fails to load passes lint while the text renders in Georgia.
  So a green `font-allowlist` means "you referenced the token", not "the type is right". **Look at
  the PNG.** Computer Modern is unmistakable; if the figure's text looks like a web page, it is
  one, whatever lint says.
- `.mono` (`KaTeX_Typewriter`) is for **real code only**. It is not a way to write a symbol.
- **Math is real KaTeX in a `.math` span**, rendered by `lib/math.js`. Typing `sigma^2` or `x_i`
  as plain text is a `pseudo-math` hard failure. Monospace pseudo-math is exactly what made the
  v1 figures read as a blog rather than a paper.
- KaTeX internals are exempt from the 7pt floor and from intra-formula overlap — LaTeX itself
  sets scripts at 7/5pt, and KaTeX absolutely positions glyph boxes.

---

## Colour

```
--bg            #ffffff   the page
--surface       #f5f5f5   the only fill — use sparingly
--border        #999999
--border-strong #333333
--text          #111111
--text-muted    #555555
--accent        #1a4f9c   restrained blue
--accent-warm   #b03a2e   warm red
```

- **Two accents.** They were picked to stay distinguishable in greyscale. You should rarely need
  a third.
- **Know what `palette` actually checks:** it counts **distinct non-grey *text* colours** and caps
  them at 5. It does not look at fills or strokes at all — a chart with ten coloured bars lints
  clean. The rule is a backstop against rainbow *labels*, not a guarantee of restraint in the
  marks. That part is your judgement, and §3 of the skill is how you exercise it.
- A raw hex or `rgb()` in `figure.html` is a **`no-raw-color`** failure. The rule regexes that file
  and only that file — which means a hex parked in some other stylesheet would evade *this* rule.
  It would not evade `contrast`, `palette`, `web-chrome` or `font-allowlist`, all of which read the
  computed style. Don't go hunting for the gap; there is no legitimate figure that needs it.
- **Contrast ≥ 4.5:1** on every text element.
- The strongest paper figures are **black, white, grey, and one accent**. Reach for
  `--accent-warm` only when a second category genuinely exists.

---

## Chrome — there isn't any

- **`border-radius` > 3px is a `web-chrome` failure. Any `box-shadow` is a `web-chrome` failure.**
- A paper box is a **hairline rule around white**: `border: var(--stroke-thin) solid
  var(--border-strong); border-radius: 0;` and no fill. That is what `.card` is.
- No pastel fills, no elevation, no pills, no badges. If it would look at home in a dashboard, it
  does not belong in the manuscript.
- Strokes: `--stroke` (1.6px / 1.2pt) for emphasis, `--stroke-thin` (1.07px / 0.8pt) for
  hairlines. Nothing below 0.75px (`stroke-floor`).

---

## Numbers

Every number is reachable in `data.json`. Get it there with `data_query` (read-only jq over
`artifacts/`).

**Rule 8 (`provenance`) runs on every archetype** — `schematic` and `gallery` as well as `chart`
and `table`. A fabricated "512 experts" in a schematic node label reaches the paper exactly as a
fabricated table cell does, so a schematic's numbers must be in `data.json` too.

It exempts five things:

1. **String cells copied verbatim** from `data.json` (a step label like `"5C"`).
2. **Thousands separators** — `14,617` is normalised to `14617` before matching.
3. **Digits inside KaTeX** — the 2 in σ² is an exponent, not a cell.
4. **Digits that belong to a name** — the 50 in `ResNet-50`, the 2 in `GPT-2`, the 3 in `conv3`,
   the 5 in `Top-5 error`. The tell is a letter *before* the digits. A letter *after* them is a
   unit, not a name: **`12ms`, `50%` and `3.2x` are values and must trace.** That asymmetry is
   deliberate — a number wearing a unit is precisely what this rule exists to catch.
5. **Anything marked `[data-derived]`** — the `derived()` helper in `lib/scale.js`, which the chart
   template uses for every tick label. It exists because a computed axis tick (`0, 25, 50, 75`) is
   legitimately not a value in `data.json`.

**Exemption 5 is a loaded gun.** It is the one place where a number you typed can pass the rule
that exists to stop you typing numbers. Use `derived()` for what it is for — ticks, axis bounds,
values the scale computed — and never to silence a `provenance` error on a figure's actual claim.
If lint flags a number, the fix is to put it in `data.json`, not to wrap it in `derived()`.

Marks are positioned **only through scales** (`lib/scale.js`). A hand-placed bar is a defect even
when it happens to look correct.

Do not weaken any of this to make a figure pass. This rule is the point of the whole subsystem.

---

## Charts in print

- **No gridlines** by default. A hairline baseline on the left and bottom is the whole axis
  idiom.
- Tick labels at `--fs-small`, `--text-muted`. Axis titles at `--fs-label`.
- Bars ≤18px thick, square at the baseline, `--accent` fill. Grey (`--border`) for context
  series; `--accent` for the one that carries the claim. **Emphasis, not categorical.**
- Direct-label ≤4 series at the end of the line; a legend only past that.
- No dual axes. No pies. No 3D. No drop shadows on marks.
- Pair every colour with a second cue — dash pattern, marker shape, hatching — because the figure
  will be printed in greyscale.

---

## Tables in print

The `table` archetype, or a LaTeX `tabular`. Either way the idiom is **booktabs**:

- **Three rules total**: `\toprule`, one `\midrule` under the header, `\bottomrule`.
  **No vertical rules, ever. No rule between rows.** Whitespace separates columns; ink does not.
  A grid of boxes is a spreadsheet, not a table.
- **Right-align numbers on the decimal** — `siunitx`'s `S` column, or pad manually.
- **One significant-figure policy per column**, applied to every cell. `12.3` next to `12.30` in
  the same column is a defect.
- **Units in the header, not the cells**: `Latency (ms)`, then bare numbers.
- **Bold the winning cell, not the row.** Standard deviations go in parentheses or a smaller size
  — never bold, never the same weight as the mean.
- **Caption above** the table (below a figure). Say what the reader should conclude, not what the
  columns are called.
- If the table is a grid of magnitudes, consider a **heatmap** instead — sequential, one hue.
- Every cell traces to `data.json`.

---

## The workflow

```
figure_scaffold   →  archetype (schematic | gallery | chart | table), a required claim,
                     width (full=528px | narrow=312px).
                     Writes figure.html, data.json, meta.yaml. Nothing else.
data_query        →  pull the numbers out of artifacts/ into data.json
   … author figure.html — markup AND its inline <style> …
figure_render     →  build/<name>.png + .pdf + bboxes.json   ← LOOK AT THE PNG
figure_lint       →  13 rules, all blocking; fix every error
figure_review     →  render + 2 exemplars + rubric; refuses while any lint error stands;
                     hard cap 4 rounds
```

`figure_scaffold` auto-refreshes vendored `tokens.css` and `lib/` when the version marker
differs — an existing workspace is never stranded on an old design system.

**The exemplars are the bar.** They are self-authored (`bun test/author-exemplars.ts`) and they
are what the vision review steers every figure toward. Open them. If your figure would look out
of place beside them, it is not done.

**If you are still fighting at review round 3, the problem is the form, not the styling.** Go back
and re-pick the chart type.
