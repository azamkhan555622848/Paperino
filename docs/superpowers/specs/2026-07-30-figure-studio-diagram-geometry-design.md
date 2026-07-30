# Figure Studio v4: capability over conformity

**Status:** design approved 2026-07-30. Supersedes the diagram-drawing portions of
`2026-07-13-figure-studio-publication-grade-design.md` and extends
`2026-07-28-figure-studio-chart-engine-design.md`.

## The problem, stated precisely

Two schematics shipped into a paper — `method-overview-plate` (Fig. 2) and
`adaptive-allocation-vector` (Fig. 3) — with an arrow slicing through a text block, arrows
terminating in empty gutters, two unexplained 9px squares, a decorative hairline over a void,
and a solid/dashed legend for line marks the figure does not contain.

Both recorded `{"passed": true, "errors": []}`.

Thirteen rules cleared them because **all thirteen police ink, and none police geometry.**
`min-type-size`, `contrast`, `stroke-floor`, `palette`, `provenance`, `pseudo-math`,
`web-chrome`, `font-allowlist` — every one asks a question about a glyph or a stroke *in
isolation*. Nothing asks where it landed relative to anything else. `text-overlap` (rule 1) is
the sole exception and it compares text to text only, never stroke to text.

The authoring was not sloppy. Both figures use CSS grid, semantic ids, `arrow()` by selector,
and real KaTeX. Every defect traces to a primitive, not to a choice:

| Defect | Cause |
| --- | --- |
| Arrow crossing "Reconstruction-distortion profiles" | `arrow()` resolves two endpoints and knows nothing else. No obstacle set, no clearance test. `autoSides` chose bottom→top with `#distortion` between them; `bow: 0.18` displaces the arc ~28px inside a 214px-wide block. |
| Arrows starting in empty gutters | Anchors are the **layout box**. `.evidence` carries only `border-left`, so `rect.right` is an invisible edge — a 30px arc alone in a 30px gutter. |
| Two mystery squares (Fig. 3) | `.port` — literal 9×9 bordered `<i>` elements. Two edges had to enter one tall node; `arrow()` anchors only to whole-box edges. **The author drew fake UI to manufacture anchor targets.** |
| Hairline over a void | `<div class="empty">` — a bordered spacer forcing grid alignment. |
| 13px arrow stub | `arrow("#capture","#distortion")` across a row-gap: a 13px path with a 7px head. |
| Legend for absent marks | Nothing relates a legend swatch to a real mark. |
| Third, grey arrow | `tone` omitted falls back to `--border-strong`. A third semantic colour, silently. |

### The misdiagnosis to avoid

The tempting reading is that the model needed tighter guidance. It is wrong. The model had
total freedom — arbitrary HTML, CSS and SVG — and produced an arrow through a glyph. It writes
code blind: it cannot measure where anything lands, and `bow` is a scalar whose correct value
depends on a rect it cannot see. **Freedom was not the missing input; sight and reach were.**

More hard rules would have produced a smaller cage around the same blindness. The v4 answer is
the opposite shape: much more capability, much less enforcement, and a hard line drawn only
where a defect is a defect in every visual idiom that has ever existed.

## Goal

Figure Studio draws whatever a paper needs — diagram, plot, schematic, matrix, timeline,
gallery, anything the author asks for — with the model composing freely from primitives that
resolve geometry from real measurement, and with enforcement narrowed to objective defects that
carry an explicit, source-visible escape.

## Non-goals

- **A layout algorithm that places nodes.** No dagre, elk or graphviz. The model composes with
  CSS, which it is good at; the renderer solves what the model cannot see — routing, clearance,
  collision-aware placement. Automatic node placement would take authorial control *away*,
  which is the opposite of this spec.
- **A diagram DSL.** No declarative graph format that the model fills in. That is a mould.
- **TikZ.** Unchanged from v3: a TikZ figure is a PDF, not an SVG measured in Chromium, so
  provenance and every text rule go dark. Revisit only if PDF text-rect extraction is built.
