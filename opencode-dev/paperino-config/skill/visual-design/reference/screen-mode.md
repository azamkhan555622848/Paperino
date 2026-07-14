# Screen mode — the full design system

For slides, posters, READMEs, HTML explainers, docs — anything read on a display.
**Never for a figure that lands in the manuscript.** Use `screen-tokens.css`.

---

## Philosophy

- **Flat.** No gradients, mesh backgrounds, noise textures, drop shadows, blur, glow, or neon.
  Clean flat surfaces.
- **Compact.** Show the essential in the visual. Explain the rest in the surrounding text.
- **Text belongs outside the visual.** No paragraphs, no section headings, no descriptive prose
  inside the SVG or HTML. The visual carries the visual; the prose carries the prose.
- **Restraint over options.** "Too cluttered" is the most common design note. Default to the
  quieter, lighter choice.

---

## Tokens

Reference CSS custom properties, never raw hex. All of them auto-adapt to light and dark mode.

| Property | Tokens |
|---|---|
| Background | `--surface-0` (page) · `--surface-1` (card) · `--surface-2` (panel) · `--surface-3` (popover) · `--bg-{accent,danger,success,warning}` |
| Text | `--text-primary` · `--text-secondary` · `--text-muted` · `--text-disabled` · `--text-{accent,danger,success,warning}` |
| Border | `--border` (hairline) · `--border-strong` · `--border-stronger` · `--border-{role}` |
| Type | `--font-sans` · `--font-mono` · `--font-voice` (serif) |
| Layout | `--radius` (8px) · `--pad-{sm,md,lg,xl}` · `--gap-{xs,sm,md,lg,xl}` |

**Muted-text rule**: supporting copy is `--text-secondary`; reserve `--text-muted` for
placeholders, captions and metadata. **Never use `opacity` on text** — it multiplies against
the background and drifts per surface.

**Dark mode is mandatory.** Every colour must work in both. A hardcoded `color: #333` is
invisible on dark. Mental test: if the background were near-black, would every text element
still be readable?

---

## Typography

- Default font is the sans (`--font-sans`). `--font-voice` (serif) is for the rare editorial or
  hero-number moment only.
- **Two weights: 400 and 500. Never 600 or 700.** They read heavy against the host UI.
- h1 = 22px · h2 = 18px · h3 = 16px, all weight 500. Body = 16px, weight 400, line-height 1.7.
- **Nothing below 11px.**
- **Sentence case everywhere** — including SVG text labels and diagram headings. Never Title
  Case, never ALL CAPS.
- **No mid-sentence bolding.** Entity names, class names and function names go in `code style`,
  not bold. Bold is for headings and labels.
- Text on a coloured background takes the darkest shade **from that same colour family** — never
  plain black, never a generic grey.

---

## Colour — the 9 ramps

7 stops each. 50 = lightest fill · 100–200 = light fills · 400 = mid · 600 = strong/border ·
800–900 = text on light fills.

| Class | 50 | 100 | 200 | 400 | 600 | 800 | 900 |
|---|---|---|---|---|---|---|---|
| `c-purple` | #EEEDFE | #CECBF6 | #AFA9EC | #7F77DD | #534AB7 | #3C3489 | #26215C |
| `c-teal` | #E1F5EE | #9FE1CB | #5DCAA5 | #1D9E75 | #0F6E56 | #085041 | #04342C |
| `c-coral` | #FAECE7 | #F5C4B3 | #F0997B | #D85A30 | #993C1D | #712B13 | #4A1B0C |
| `c-pink` | #FBEAF0 | #F4C0D1 | #ED93B1 | #D4537E | #993556 | #72243E | #4B1528 |
| `c-gray` | #F1EFE8 | #D3D1C7 | #B4B2A9 | #888780 | #5F5E5A | #444441 | #2C2C2A |
| `c-blue` | #E6F1FB | #B5D4F4 | #85B7EB | #378ADD | #185FA5 | #0C447C | #042C53 |
| `c-green` | #EAF3DE | #C0DD97 | #97C459 | #639922 | #3B6D11 | #27500A | #173404 |
| `c-amber` | #FAEEDA | #FAC775 | #EF9F27 | #BA7517 | #854F0B | #633806 | #412402 |
| `c-red` | #FCEBEB | #F7C1C1 | #F09595 | #E24B4A | #A32D2D | #791F1F | #501313 |

