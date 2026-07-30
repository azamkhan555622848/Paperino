import { segmentHitsRect } from "./route"

export type TextBox = {
  selector: string
  text: string
  rect: { x: number; y: number; w: number; h: number }
  fontSize: number
  color: string
  background: string
  derived: boolean
  /** Computed font-family — rule 13 fails anything outside the KaTeX_* allowlist. */
  fontFamily: string
  /** Inside KaTeX output: exempt from the 7pt floor and from intra-formula overlap. */
  inKatex: boolean
}
/** Elements carrying web chrome — rule 12. */
export type ElementBox = { selector: string; borderRadius: number; boxShadow: string }
/** An overlay path, sampled as a polyline. Rules 14 and 15 ask where a stroke WENT. */
export type PathBox = {
  selector: string
  points: [number, number][]
  width: number
  kind: "edge" | "leader" | "dimension" | "other"
}
/** An element claiming to be a diagram node (`data-node`) — rules 15 and 16. */
export type NodeBox = {
  selector: string
  rect: { x: number; y: number; w: number; h: number }
  hasText: boolean
  intent: string | null
}
/** A textless inked mark, and whether it sits inside `[data-legend]` — rule 17. */
export type LegendMark = { selector: string; style: string; inLegend: boolean }
/** `data-intent="<reason>"` as the page carries it: a claim, before any rule consumes it. */
export type Intent = { selector: string; reason: string }
/** A consumed claim: which rule it waived, on what, and why. Reported in lint.json. */
export type Exemption = { rule: string; selector: string; reason: string }
/** What the in-page router could not solve. It renders and reports; it never throws. */
export type RouterFinding = { rule: string; selector: string; blocked: string[] }
export type LintResult = { passed: boolean; errors: LintError[]; exemptions: Exemption[] }

/**
 * Rules a `data-intent` may NEVER waive. Two are honesty (a fabricated number, a face we
 * did not ship), two are physics (text below 7pt cannot be read in print; content outside
 * the box is clipped at compile time). No creative intent requires any of them, so an
 * attempt to declare one is itself a finding.
 */
const ABSOLUTE_RULES = ["overflow", "min-type-size", "provenance", "font-allowlist"] as const

export type LintInput = {
  source: string
  meta: {
    archetype: string
    caption: string
    alt: string
    claim: string
    engine?: "html" | "mpl"
    /** Extra faces this figure deliberately sets text in — an INPUT to rule 13, not an
     *  escape from it. Declared in meta.yaml, so it is visible where the figure is. */
    fonts?: string[]
  }
  data: unknown
  /** Families a text node may be set in. Venue-derived when the server calls it, so a Times
   *  paper and a Computer Modern paper each accept exactly their own face. */
  allowedFaces?: string[]
  /**
   * Families the math engine typesets in (STIX under Times venues, Computer Modern under
   * `article`). Text set in one of these IS a formula, and gets the same three exemptions
   * KaTeX output already has — script sizes below the 7pt floor, self-overlapping glyph
   * boxes, and digits that are notation rather than data.
   */
  mathFaces?: string[]
  manifest: {
    viewport: { width: number; height: number }
    texts: TextBox[]
    strokes: { selector: string; width: number }[]
    elements: ElementBox[]
    /** v4 geometry. Optional so a v3 manifest still lints — the older rules are unaffected. */
    paths?: PathBox[]
    nodes?: NodeBox[]
    legend?: LegendMark[]
    intents?: Intent[]
    findings?: RouterFinding[]
  }
}
export type LintError = { rule: string; selector: string; actual: string; expected: string }

/** Text faces vendored by scaffold. Anything else in a computed font-family is a silent
 *  fallback — the failure rule 13 exists to catch. "TeX Gyre Termes" carries its spaces
 *  because that is the name inside the font file, and matplotlib emits that spelling. */
const SHIPPED_FACES = ["KaTeX_", "TeX Gyre Termes"]