- **Style rules dressed as correctness.** Colour counts, size counts, grid-rail counts and
  fill-ratio floors are explicitly rejected as lint rules. They belong in review, as questions.

## The line: correctness versus style

This is the spec's central decision, and every rule sits on one side of it.

**Absolute — no escape, ever.** These are not matters of taste and no creative intent requires
violating them:

- rule 8 `provenance` — a rendered number traces to `data.json`. Inventing a result is not
  creativity. CLAUDE.md: *do not weaken it to make a figure pass.*
- rule 3 `min-type-size` — the 7pt floor is a print guarantee. Below it, text cannot be read.
- rule 2 `overflow` — content outside the figure box is clipped at compile time.
- rule 13 `font-allowlist` — a silent fallback to a system face is a bug. (An author who
  *wants* an additional face declares it in `meta.yaml`; see below. That is not an escape from
  the rule, it is an input to it.)

**Style — escapable with declared intent.** These encode a house opinion that is right almost
always and wrong occasionally:

- rule 7 `palette` (≤5 distinct non-gray text colours) — a six-condition ablation legend is
  legitimate and currently fails.
- rule 12 `web-chrome` — border radius. Some architecture diagrams do use rounded blocks.
  Drop shadows stay absolute: no paper idiom needs one.
- the four new geometry rules below.

### The escape mechanism

One attribute, uniform across every escapable rule:

```html
<i class="port" data-intent="explicit connection point on a shared node"></i>
```

`data-intent="<reason>"` on the element or path exempts it from the style rule it would
otherwise trip. Three properties make this safe rather than a loophole:

1. **It is visible in the source.** A reader of `figure.html` sees the claim and its reason.
2. **It is reported.** `lint.json` gains an `exemptions` array listing every claimed intent with
   its selector and rule, so `figure_review` can see what was waived and question it.
3. **It cannot touch the absolute set.** `data-intent` on an element that trips rule 2, 3, 8 or
   13 is itself a lint error (`intent-not-permitted`). The hard line is enforced structurally,
   not by convention.

Declared intent is respected. Hoped-for intent fails. This is the same shape `data-derived`
already has for provenance.

## Architecture

The invariant is untouched: **everything converges on an SVG measured in Chromium.** The router
runs *in the page* at render time — `annot.js` already resolves geometry from
`getBoundingClientRect()` inside `figReady()`'s double-rAF. Routing therefore decides against
really-measured layout, and its paths land in the same SVG the manifest is built from. Lint sees
the geometry that was drawn, not the geometry that was intended. No second measurement path and
no second gate, which is what lets one lint and one review cover every engine.

The shift is in what the author says. Today the author supplies geometry-adjacent scalars
(`bow`) and the page draws them literally. In v4 the author supplies **intent** and the page
**solves** geometry:

| Author says | Page resolves |
| --- | --- |
| "from this node's right side, 30% down" | the exact anchor on the visible ink |
| "to that node" | a route clearing every other node and every text rect |
| "near this, avoiding everything" | a position that collides with nothing |
| "these three edges share a gutter" | three distinct lanes |

### Nodes become declared

A node is an element carrying `data-node`. The router needs an obstacle set and `empty-node`
needs to know what *claims* to be a node. `arrow()` collects `[data-node]` rects — minus its own
two endpoints — plus every text rect from the same walk the manifest uses.

### The primitive catalogue

```js
// Port = 'top' | 'right' | 'bottom' | 'left' | `${side}:${fraction}`
//   fraction ∈ [0,1] positions the anchor along that side; default 0.5.

arrow(from, to, {
  port, to: toPort,        // explicit anchors; omitted → autoSides as today
  route: 'auto' | 'straight' | 'ortho',   // default auto
  bow,                     // RETAINED: a feedback edge reads better as an arc
  tone, style, head,
})

edge(from, [...waypoints], to, opts)   // polyline; waypoints are selectors or [fx, fy]
fan(from, [...targets], opts)          // one source, many targets, lanes auto-assigned
place(sel, { near, side, gap, avoid })  // collision-aware absolute placement
label(sel, text, { place, leader })     // callout, optional leader line
dimension(a, b, { text, side })         // measured span with end ticks
brace(sel, opts)                        // unchanged
highlight(sel, opts)                    // unchanged
```

