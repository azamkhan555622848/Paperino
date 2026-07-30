/**
 * The html engine's whole surface, in the one place an author is guaranteed to read it:
 * figure_scaffold's response. A primitive that is not named here does not exist as far as
 * the model is concerned — and neither does an ATTRIBUTE. `data-legend` spent its entire
 * life in two internal files (the render-worker line that reads it and a type comment in
 * lint.ts), which made rule 17 unfireable in practice: orphan-legend can only check a
 * legend the author MARKED, and nothing ever told an author to mark one.
 *
 * Signatures are kept honest against `src/assets/lib/annot.js`. If you add a primitive or
 * an option there, add it here — `test/catalogue.test.ts` pins the export names and the
 * absolute-rule list, but it cannot check that an option string is accurate.
 */
export const PRIMITIVE_CATALOGUE = [
  "PRIMITIVES (lib/annot.js). You name intent; the page resolves geometry from measured layout.",
  "Call renderMath() first, the annotations next, figReady() last. Never type a coordinate.",
  "",
  "  arrow(from, to, {port, to, route, bow, tone, style, head, intent})",
  "     port/to: a side, or a fraction along it — 'right' or 'right:0.3'. Two edges into one",
  "     tall node at left:0.3 and left:0.7 need no helper elements. The route clears every",
  "     other [data-node] and every text rect automatically; you never compute a path.",
  "     bow is for an arc you actually want (a feedback edge), not for dodging.",
  "  edge(from, [waypoints], to, {port, to, tone, style, intent})",
  "     a polyline through waypoints you name: selectors, or [fx, fy] fractions of #fig-root.",
  "     Drawn EXACTLY as given — this is you overruling the router, clearance included.",
  "  fan(from, [targets], opts)      one source to many; ports distributed down the source side",
  "  place(sel, {near, gap})         absolute-position an element without overlapping anything",
  "  label(sel, text, {place, gap, leader, tone})   a callout, optionally with a leader line",
  "  dimension(a, b, {text, side, gap, tone})       a measured span with end ticks, IEEE style",
  "  brace(sel, {side, label, tone})",
  "  highlight(sel, {tone, style})",
  "",
  "THREE ATTRIBUTES ARE PART OF THIS API — the rules key off them, and an unmarked figure is",
  "an UNCHECKED figure, not a passing one:",
  "  data-node    on every box you will connect. What the primitives anchor to (on visible",
  "               ink, not the layout rect), what the router avoids, and what rule 15",
  "               (dangling-edge) requires at both ends of every path. A node with no text",
  "               is rule 16 (empty-node) — never draw an empty square to make an anchor.",
  "  data-legend  on the legend container. Rule 17 (orphan-legend) can only check a legend it",
  "               can find; unmarked, it will happily describe a mark the figure does not have.",
  '  data-intent="<reason>"  on an element or a path: the declared escape from a STYLE rule you',
  "               broke on purpose. Recorded in lint.json's `exemptions`, and figure_review is",
  "               asked whether the reason holds.",
  "",
  "data-intent can NEVER waive overflow, min-type-size, provenance or font-allowlist — two are",
  "honesty and two are physics. Declaring one of those is itself the error intent-not-permitted.",
].join("\n")
