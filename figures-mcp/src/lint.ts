export type TextBox = {
  selector: string
  text: string
  rect: { x: number; y: number; w: number; h: number }
  fontSize: number
  color: string
  background: string
  derived: boolean
}
export type LintInput = {
  source: string
  meta: { archetype: string; caption: string; alt: string; claim: string }
  data: unknown
  manifest: {
    viewport: { width: number; height: number }
    texts: TextBox[]
    strokes: { selector: string; width: number }[]
  }
}
export type LintError = { rule: string; selector: string; actual: string; expected: string }

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
// A rendered number traces to data if it equals a value, or a rounding of one.
const traces = (rendered: number, values: number[]) =>
  values.some((v) => {
    if (Math.abs(v - rendered) <= Math.abs(v) * 1e-9 + 1e-9) return true
    for (let k = 0; k <= 4; k++) if (Number(v.toFixed(k)) === rendered) return true
    return false
  })

export function lint(input: LintInput): LintError[] {
  const errors: LintError[] = []
  const { texts, strokes, viewport } = input.manifest
  const err = (rule: string, selector: string, actual: string, expected: string) =>
    errors.push({ rule, selector, actual, expected })

  // 1 text-overlap (shrink 1px each side to forgive adjacent glyph boxes)
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) {
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

  // 3 min-type-size
  for (const t of texts) if (t.fontSize < 9) err("min-type-size", t.selector, `${t.fontSize}px`, ">= 9px")

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
  if (cats.size > 5) err("palette", "figure", `${cats.size} categorical colors`, "<= 5 (from tokens.css)")

  // 8 provenance (chart/table): every non-derived rendered number traces to data.json
  if (input.meta.archetype === "chart" || input.meta.archetype === "table") {
    const values = flattenNumbers(input.data)
    for (const t of texts) {
      if (t.derived) continue
      for (const m of t.text.matchAll(/-?\d+(?:\.\d+)?/g)) {
        const n = Number(m[0])
        if (!traces(n, values)) err("provenance", t.selector, m[0], "a value reachable in data.json")
      }
    }
  }

  // 9 root-svg
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

  return errors
}