**Assignment:**

- Group by **category**, not sequence. All immune cells purple, all pathogens coral, all
  outcomes teal — not step 1 blue, step 2 amber, step 3 red.
- **Grey for neutral/structural** nodes (start, end, generic steps).
- **2–3 colours per diagram**, not 6+. Grey + purple + teal beats using every ramp.
- **Prefer purple, teal, coral, pink** for generic categories. Blue, green, amber and red carry
  strong semantic connotations (info / success / warning / error) — reserve them for nodes that
  genuinely mean those things. Exception: illustrative diagrams may use them freely when they
  map to physical properties (warm ramps for heat, cool for cold, green for organic).

**Stops to use:**

- Light mode: **50 fill + 600 stroke + 800 title / 600 subtitle**
- Dark mode: **800 fill + 200 stroke + 100 title / 200 subtitle**
- **Title and subtitle in the same box must be different stops.** Same stop for both reads flat —
  the weight difference alone is not enough.
- Never an off-table hex.

Apply `c-{ramp}` to a `<g>` wrapping shape + text, or directly to a `<rect>` / `<circle>` /
`<ellipse>`. **Never to a `<path>`** — paths don't take ramp fill; use an inline `stroke="#…"`
for coloured connectors.

**`c-*` nesting trap:** these classes use direct-child selectors. Nest a `<g>` inside a
`<g class="c-blue">` and the inner shapes become grandchildren — they lose the fill and render
**black**. Put `c-*` on the innermost group holding the shapes.

---

## Chart series — the Tidepool palette

Fixed order. **Never cycled.** The 9th series is never a generated hue: it folds into "Other",
or you switch to small multiples.

| Slot | Hue | Light | Dark |
|---|---|---|---|
| 1 | blue | #2a78d6 | #3987e5 |
| 2 | aqua | #1baf7a | #199e70 |
| 3 | yellow | #eda100 | #c98500 |
| 4 | green | #008300 | #008300 |
| 5 | violet | #4a3aa7 | #9085e9 |
| 6 | red | #e34948 | #e66767 |
| 7 | magenta | #e87ba4 | #d55181 |
| 8 | orange | #eb6834 | #d95926 |

- **Sequential** (magnitude — heatmap, choropleth): one hue, light → dark. Default blue.
- **Diverging** (polarity — delta, above/below): blue ↔ red with a **neutral grey midpoint**
  (light `#f0efec`, dark `#383835`). Never a hue at the midpoint.
- **Status** (good / warning / serious / critical): `#0ca30c` `#fab219` `#ec835a` `#d03b3b`.
  Reserved — never "series 4". Always paired with an icon and a label, never colour alone.

**Chart chrome:**

| Role | Light | Dark |
|---|---|---|
| Surface | #fcfcfb | #1a1a19 |
| Primary ink (values, title) | #0b0b0b | #ffffff |
| Secondary ink (legend) | #52514e | #c3c2b7 |
| Muted (axis ticks) | #898781 | #898781 |
| Gridline | #e1e0d9 | #2c2c2a |
| Baseline / axis line | #c3c2b7 | #383835 |

---

## SVG scaffold

```
<svg width="100%" viewBox="0 0 680 H" role="img">
  <title>…</title>
  <desc>…</desc>
  <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>
  …
</svg>
```

- **The 680 is load-bearing.** It matches the container width so SVG units render 1:1 with CSS
  pixels. `viewBox="0 0 476 H"` in a 680px container scales *everything* by 1.43×, so your 14px
  text renders at 20px. If the content is naturally narrow, keep 680 and **centre the content** —
  do not shrink the viewBox to hug it.
- **Height:** after layout, find the bottom-most point of any shape (including text baselines +
  4px descent) and set `H` = that + 20..40. Don't guess; don't leave dead space.
