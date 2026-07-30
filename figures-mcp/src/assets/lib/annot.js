// paperino-annot v4.0
// Declarative annotations anchored to element IDs. One absolutely-positioned SVG overlay;
// geometry resolved at render time from getBoundingClientRect().
//
// v4: the author names PORTS and the router solves the ROUTE. Previously an arrow resolved
// two endpoints and knew nothing else, so `bow` was the only control over its path — and
// its correct value depends on a rect the authoring model cannot see. That is how an arrow
// came to cross the words "Reconstruction-distortion profiles" in a shipped paper.
//
// Colors/strokes are applied through inline STYLE, not presentation attributes:
// SVG attributes do not resolve CSS var(), only CSS declarations do.
//
// route.js is GENERATED from src/route.ts (scripts/build-lib.ts), so this file and
// test/route.test.ts exercise one implementation of the geometry rather than two.
import { anchorAt, parsePort, pathData, pickPlacement, routePath } from "./route.js"

const queue = []
let overlay

function ensureOverlay() {
  if (overlay) return overlay
  overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  overlay.setAttribute("id", "annot-overlay")
  overlay.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;overflow:visible"
  overlay.style.width = `${document.documentElement.scrollWidth}px`
  overlay.style.height = `${document.documentElement.scrollHeight}px`
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs")
  defs.innerHTML =
    '<marker id="arrowhead" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
    '<path d="M0,0.5 L7.5,4 L0,7.5" fill="none" stroke="context-stroke" stroke-width="1.2" stroke-linecap="round"/></marker>'
  overlay.appendChild(defs)
  document.body.style.position = "relative"
  document.body.appendChild(overlay)
  return overlay
}

// Tones resolve to tokens that EXIST in tokens.css v2 (two accents + ink). The v1 names
// (pos/neg/ref) are kept as aliases: an unresolvable var() makes the inline declaration
// invalid, SVG stroke falls back to `none`, and the arrow silently disappears — worse,
// the render worker skips stroke:none, so the stroke-floor lint never sees it either.
const toneColor = (tone) =>
  ({
    accent: "var(--accent)",
    warm: "var(--accent-warm)",
    pos: "var(--accent)",
    neg: "var(--accent-warm)",
    ref: "var(--border-strong)",
  })[tone] ?? "var(--border-strong)"

// v3 spelled a pinned anchor `side`, and it pinned BOTH ends. Ports supersede it, but the old
// spelling keeps working: a figure written against v3 must not silently re-route.
const opposite = { left: "right", right: "left", top: "bottom", bottom: "top" }

function el(name, attrs, styles = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  for (const [k, v] of Object.entries(styles)) node.style.setProperty(k, v)
  return node
}

/** The figure's stroke weight, in px. Clearance and lane width are both derived from it. */
const strokeWidth = () => parseFloat(getComputedStyle(document.body).getPropertyValue("--stroke")) || 1