const rgb = (s: string): [number, number, number] | null => {
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
const luminance = ([r, g, b]: [number, number, number]) => {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrastRatio = (a: string, b: string) => {
  const ca = rgb(a)
  const cb = rgb(b)
  if (!ca || !cb) return 21
  const [l1, l2] = [luminance(ca), luminance(cb)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}
const isGray = (c: [number, number, number]) => Math.max(...c) - Math.min(...c) <= 12

const flattenNumbers = (v: unknown, out: number[] = []): number[] => {
  if (typeof v === "number" && Number.isFinite(v)) out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => flattenNumbers(x, out))
  else if (v && typeof v === "object") Object.values(v).forEach((x) => flattenNumbers(x, out))
  return out
}
// String values from data (labels like "5C") may contain digits that are not claims.
const flattenStrings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === "string") out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => flattenStrings(x, out))
  else if (v && typeof v === "object") Object.values(v).forEach((x) => flattenStrings(x, out))
  return out
}
// Digits that BELONG TO A NAME are notation, not a value — the 50 in "ResNet-50", the 2 in
// "GPT-2", the 3 in "conv3", the 5 in "Top-5 error". Requiring those in data.json would make
// rule 8 unusable on schematics, where names are most of the ink.
//
// The tell is a letter immediately BEFORE the digits (optionally across a hyphen). A letter
// AFTER them is not a tell and must not exempt: "12ms", "50%", "3x" are values wearing a
// unit, and a value wearing a unit is exactly the thing this rule exists to catch.
const isNameDigit = (text: string, i: number) => {
  const prev = text[i - 1]
  if (prev && /[A-Za-z]/.test(prev)) return true // conv3, GPT2  (also ResNet-50: prev is "t")
  if (prev === "-" && /[A-Za-z]/.test(text[i - 2] ?? "")) return true // matched without the "-"
  return false
}

// A rendered number traces to data if it equals a value, or a rounding of one.
const traces = (rendered: number, values: number[]) =>
  values.some((v) => {
    if (Math.abs(v - rendered) <= Math.abs(v) * 1e-9 + 1e-9) return true
    for (let k = 0; k <= 4; k++) if (Number(v.toFixed(k)) === rendered) return true
    return false
  })