`place()` is the largest single unlock. "Put this near that and don't overlap anything" is how a
designer talks to a layout tool, and it is precisely the sentence a blind author cannot execute.

`bow` is retained deliberately. Removing it was considered and rejected: a curve is genuinely
correct sometimes, and deleting expressiveness to prevent misuse is the cage this spec exists to
avoid. What changes is that `bow` is no longer load-bearing for obstacle avoidance — the router
handles that — so its wrong value can no longer produce a crossing.

### Routing

Pure geometry, deterministic, no search:

1. **Straight.** Candidate segment port→port. Its corridor is the segment inflated by
   `stroke/2 + 2px` clearance. If it intersects no obstacle rect and no text rect, draw it.
2. **Orthogonal.** Three-segment Z through the mid-gutter — H-V-H or V-H-V per the port sides.
   Test both variants; take the clear one, or the shorter of two clear ones. Corners are
   mitred; rounded corners are web chrome.
3. **Detour.** Five segments around the blocking rect's nearest free side.
4. **Report.** If nothing clears, draw the variant with the fewest intersections and emit
   `edge-unroutable` naming the blocking selector.

Step 4 is a finding, not a throw. A throw leaves the model with no render to look at and no
information; a finding gives it a rendered figure plus the name of the thing in the way. The
same reasoning applies to a degenerate edge — port distance under 3× the arrowhead emits
`edge-degenerate` rather than aborting.

**Lanes.** Corridors are recorded in declaration order. A new corridor overlapping an existing
one within the same axis band shifts by `laneStep = stroke × 3`. Deterministic; no packing
search.

### Ink anchoring

The endpoint is the node's **visible** rect, not its layout box:

- a resolved border or a background distinct from the page on that side → the border box;
- otherwise → the union of the element's own text client rects.

This is what fixes the gutter-floating arrows, and it is why `.evidence`-style borderless nodes
stop behaving differently from bordered ones.

## Rules added

Four, all errors, all escapable via `data-intent`:

| Rule | Test | Legitimate escape it must permit |
| --- | --- | --- |
| 14 `stroke-over-text` | an overlay path's corridor intersects a text rect (KaTeX internals exempt, as in rules 1/3/8) | a strikethrough or "not this" cross-out |
| 15 `dangling-edge` | an endpoint > 3px from any node's visible boundary | a leader line pointing at a region, not a node |
| 16 `empty-node` | `[data-node]`, area > 100px², no text descendant | an unfilled slot, a blank grid cell, a chessboard square |
| 17 `orphan-legend` | a swatch's (stroke, dash, fill) triple matches no mark outside `[data-legend]` | a legend shared across a multi-panel set |

Each is a defect in every idiom — no composition requires an arrow crossing a glyph or an
endpoint attached to nothing — and each has a real exception, which is exactly why the escape
mechanism has to exist rather than the rules being softened to warnings.

## Rules relaxed

- **rule 7 `palette`** — gains `data-intent`. The ≤5 cap stays as the default because five
  colours is already generous, but a figure that needs six declares it.
- **rule 12 `web-chrome`** — radius gains `data-intent`; shadows do not.
- **rule 13 `font-allowlist`** — `meta.yaml` gains optional `fonts: [<family>, ...]`, appended
  to the venue-derived allowlist. A deliberate face becomes an input rather than a violation.

**Explicitly not added:** colour-budget-beyond-rule-7, type-scale counts, grid-rail counts,
dead-space floors. All four were drafted and rejected. Each would block legitimate work — a
radial layout has no rails, an asymmetric composition is not a defect — and each is a matter of
taste. They move to review as questions.

## Scaffold: a canvas, not a mould

`figure_scaffold` stops copying an archetype's `figure.html` as the default.