- Safe area x=40..640, y=40..(H−40). **No negative coordinates.** Background transparent.
- The arrow marker uses `context-stroke`, so the head inherits the line's colour automatically —
  a grey line gets a grey head, never a mismatch. Add nothing else to `<defs>` except a
  `<clipPath>`, a subtle `<pattern>` (secondary encoding for categorical data), or — in an
  illustrative diagram only — a single `<linearGradient>`. **No filters.**
- **Every `<connector> path` needs `fill="none"`.** SVG defaults to `fill: black`; a curved
  connector without it renders as a huge black blob.
- **Every `<text>` needs a class**: `t` (14px primary) · `ts` (12px secondary) · `th` (14px
  medium). Two sizes only — 14px for labels, 12px for subtitles and arrow labels. An unclassed
  `<text>` is the tell that you forgot.
- **Strokes 0.5px** for borders and edges. Thin reads refined.
- **`rx="4"`** for subtle corners; `rx="8"` max. `rx` ≥ half the height is a pill — deliberate
  only.
- **No rotated text.** No emoji. No comments (they waste tokens and break streaming).

**Overlap check before finalising.** For every pair of elements not meant to layer
(label-on-label, label-on-arrow, box-on-box), verify the bounding boxes don't intersect. The only
legal overlaps are deliberate: a label centred in its own box, an arrowhead touching its target,
a highlight rect behind the thing it highlights. In a row of boxes, the left box's `x + width`
must be at least 20px less than the right box's `x`. Four 160px boxes plus three 20px gaps = 640px
— that is the whole safe area, so shrink or cut, never let them collide. **A diagram with crossed
labels reads as broken regardless of how good the content is.**

**Text width**, Anthropic Sans, measured:

| Text | Chars | Weight | Size | Width |
|---|---|---|---|---|
| Authentication Service | 22 | 500 | 14px | 167px |
| Background Job Processor | 24 | 500 | 14px | 201px |
| Detects and validates incoming tokens | 37 | 400 | 14px | 279px |
| forwards request to | 19 | 400 | 12px | 123px |

Before placing text in a box: does (text width + 2 × padding) fit? "Glucose (C₆H₁₂O₆)" at 14px is
~180px; add 2 × 24px padding = 228px minimum box width. Subscripts still take horizontal space.

**Schematic containers are dashed rects with a label** — not literal drawn shapes. A dashed rect
labelled "Reactor vessel" reads cleaner than an ellipse that clips its content.

**Lines stop at component edges.** Draw a connector as segments that terminate at the boundary;
never draw through and hide the overshoot with a fill. The background colour is not guaranteed.

---

## Charts — Chart.js

```html
<div style="position: relative; width: 100%; height: 300px;">
  <canvas id="c1" role="img" aria-label="Bar chart of accuracy by method">Accuracy: A 12, B 19, C 8.</canvas>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
<script>
  new Chart(document.getElementById('c1'), {
    type: 'bar',
    data: { labels: ['A','B','C'], datasets: [{ label: 'Accuracy', data: [12,19,8], backgroundColor: '#2a78d6' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });
</script>
```

- **Canvas cannot resolve CSS variables.** Hardcode the Tidepool hex.
- **Height on the wrapper div only, never on the `<canvas>`.** Wrapper gets
  `position: relative`; Chart.js gets `responsive: true, maintainAspectRatio: false`. Setting CSS
  height on the canvas produces wrong dimensions, worst on horizontal bars.
- Horizontal bars: wrapper height ≥ `(bars × 40) + 80` px.
- **Disable the default legend and build a custom HTML one** — small squares, tight spacing, the
  value in the label. Position it above or below the canvas, never inside.
- Bubble/scatter: radii extend past their centres and clip at the axes. Pad `scales.{x,y}.min/max`
  ~10% beyond the data range.
- ≤12 categories that must all be visible: `scales.x.ticks: { autoSkip: false, maxRotation: 45 }` —
  Chart.js silently drops overlapping labels, and missing labels make bars unidentifiable.
- Negative currency is `-$5M`, not `$-5M`. Sign before the symbol.
- Every `<canvas>` needs `role="img"`, a descriptive `aria-label`, and fallback text between the
  tags — without them the chart is invisible to screen readers.

---

## Hero numbers

One figure, `--font-voice` (serif), ≥48px, tabular lining numerals. Everything else stays sans
with tabular figures. At most one per view.
