// Declarative annotations anchored to element IDs. One absolutely-positioned SVG
// overlay; geometry resolved at render time from getBoundingClientRect().
// The agent supplies IDs and one scalar (bow) — never a coordinate.
//
// Colors/strokes are applied through inline STYLE, not presentation attributes:
// SVG attributes do not resolve CSS var(), only CSS declarations do.

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

const toneColor = (tone) =>
  ({ accent: "var(--accent)", pos: "var(--pos)", neg: "var(--neg)", ref: "var(--ref)" })[tone] ?? "var(--border-strong)"

function anchor(rect, side) {
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  if (side === "top") return [cx, rect.top]
  if (side === "bottom") return [cx, rect.bottom]
  if (side === "left") return [rect.left, cy]
  if (side === "right") return [rect.right, cy]
  return [cx, cy]
}

function autoSides(a, b) {
  const dx = b.left + b.width / 2 - (a.left + a.width / 2)
  const dy = b.top + b.height / 2 - (a.top + a.height / 2)
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? ["right", "left"] : ["left", "right"]
  return dy > 0 ? ["bottom", "top"] : ["top", "bottom"]
}

const opposite = { left: "right", right: "left", top: "bottom", bottom: "top" }

function el(name, attrs, styles = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  for (const [k, v] of Object.entries(styles)) node.style.setProperty(k, v)
  return node
}

export function arrow(fromSel, toSel, opts = {}) {
  queue.push(() => {
    const a = document.querySelector(fromSel)?.getBoundingClientRect()
    const b = document.querySelector(toSel)?.getBoundingClientRect()
    if (!a || !b) throw new Error(`arrow: missing element ${!a ? fromSel : toSel}`)
    const [sideA, sideB] = opts.side ? [opts.side, opposite[opts.side]] : autoSides(a, b)
    const [x1, y1] = anchor(a, sideA)
    const [x2, y2] = anchor(b, sideB)
    // bow: signed swoop as a fraction of segment length; the control point is the
    // midpoint pushed along the perpendicular. One scalar an LLM can reason about.
    const bow = opts.bow ?? 0.25
    const mx = (x1 + x2) / 2
    const my = (y1 + y2) / 2
    const len = Math.hypot(x2 - x1, y2 - y1) || 1
    const px = (-(y2 - y1) / len) * bow * len
    const py = ((x2 - x1) / len) * bow * len
    ensureOverlay().appendChild(
      el(
        "path",
        { d: `M ${x1} ${y1} Q ${mx + px} ${my + py} ${x2} ${y2}`, "marker-end": "url(#arrowhead)" },
        { fill: "none", stroke: toneColor(opts.tone), "stroke-width": "var(--stroke)" },
      ),
    )
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
        { fill: "var(--text)", "font-size": "var(--fs-label)", "font-family": "var(--font-ui)" },
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
        { x: r.left - pad, y: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2, rx: 6 },
        {
          fill: tone === "accent" ? "var(--accent-soft)" : "none",
          "fill-opacity": "0.5",
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
        window.__FIG_READY__ = true
      } catch (err) {
        window.__FIG_ERROR__ = String(err)
        throw err
      }
    }),
  )
}