- It emits a **minimal canvas**: `tokens.css` linked, `lib/` imported, print width from the
  venue, an empty `#fig-root`.
- The tool response carries the **primitive catalogue** — what exists, what each is for, what
  the escape attribute means. Knowledge, not a form.
- Templates remain available as opt-in starting points via a new `from: <archetype>` argument,
  for an author who wants one.
- `archetype` stays in `meta.yaml` as advisory metadata: it selects the review rubric and the
  reference images. It no longer selects a mould.

The `mpl` engine's `figure.py` template stays as-is — a Python file needs imports and a `save()`
call to run at all, so its template is a runnable skeleton rather than a layout.

## Review: from conformity to purpose

The rubric already leads with `claim` and `caption`, which is the right axis. Two changes:

**The reference images are reframed.** They are currently introduced as *"exemplars of the
bar"*, and the code comment calls them "the bar the model steers toward". Steering toward a
fixed picture is a ceiling: it makes a figure similar to the exemplar rather than better than
it. They become **craft references** — how a paper figure is set: stroke weights, type density,
caption-adjacent scale — with the rubric stating explicitly that composition is not to be
imitated.

**Compositional questions are added**, as questions the model answers and acts on:

- Is there one dominant reading direction, and does the geometry state it?
- Does every edge leave and enter visible ink?
- Is each colour doing exactly one job? (Identity *and* flow on the same hue reads as neither.)
- Is any stroke present that carries no information?
- Are the claimed `data-intent` exemptions (listed in `lint.json`) each actually justified?

The last one closes the loop on the escape mechanism: a waiver is visible to the reviewer.

## Error handling

- A missing selector in any primitive throws, as today, surfacing via `__FIG_ERROR__`.
- Unroutable and degenerate edges render and report, per above.
- `intent-not-permitted` fires when `data-intent` is attached to an absolute-rule violation.
- `lint.json` gains `exemptions: [{rule, selector, reason}]`. `figure_review` still refuses to
  run while `passed` is false.

## Testing

- **Router geometry is extracted as pure functions** — `routePath(a, b, portA, portB, obstacles)`
  taking plain rects and returning a path string — so it is testable under bun with no browser.
  `test/route.test.ts` is the contract, the way `test/scale.test.ts` pins `niceDomain`: straight
  when clear, orthogonal when blocked, lane offsets on shared corridors, the detour case, and
  the unroutable report.
- **Lint rules 14–17** against synthetic manifests, each with a passing case, a failing case,
  and an escaped case.
- **`intent-not-permitted`** for each of rules 2, 3, 8, 13.
- **Exemplars re-authored and gated.** `author-exemplars.ts` already refuses to copy an exemplar
  that fails its own rules. The schematic exemplar is re-authored so it demonstrates ports,
  routing and ink anchoring rather than the habits being removed. Per CLAUDE.md: regenerate,
  then **look at the PNGs** — the unlabelled top gridline and the labelled log minors were both
  found by looking, not by a test.
- **Acceptance:** re-author `method-overview-plate` and `adaptive-allocation-vector` against v4
  and confirm rules 14–17 fire on the *current* sources before the rewrite. A rule that does not
  fail the figure that motivated it is not implemented.

## Locked decisions

1. **The measurement path does not change.** Any future primitive must resolve to an SVG
   measured in Chromium or it does not ship.
2. **Correctness rules have no escape.** Rules 2, 3, 8 and 13 are absolute; `data-intent`
   against them is itself an error.
3. **Style rules have exactly one escape mechanism,** `data-intent`, and every use is reported.
4. **No node-placement algorithm.** The model composes; the renderer solves what the model
   cannot see.
5. **`bow` is retained.** Expressiveness is not removed to prevent misuse.
6. **Unroutable is a finding, not a throw.** The model must always get a render to look at.
7. **Exemplars are craft references, not compositional targets.** The v2/v3 framing is
   deliberately retired.
8. **Style-as-law rules are rejected** — colour budgets beyond rule 7, size counts, rail counts,
   fill floors. They are review questions.