export function lint(input: LintInput): LintResult {
  const errors: LintError[] = []
  const { texts, strokes, viewport } = input.manifest
  const exemptions: Exemption[] = []
  const intents = new Map((input.manifest.intents ?? []).map((i) => [i.selector, i.reason]))
  const claimed = new Set<string>()
  /**
   * Honour a declared intent and RECORD it. The record is the safeguard: `lint.json` carries
   * every waiver, and figure_review is asked whether each one is justified — so an escape is
   * visible to a reviewer rather than a silent bypass. Once per (rule, selector): one
   * attribute tripping the same rule twice is one waiver, not two.
   */
  const record = (rule: string, selector: string, reason: string) => {
    const key = `${rule}\u0000${selector}`
    if (claimed.has(key)) return
    claimed.add(key)
    exemptions.push({ rule, selector, reason })
  }
  const waived = (rule: string, selector: string) => {
    const reason = intents.get(selector)
    if (reason === undefined) return false
    record(rule, selector, reason)
    return true
  }
  /**
   * (rule, selector) pairs no `data-intent` may waive. Most are derived from ABSOLUTE_RULES
   * once every rule has run, but `box-shadow` is absolute INSIDE rule 12, which is otherwise
   * escapable — so "is this error's rule absolute?" cannot answer for it and the shadow
   * branch declares itself. `what` is what the message names, so a waived shadow reads as
   * "against box-shadow" rather than the vaguer "against web-chrome".
   */
  const unwaivable: { selector: string; what: string }[] = []
  // "Inside a formula", whichever engine drew it. The HTML engine says so with a .katex
  // ancestor; matplotlib says so by setting the glyphs in the math fontset's own faces.
  // Both mean the same thing: a math typesetter chose this size and position, not the
  // author, so the rules written for authored text do not apply.
  const firstFace = (t: TextBox) => t.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "")
  const inMath = (t: TextBox) =>
    t.inKatex || (input.mathFaces ?? []).some((face) => firstFace(t).startsWith(face))
  const err = (rule: string, selector: string, actual: string, expected: string) =>
    errors.push({ rule, selector, actual, expected })

  // 1 text-overlap (shrink 1px each side to forgive adjacent glyph boxes)
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) {
      // KaTeX absolutely positions glyph boxes, so a formula's own spans routinely
      // intersect. That is its layout engine's business — pairwise overlap inside a
      // formula would be a false-positive storm. Formula-vs-outside still counts.
      if (inMath(texts[i]) && inMath(texts[j])) continue
      const a = texts[i].rect
      const b = texts[j].rect
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) - 2
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) - 2
      if (ox > 0 && oy > 0)
        err(
          "text-overlap",
          `${texts[i].selector} ~ ${texts[j].selector}`,
          `overlap ${ox.toFixed(0)}x${oy.toFixed(0)}px`,
          "no intersection",
        )
    }

  // 2 overflow
  for (const t of texts) {
    const r = t.rect
    if (r.x < -1 || r.y < -1 || r.x + r.w > viewport.width + 1 || r.y + r.h > viewport.height + 1)
      err(
        "overflow",
        t.selector,
        `bbox (${r.x.toFixed(0)},${r.y.toFixed(0)},${r.w.toFixed(0)},${r.h.toFixed(0)})`,
        `inside 0,0,${viewport.width},${viewport.height}`,
      )
  }

  // 3 min-type-size: a 7pt floor — a print guarantee, not an arbitrary screen number.
  //
  // The px-to-pt factor depends on the engine, because the two measure in different units.
  // An HTML figure is laid out in CSS px at Chromium's 96dpi, so 1px = 0.75pt. A matplotlib
  // SVG's user unit is a POINT (72/in), and the backend writes the point value straight
  // into font-size, so `font-size: 9px` there really is 9pt. Applying 0.75 to it reported
  // genuine 9pt labels as 6.75pt and failed every one of them.
  //
  // KaTeX internals are exempt either way: LaTeX itself sets scripts at 7/5pt in a 10pt
  // body, so a blanket floor would fail every superscript.
  const ptPerUnit = input.meta.engine === "mpl" ? 1 : 0.75
  // Rounded UP: 7/0.75 is 9.333…, and 9.33px is 6.9975pt, so quoting 9.33 as the floor
  // would name a size that does not actually clear it.
  const floorUnits = Math.ceil((7 / ptPerUnit) * 100) / 100
  for (const t of texts) {
    if (inMath(t)) continue
    const pt = t.fontSize * ptPerUnit
    if (pt < 7 - 0.01)
      err("min-type-size", t.selector, `${t.fontSize}px (${pt.toFixed(2)}pt)`, `>= 7pt (${floorUnits.toFixed(2)}px)`)
  }

  // 4 contrast
  for (const t of texts) {
    const ratio = contrastRatio(t.color, t.background)
    if (ratio < 4.5) err("contrast", t.selector, ratio.toFixed(2), ">= 4.5")
  }

  // 5 no-raw-color (source check; ids like #token contain non-hex letters and don't match)
  const raw = input.source.match(/#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b|\brgba?\(/)
  if (raw) err("no-raw-color", "figure.html", raw[0], "var(--…) from tokens.css")

  // 6 stroke-floor (0 = intentionally invisible, skip)
  for (const s of strokes) if (s.width > 0 && s.width < 0.75) err("stroke-floor", s.selector, `${s.width}px`, ">= 0.75px")

  // 7 palette: distinct non-gray text colors <= 5
  const cats = new Set<string>()
  for (const t of texts) {
    const c = rgb(t.color)
    if (c && !isGray(c)) cats.add(c.join(","))
  }
  // Five colours is already generous, so the cap stays the default — but a six-condition
  // ablation is legitimate, and a house opinion that is wrong occasionally is exactly what
  // the declared escape is for.
  if (cats.size > 5 && !waived("palette", "figure"))
    err("palette", "figure", `${cats.size} categorical colors`, "<= 5 (from tokens.css)")

  // 8 provenance: every non-derived rendered number traces to data.json.
  //
  // This runs on EVERY archetype. It used to be gated to chart|table, which left schematic
  // and gallery enforced on trust alone — and a fabricated number reaches the paper just as
  // readily inside a schematic node label ("512 experts", "3.2x speedup") as inside a table
  // cell. Product rule 1 is the point of this subsystem; half-enforcing it structurally was
  // the gap.
  const values = flattenNumbers(input.data)
  const labels = new Set(flattenStrings(input.data))
  for (const t of texts) {
    if (t.derived) continue
    // Digits inside a formula are notation, not data: the 2 in σ² is an exponent, and the
    // 4 in b=4 is a subscript naming a condition. Provenance governs rendered VALUES.
    if (inMath(t)) continue
    // a cell copied verbatim from a string in data (e.g. the step label "5C") is sourced
    if (labels.has(t.text)) continue
    const normalized = t.text.replace(/(?<=\d),(?=\d)/g, "") // 14,617 -> 14617
    for (const m of normalized.matchAll(/-?\d+(?:\.\d+)?/g)) {
      if (isNameDigit(normalized, m.index ?? 0)) continue
      const n = Number(m[0])
      if (!traces(n, values)) err("provenance", t.selector, m[0], "a value reachable in data.json")
    }
  }

  // 9 root-svg: AUTHORED markup only. matplotlib emits its own root <svg> carrying both a
  // viewBox and pt dimensions; no human wrote it and there is nothing in it to fix, so
  // failing an mpl figure here would be an unfixable error by construction.
  if (input.meta.engine !== "mpl")
    for (const m of input.source.matchAll(/<svg\b[^>]*>/g)) {
      const tag = m[0]
      if (!/viewBox=/.test(tag)) err("root-svg", "svg", "no viewBox", "viewBox required")
      if (/\bwidth="\d+"/.test(tag) || /\bheight="\d+"/.test(tag))
        err("root-svg", "svg", "fixed px width/height", "no fixed px dimensions")
    }

  // 10 meta-complete
  for (const key of ["caption", "alt", "claim"] as const)
    if (!input.meta[key] || !String(input.meta[key]).trim())
      err("meta-complete", "meta.yaml", `${key} empty`, `${key} present`)

  // 11 pseudo-math: TeX-ish plain text outside KaTeX output. `sigma_ch^2 lesssim ...`
  // rendered as literal monospace is the single most damning artifact a figure can
  // carry into a paper. Symbols belong in .math spans.
  const PSEUDO_MATH =
    /\\[a-zA-Z]+|[A-Za-z0-9]\^|[A-Za-z0-9]_[A-Za-z0-9{(]|\b(?:sigma|Sigma|delta|Delta|epsilon|lambda|theta|alpha|gamma|lesssim|gtrsim|infty|sqrt)\b|\bO\([^)]+\)/
  for (const t of texts)
    if (!t.inKatex && PSEUDO_MATH.test(t.text))
      err("pseudo-math", t.selector, t.text.slice(0, 40), "typeset via a .math span (KaTeX)")

  // 12 web-chrome: paper figures have square corners and no shadows. The radius
  // threshold also catches pill badges, whose radius is half their height.
  for (const e of input.manifest.elements ?? []) {
    // Radius is escapable: some architecture diagrams really do use rounded blocks.
    if (e.borderRadius > 3 && !waived("web-chrome", e.selector))
      err("web-chrome", e.selector, `border-radius ${e.borderRadius}px`, "<= 3px (square corners)")
    // Shadows are absolute. No paper idiom needs one, so there is nothing to declare.
    if (e.boxShadow && e.boxShadow !== "none") {
      err("web-chrome", e.selector, `box-shadow ${e.boxShadow.slice(0, 40)}`, "none")
      unwaivable.push({ selector: e.selector, what: "box-shadow" })
    }
  }

  // 13 font-allowlist: catches a silent fallback to Segoe UI, DejaVu or the system serif.
  //
  // The default is every face Paperino ships, because that is what the rule is actually for.
  // The server narrows it to the workspace's venue face; a bare lint() call should still not
  // fail a figure for using a font we vendored ourselves.
  // A deliberate extra face is an INPUT to the allowlist, declared in meta.yaml — not an
  // escape from the rule. Naming one face still leaves every other face failing, which is
  // the silent-fallback case the rule exists for.
  const allowed = [...(input.allowedFaces ?? SHIPPED_FACES), ...(input.meta.fonts ?? [])]
  for (const t of texts) {
    const first = t.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "")
    if (!allowed.some((a) => first.startsWith(a)))
      err("font-allowlist", t.selector, first, `one of: ${allowed.join(", ")}`)
  }

  const paths = input.manifest.paths ?? []
  const nodes = input.manifest.nodes ?? []

  // 14 stroke-over-text: a stroke through a glyph. Rule 1 compares text to text only, which
  // is why an arrow crossing "Reconstruction-distortion profiles" linted clean.
  //
  // A crossing is a defect in every visual idiom ever invented — no composition requires one
  // — but a strikethrough is real, so the escape is declared per path.
  for (const p of paths) {
    if (p.kind === "dimension") continue
    const clearance = p.width / 2 + 2
    const hit = texts.find((t) => {
      if (inMath(t)) return false // KaTeX positions glyph boxes; its internals are not ink to route around
      for (let i = 0; i + 1 < p.points.length; i++)
        if (segmentHitsRect(p.points[i], p.points[i + 1], t.rect, clearance)) return true
      return false
    })
    if (hit && !waived("stroke-over-text", p.selector))
      err("stroke-over-text", p.selector, `crosses ${hit.selector} ("${hit.text.slice(0, 24)}")`, "route around text")
  }

  // 15 dangling-edge: an endpoint attached to nothing — the 30px arc alone in a 30px gutter
  // that shipped in Fig. 2. A leader deliberately points at a region rather than a node, and
  // a dimension line spans a gap, so those two are exempt BY KIND, not by declaration.
  const NEAR = 3
  const touchesANode = (pt: [number, number]) =>
    nodes.some((n) => {
      const r = n.rect
      const dx = Math.max(r.x - pt[0], 0, pt[0] - (r.x + r.w))
      const dy = Math.max(r.y - pt[1], 0, pt[1] - (r.y + r.h))
      return Math.hypot(dx, dy) <= NEAR
    })
  for (const p of paths) {
    if (p.kind !== "edge" || p.points.length < 2) continue
    for (const pt of [p.points[0], p.points[p.points.length - 1]])
      if (!touchesANode(pt) && !waived("dangling-edge", p.selector))
        err(
          "dangling-edge",
          p.selector,
          `endpoint (${pt[0].toFixed(0)},${pt[1].toFixed(0)}) touches no node`,
          `within ${NEAR}px of a node edge`,
        )
  }

  // 16 empty-node: a node with no text. The two 9px squares that shipped in Fig. 3 were
  // `.port` elements the author drew to manufacture anchor targets, because arrow() could
  // only anchor to whole-box edges. Ports now make that unnecessary; the rule makes it visible.
  // Under 100px^2 is a tick or a rule, not a node.
  for (const n of nodes) {
    const area = n.rect.w * n.rect.h
    if (area <= 100 || n.hasText) continue
    if (n.intent !== null) {
      record("empty-node", n.selector, n.intent)
      continue
    }
    err("empty-node", n.selector, `${n.rect.w.toFixed(0)}x${n.rect.h.toFixed(0)}px, no text`, "text content, or data-intent")
  }

  // 17 orphan-legend: a legend entry for a mark the figure does not contain. A legend that
  // describes an absent mark is a false statement about the figure, which puts it in the
  // same family as provenance rather than in the same family as taste.
  const legend = input.manifest.legend ?? []
  const realStyles = new Set(legend.filter((m) => !m.inLegend).map((m) => m.style))
  for (const m of legend) {
    if (!m.inLegend || realStyles.has(m.style)) continue
    if (!waived("orphan-legend", m.selector))
      err("orphan-legend", m.selector, `style ${m.style} matches no mark`, "a mark drawn in the figure")
  }

  // Router findings. A blocked or degenerate route renders and reports: a throw would leave
  // the model with no picture to look at and nothing actionable.
  for (const f of input.manifest.findings ?? [])
    err(f.rule, f.selector, f.blocked.length ? `blocked by ${f.blocked.join(", ")}` : "degenerate", "a clear route")

  // An intent aimed at an absolute rule. Derived LAST so `errors` is complete — and the
  // waiver buys nothing on the way: the absolute rule was already reported above, because
  // none of its branches consults `waived`.
  for (const e of errors)
    if ((ABSOLUTE_RULES as readonly string[]).includes(e.rule)) unwaivable.push({ selector: e.selector, what: e.rule })
  const named = new Set<string>()
  for (const u of unwaivable) {
    const reason = intents.get(u.selector)
    if (reason === undefined) continue
    const key = `${u.what}\u0000${u.selector}`
    if (named.has(key)) continue
    named.add(key)
    err(
      "intent-not-permitted",
      u.selector,
      `data-intent="${reason}" against ${u.what}`,
      `${u.what} has no exemption — fix the figure`,
    )
  }

  return { passed: errors.length === 0, errors, exemptions }
}