/** Union of an element's own text client rects, or null when it renders no glyphs. */
function textUnion(elm) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const walker = document.createTreeWalker(elm, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const tn = walker.currentNode
    if (!tn.textContent || !tn.textContent.trim()) continue
    // KaTeX's MathML twin is clipped rather than display:none, so it still has client rects.
    // It is not ink, and including it would put the ink boundary where no glyph is drawn.
    if (tn.parentElement?.closest(".katex-mathml")) continue
    const range = document.createRange()
    range.selectNodeContents(tn)
    for (const r of range.getClientRects()) {
      if (!r.width || !r.height) continue
      minX = Math.min(minX, r.x)
      minY = Math.min(minY, r.y)
      maxX = Math.max(maxX, r.right)
      maxY = Math.max(maxY, r.bottom)
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null
}

/**
 * The VISIBLE rect, not the layout box, resolved PER SIDE. `.evidence` carries only
 * `border-left`, so its layout `right` edge sits at the column boundary with no ink anywhere
 * near it — which is why v3's arrows appeared to start in an empty gutter. An edge with no
 * border falls back to the element's own glyphs.
 *
 * "Filled" means a background distinct FROM THE PAGE: `.card` paints itself `--bg`, the page
 * colour, so its background is not ink — its border is. Testing only for non-transparency
 * would anchor a white-on-white box to an invisible edge, which is the bug this fixes.
 */
function inkRect(elm) {
  const cs = getComputedStyle(elm)
  const box = elm.getBoundingClientRect()
  const rect = { x: box.x, y: box.y, w: box.width, h: box.height }
  const bordered = (s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== "none"
  const own = cs.backgroundColor
  const page = getComputedStyle(document.body).backgroundColor
  const filled = Boolean(own) && own !== "rgba(0, 0, 0, 0)" && own !== "transparent" && own !== page
  if (filled || ["Top", "Right", "Bottom", "Left"].every(bordered)) return rect
  const text = textUnion(elm)
  if (!text) return rect
  const left = bordered("Left") ? rect.x : text.x
  const top = bordered("Top") ? rect.y : text.y
  const right = bordered("Right") ? rect.x + rect.w : text.x + text.w
  const bottom = bordered("Bottom") ? rect.y + rect.h : text.y + text.h
  return { x: left, y: top, w: Math.max(right - left, 0), h: Math.max(bottom - top, 0) }
}

const need = (sel, who) => {
  const elm = document.querySelector(sel)
  if (!elm) throw new Error(`${who}: missing element ${sel}`)
  return elm
}

/** Every declared node except the two endpoints, plus every text rect. */
function obstaclesFor(exclude) {
  // An ancestor or a descendant of an endpoint is not "in the way" of an edge that starts on
  // that endpoint's own boundary — it contains the anchor, so it would block every candidate.
  const related = (elm) => exclude.some((ex) => ex === elm || ex.contains(elm) || elm.contains(ex))
  const nodes = []
  for (const elm of document.querySelectorAll("[data-node]")) {
    if (related(elm)) continue
    const r = inkRect(elm)
    if (r.w > 0 && r.h > 0) nodes.push({ selector: elm.id ? `#${elm.id}` : "[data-node]", rect: r })
  }
  const textRects = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const tn = walker.currentNode
    if (!tn.textContent || !tn.textContent.trim()) continue
    const parent = tn.parentElement
    if (!parent) continue
    if (parent.closest("#annot-overlay, .katex-mathml")) continue
    // An endpoint's OWN glyphs are not an obstacle for its own edge. A borderless node's ink
    // rect IS its text union, so the anchor lands exactly on that rect and EVERY candidate
    // route would score as blocked before it had gone anywhere.
    if (related(parent)) continue
    const range = document.createRange()
    range.selectNodeContents(tn)
    for (const r of range.getClientRects())
      if (r.width && r.height) textRects.push({ x: r.x, y: r.y, w: r.width, h: r.height })
  }
  return { nodes, textRects }
}

// Corridors drawn so far this figure, so parallel edges separate into lanes.
const drawn = []
// Findings the router produced. render-worker reads these off window and lint turns them
// into rules 14/15 — a blocked route must not be silent, and must not abort the render
// either: a throw leaves the model with no picture to look at and nothing to act on.
const findings = []

export function arrow(fromSel, toSel, opts = {}) {
  queue.push(() => {
    const fromEl = need(fromSel, "arrow")
    const toEl = need(toSel, "arrow")
    const from = inkRect(fromEl)
    const to = inkRect(toEl)
    const { nodes, textRects } = obstaclesFor([fromEl, toEl])
    const stroke = strokeWidth()
    const result = routePath({
      from,
      to,
      portFrom: opts.port ?? opts.side,
      portTo: opts.to ?? (opts.side ? opposite[opts.side] : undefined),
      obstacles: nodes,
      textRects,
      clearance: stroke / 2 + 2,
      mode: opts.route ?? "auto",
      lanes: drawn,
      strokeWidth: stroke,
    })
    if (result.kind === "blocked")
      findings.push({ rule: "edge-unroutable", selector: `${fromSel} -> ${toSel}`, blocked: result.blocked })
    if (result.degenerate)
      findings.push({ rule: "edge-degenerate", selector: `${fromSel} -> ${toSel}`, blocked: [] })

    // A straight two-point route may still be BOWED on purpose: a feedback edge in a
    // recurrent architecture reads better as an arc. bow is retained for exactly that, and
    // is no longer what obstacle avoidance depends on, so a wrong value can no longer
    // produce a crossing — the router already cleared this geometry.
    let d
    if (result.points.length === 2 && opts.bow) {
      const [[x1, y1], [x2, y2]] = result.points
      const len = Math.hypot(x2 - x1, y2 - y1) || 1
      const mx = (x1 + x2) / 2 + (-(y2 - y1) / len) * opts.bow * len
      const my = (y1 + y2) / 2 + ((x2 - x1) / len) * opts.bow * len
      d = `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`
    } else {
      d = pathData(result.points)
    }
    drawn.push({ points: result.points, width: stroke })
    // The nodes this edge anchors to, so rule 14 can exclude their own glyphs. An ink-anchored
    // tail starts ON its node's text edge, so the corridor always overlaps that text — the
    // router already excludes it (obstaclesFor skips both endpoint elements) and lint has to
    // make the same exclusion, or every correctly-drawn arrow reports crossing its own anchor.
    const attrs = { d, "data-edge": "", "data-from": fromSel, "data-to": toSel }
    // The declared escape, on the path itself. Rules 14 and 15 govern overlay paths, and an
    // author cannot add an attribute to ink they did not write — so without this the one
    // escape mechanism the spec defines is unreachable for exactly the two rules that need
    // it most (a strikethrough, a stroke drawn across a label on purpose). Recorded in
    // lint.json's `exemptions`, where figure_review is asked to justify it.
    if (opts.intent) attrs["data-intent"] = opts.intent
    if (opts.head !== "none") attrs["marker-end"] = "url(#arrowhead)"
    if (opts.head === "both") attrs["marker-start"] = "url(#arrowhead)"
    ensureOverlay().appendChild(
      el("path", attrs, {
        fill: "none",
        stroke: toneColor(opts.tone),
        "stroke-width": "var(--stroke)",
        "stroke-dasharray": opts.style === "dashed" ? "5 4" : "none",
      }),
    )
  })
}

/** A polyline through explicit waypoints — selectors, or [fx, fy] fractions of the figure box. */
export function edge(fromSel, waypoints, toSel, opts = {}) {
  queue.push(() => {
    const from = inkRect(need(fromSel, "edge"))
    const to = inkRect(need(toSel, "edge"))
    // Resolved LAZILY: a figure with no fractional waypoint needs no #fig-root, and when one
    // is needed its absence must name itself rather than surface as "of undefined".
    let figBox = null
    const fig = () => (figBox ??= need("#fig-root", "edge").getBoundingClientRect())
    // Destructured explicitly: Object.values() on parsePort's result would depend on key
    // insertion order, so adding a field to that return type would silently reorder the args.
    const at = (r, port) => {
      const { side, fraction } = parsePort(port)
      return anchorAt(r, side, fraction)
    }
    const pts = [
      at(from, opts.port ?? "right"),
      ...waypoints.map((w) => {
        if (typeof w === "string") {
          const r = inkRect(need(w, "edge"))
          return [r.x + r.w / 2, r.y + r.h / 2]
        }
        const box = fig()
        return [box.x + box.width * w[0], box.y + box.height * w[1]]
      }),
      at(to, opts.to ?? "left"),
    ]
    const stroke = strokeWidth()
    // edge() draws EXACTLY what the author named — no clearance test, since explicit
    // waypoints are the author overruling the router. That makes it the primitive most
    // likely to cross a glyph deliberately, so it carries the same declared escape.
    const attrs = {
      d: pathData(pts),
      "data-edge": "",
      "marker-end": "url(#arrowhead)",
      "data-from": fromSel,
      "data-to": toSel,
    }
    if (opts.intent) attrs["data-intent"] = opts.intent
    ensureOverlay().appendChild(
      el(
        "path",
        attrs,
        {
          fill: "none",
          stroke: toneColor(opts.tone),
          "stroke-width": "var(--stroke)",
          "stroke-dasharray": opts.style === "dashed" ? "5 4" : "none",
        },
      ),
    )
    drawn.push({ points: pts, width: stroke })
  })
}

/** One source, many targets. Ports are distributed along the source side so the edges fan. */
export function fan(fromSel, targetSels, opts = {}) {
  const side = opts.port ?? "right"
  targetSels.forEach((t, i) => {
    const fraction = (i + 1) / (targetSels.length + 1)
    arrow(fromSel, t, { ...opts, port: `${side}:${fraction.toFixed(3)}` })
  })
}

/** Absolute-position an element near another without overlapping anything. */
export function place(sel, opts = {}) {
  queue.push(() => {
    const target = need(sel, "place")
    const near = inkRect(need(opts.near, "place"))
    const size = target.getBoundingClientRect()
    const { nodes, textRects } = obstaclesFor([target])
    const avoid = [...nodes.map((n) => n.rect), ...textRects]
    const spot = pickPlacement({ w: size.width, h: size.height }, near, avoid, opts.gap ?? 6)
    if (!spot) {
      findings.push({ rule: "placement-blocked", selector: sel, blocked: [opts.near] })
      return
    }
    // left/top resolve against the OFFSET PARENT's padding box, which is not necessarily the
    // body: a figure whose #fig-root is positioned makes that the containing block, and
    // measuring against body would then offset every placement by fig-root's origin.
    target.style.position = "absolute"
    document.body.style.position = "relative"
    const host = target.offsetParent ?? document.body
    const hostBox = host.getBoundingClientRect()
    const hostStyle = getComputedStyle(host)
    target.style.left = `${spot.x - hostBox.x - (parseFloat(hostStyle.borderLeftWidth) || 0)}px`
    target.style.top = `${spot.y - hostBox.y - (parseFloat(hostStyle.borderTopWidth) || 0)}px`
  })
}

/**
 * A callout with an optional leader line. `place` is the side of the anchor it sits on
 * (right|left|top|bottom, default right). The leader deliberately ends in open space, which
 * is why the manifest tags it `data-leader` and rule 15 does not treat it as a dangling edge.
 */
export function label(sel, text, opts = {}) {
  queue.push(() => {
    const r = inkRect(need(sel, "label"))
    const gap = opts.gap ?? 10
    const side = opts.place ?? "right"
    const midX = r.x + r.w / 2
    const midY = r.y + r.h / 2
    // [x, y, text-anchor, dominant-baseline, leader start, leader end]. The baseline is per
    // side so the text clears its own leader instead of sitting on top of it.
    const spot = {
      right: [r.x + r.w + gap, midY, "start", "middle", [r.x + r.w, midY], [r.x + r.w + gap - 2, midY]],
      left: [r.x - gap, midY, "end", "middle", [r.x, midY], [r.x - gap + 2, midY]],
      top: [midX, r.y - gap, "middle", "auto", [midX, r.y], [midX, r.y - gap + 2]],
      bottom: [midX, r.y + r.h + gap, "middle", "hanging", [midX, r.y + r.h], [midX, r.y + r.h + gap - 2]],
    }[side]
    if (!spot) throw new Error(`label: unknown place "${side}" (use right|left|top|bottom)`)
    const [x, y, textAnchor, baseline, leaderFrom, leaderTo] = spot
    const ov = ensureOverlay()
    const t = el(
      "text",
      { x, y, "text-anchor": textAnchor, "dominant-baseline": baseline, "data-label": "" },
      { fill: "var(--text)", "font-size": "var(--fs-label)", "font-family": "var(--font-text)" },
    )
    t.textContent = text
    ov.appendChild(t)
    if (opts.leader)
      ov.appendChild(
        el(
          "path",
          { d: pathData([leaderFrom, leaderTo]), "data-leader": "" },
          { fill: "none", stroke: toneColor(opts.tone), "stroke-width": "var(--stroke)" },
        ),
      )
  })
}

/** A measured span with end ticks — "4096 dims" under a block, IEEE style. */
export function dimension(aSel, bSel, opts = {}) {
  queue.push(() => {
    const a = inkRect(need(aSel, "dimension"))
    const b = inkRect(need(bSel, "dimension"))
    const gap = opts.gap ?? 10
    const above = opts.side === "top"
    const y = above ? Math.min(a.y, b.y) - gap : Math.max(a.y + a.h, b.y + b.h) + gap
    const x1 = Math.min(a.x, b.x)
    const x2 = Math.max(a.x + a.w, b.x + b.w)
    const tick = 4
    const ov = ensureOverlay()
    ov.appendChild(
      el(
        "path",
        {
          d: `M ${x1} ${y - tick} L ${x1} ${y + tick} M ${x1} ${y} L ${x2} ${y} M ${x2} ${y - tick} L ${x2} ${y + tick}`,
          "data-dimension": "",
        },
        { fill: "none", stroke: toneColor(opts.tone ?? "ref"), "stroke-width": "var(--stroke)" },
      ),
    )
    if (opts.text) {
      const t = el(
        "text",
        {
          x: (x1 + x2) / 2,
          y: above ? y - tick - 4 : y + tick + 4,
          "text-anchor": "middle",
          "dominant-baseline": above ? "auto" : "hanging",
        },
        { fill: "var(--text-muted)", "font-size": "var(--fs-small)", "font-family": "var(--font-text)" },
      )
      t.textContent = opts.text
      ov.appendChild(t)
    }
  })
}

export function brace(sel, opts = {}) {
  queue.push(() => {
    const r = document.querySelector(sel)?.getBoundingClientRect()
    if (!r) throw new Error(`brace: missing element ${sel}`)
    const side = opts.side ?? "left"
    const g = 8 // gap from the element
    const d = 7 // brace depth
    let path
    if (side === "left" || side === "right") {
      const s = side === "left" ? -1 : 1
      const x = side === "left" ? r.left - g : r.right + g
      const midY = r.top + r.height / 2
      path = `M ${x} ${r.top} q ${s * d} 0 ${s * d} ${d} L ${x + s * d} ${midY - d} q 0 ${d} ${s * d} ${d} q ${-s * d} 0 ${-s * d} ${d} L ${x + s * d} ${r.bottom - d} q 0 ${d} ${-s * d} ${d}`
    } else {
      const s = side === "top" ? -1 : 1
      const y = side === "top" ? r.top - g : r.bottom + g
      const midX = r.left + r.width / 2
      path = `M ${r.left} ${y} q 0 ${s * d} ${d} ${s * d} L ${midX - d} ${y + s * d} q ${d} 0 ${d} ${s * d} q 0 ${-s * d} ${d} ${-s * d} L ${r.right - d} ${y + s * d} q ${d} 0 ${d} ${-s * d}`
    }
    const ov = ensureOverlay()
    ov.appendChild(el("path", { d: path }, { fill: "none", stroke: toneColor(opts.tone), "stroke-width": "var(--stroke)" }))
    if (opts.label) {
      const lines = opts.label.split("\n")
      const lx = side === "left" ? r.left - g - d - 8 : side === "right" ? r.right + g + d + 8 : r.left + r.width / 2
      const cy = side === "top" ? r.top - g - d - 8 : side === "bottom" ? r.bottom + g + d + 8 : r.top + r.height / 2
      // multi-line labels grow downward from the first line; centre the block on cy
      const ly = cy - ((lines.length - 1) * 1.25 * 13) / 2
      const text = el(
        "text",
        { x: lx, y: ly, "text-anchor": side === "left" ? "end" : side === "right" ? "start" : "middle", "dominant-baseline": "middle" },
        // --font-text, not the dead v1 --font-ui: an unresolvable var() here dropped the
        // label to the browser's default serif, which rule 13 (font-allowlist) hard-fails.
        { fill: "var(--text)", "font-size": "var(--fs-label)", "font-family": "var(--font-text)" },
      )
      lines.forEach((line, i) => {
        const span = el("tspan", { x: lx, dy: i === 0 ? "0" : "1.25em" })
        span.textContent = line
        text.appendChild(span)
      })
      ov.appendChild(text)
    }
  })
}

export function highlight(sel, opts = {}) {
  queue.push(() => {
    const r = document.querySelector(sel)?.getBoundingClientRect()
    if (!r) throw new Error(`highlight: missing element ${sel}`)
    const pad = 5
    const tone = opts.tone ?? "accent"
    ensureOverlay().appendChild(
      el(
        "rect",
        // Square corners, no fill: the pastel --accent-soft era ended with tokens v2
        // (spec 2026-07-13) — and an unresolvable var() computes fill to BLACK, so the
        // old default painted a dark slab over the highlighted element.
        { x: r.left - pad, y: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2, rx: 0 },
        {
          fill: "none",
          stroke: toneColor(tone),
          "stroke-width": "var(--stroke)",
          "stroke-dasharray": (opts.style ?? "dashed") === "dashed" ? "5 4" : "none",
        },
      ),
    )
  })
}

export function figReady() {
  // Two rAFs guarantee layout is final before geometry is read.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      try {
        for (const draw of queue) draw()
        // What the router could not solve, published for the manifest to carry into lint.
        // Reported, never thrown: the model must always get a render to look at.
        window.__FIG_FINDINGS__ = findings
        window.__FIG_READY__ = true
      } catch (err) {
        window.__FIG_ERROR__ = String(err)
        throw err
      }
    }),
  )
}
