import { expect, test } from "bun:test"
import { lint, type LintInput } from "../src/lint"

const box = (over: Partial<any> = {}) => ({
  selector: "#t",
  text: "hello",
  rect: { x: 10, y: 10, w: 50, h: 14 },
  fontSize: 13,
  color: "rgb(26, 26, 31)",
  background: "rgb(255, 255, 255)",
  derived: false,
  fontFamily: '"KaTeX_Main", Georgia, serif',
  inKatex: false,
  ...over,
})

const base = (over: Partial<LintInput> = {}): LintInput => ({
  source: `<link rel="stylesheet" href="../tokens.css">`,
  meta: { archetype: "schematic", caption: "c", alt: "a", claim: "x" },
  data: {},
  manifest: { viewport: { width: 528, height: 300 }, texts: [box()], strokes: [], elements: [] },
  ...over,
})

/** Manifest helper for the v2 rules — keeps the new tests readable. */
const mf = (over: Partial<LintInput["manifest"]> = {}): LintInput["manifest"] => ({
  viewport: { width: 528, height: 300 },
  texts: [box()],
  strokes: [],
  elements: [],
  ...over,
})

const rules = (input: LintInput) => lint(input).map((e) => e.rule)

test("clean input passes all rules", () => expect(lint(base())).toEqual([]))

test("text-overlap", () => {
  const m = {
    viewport: { width: 528, height: 300 },
    texts: [box(), box({ selector: "#u", rect: { x: 12, y: 12, w: 50, h: 14 } })],
    strokes: [],
    elements: [],
  }
  expect(rules(base({ manifest: m }))).toContain("text-overlap")
})

test("overflow", () => {
  const m = { viewport: { width: 528, height: 300 }, texts: [box({ rect: { x: 540, y: 10, w: 50, h: 14 } })], strokes: [], elements: [] }
  expect(rules(base({ manifest: m }))).toContain("overflow")
})

test("min-type-size", () => {
  const m = { viewport: { width: 528, height: 300 }, texts: [box({ fontSize: 8 })], strokes: [], elements: [] }
  expect(rules(base({ manifest: m }))).toContain("min-type-size")
})

test("contrast", () => {
  const m = { viewport: { width: 528, height: 300 }, texts: [box({ color: "rgb(200, 200, 200)" })], strokes: [], elements: [] }
  expect(rules(base({ manifest: m }))).toContain("contrast")
})

test("no-raw-color", () => {
  expect(rules(base({ source: `<div style="color: #f59e0b">x</div>` }))).toContain("no-raw-color")
  expect(rules(base({ source: `<div style="color: rgb(1,2,3)">x</div>` }))).toContain("no-raw-color")
  expect(rules(base({ source: `<div style="color: var(--accent)">x</div>` }))).toEqual([])
})

test("stroke-floor", () => {
  const m = { viewport: { width: 528, height: 300 }, texts: [box()], strokes: [{ selector: "#p", width: 0.5 }], elements: [] }
  expect(rules(base({ manifest: m }))).toContain("stroke-floor")
})

test("palette allows <=5 categorical colors", () => {
  const texts = [
    "rgb(180, 83, 9)",
    "rgb(21, 128, 61)",
    "rgb(185, 28, 28)",
    "rgb(29, 78, 216)",
    "rgb(120, 29, 216)",
    "rgb(216, 29, 150)",
  ].map((color, i) => box({ selector: `#c${i}`, color, rect: { x: 10, y: 10 + i * 30, w: 50, h: 14 } }))
  expect(rules(base({ manifest: { viewport: { width: 528, height: 300 }, texts, strokes: [], elements: [] } }))).toContain("palette")
})

test("provenance: table numbers must trace to data.json", () => {
  const m = { viewport: { width: 528, height: 300 }, texts: [box({ text: "14617" })], strokes: [], elements: [] }
  const meta = { archetype: "table", caption: "c", alt: "a", claim: "x" }
  expect(rules(base({ meta, data: { rows: [{ v: 14617 }] }, manifest: m }))).toEqual([])
  expect(rules(base({ meta, data: { rows: [{ v: 999 }] }, manifest: m }))).toContain("provenance")
})

test("provenance accepts a cell whose whole text is a string value from data", () => {
  // "5C" is a step label carried straight from data.json — the 5 is not a claim
  const m = { viewport: { width: 528, height: 300 }, texts: [box({ text: "5C" })], strokes: [], elements: [] }
  const meta = { archetype: "table", caption: "c", alt: "a", claim: "x" }
  expect(rules(base({ meta, data: { rows: [{ step: "5C" }] }, manifest: m }))).toEqual([])
  expect(rules(base({ meta, data: { rows: [{ step: "9C" }] }, manifest: m }))).toContain("provenance")
})

test("provenance sees through thousands separators", () => {
  const m = { viewport: { width: 528, height: 300 }, texts: [box({ text: "14,617" })], strokes: [], elements: [] }
  const meta = { archetype: "table", caption: "c", alt: "a", claim: "x" }
  expect(rules(base({ meta, data: { rows: [{ v: 14617 }] }, manifest: m }))).toEqual([])
})

test("provenance exempts data-derived nodes", () => {
  const m = { viewport: { width: 528, height: 300 }, texts: [box({ text: "20", derived: true })], strokes: [], elements: [] }
  const meta = { archetype: "chart", caption: "c", alt: "a", claim: "x" }
  expect(rules(base({ meta, data: {}, manifest: m }))).toEqual([])
})

test("root-svg", () => {
  expect(rules(base({ source: `<svg width="550" height="300"><rect/></svg>` }))).toContain("root-svg")
  expect(rules(base({ source: `<svg viewBox="0 0 550 300"><rect/></svg>` }))).toEqual([])
})

test("meta-complete", () => {
  const meta = { archetype: "schematic", caption: "", alt: "a", claim: "x" }
  expect(rules(base({ meta }))).toContain("meta-complete")
})

test("errors carry a selector, not prose", () => {
  const m = { viewport: { width: 528, height: 300 }, texts: [box({ fontSize: 6 })], strokes: [], elements: [] }
  const [err] = lint(base({ manifest: m }))
  expect(err).toEqual({
    rule: "min-type-size",
    selector: "#t",
    actual: "6px (4.50pt)",
    expected: ">= 7pt (9.34px)",
  })
})

// ---- v2 publication rules (spec 2026-07-13) ----

test("min-type-size is a 7pt floor (9.34px passes, 9px fails)", () => {
  expect(rules(base({ manifest: mf({ texts: [box({ fontSize: 9.34 })] }) }))).not.toContain("min-type-size")
  expect(rules(base({ manifest: mf({ texts: [box({ fontSize: 9 })] }) }))).toContain("min-type-size")
})

test("KaTeX-internal text is exempt from the type floor (LaTeX scripts are 7/5pt)", () => {
  const m = mf({ texts: [box({ fontSize: 8, inKatex: true })] })
  expect(rules(base({ manifest: m }))).not.toContain("min-type-size")
})

test("intra-formula overlap is skipped; formula-vs-outside is not", () => {
  const a = box({ selector: "#f1", inKatex: true })
  const b = box({ selector: "#f2", inKatex: true, rect: { x: 12, y: 12, w: 50, h: 14 } })
  const outside = box({ selector: "#t2", rect: { x: 12, y: 12, w: 50, h: 14 } })
  expect(rules(base({ manifest: mf({ texts: [a, b] }) }))).not.toContain("text-overlap")
  expect(rules(base({ manifest: mf({ texts: [a, outside] }) }))).toContain("text-overlap")
})

test("pseudo-math: TeX-ish plain text fails; the same text inside KaTeX passes", () => {
  expect(rules(base({ manifest: mf({ texts: [box({ text: "O(g sigma_vec)" })] }) }))).toContain("pseudo-math")
  expect(rules(base({ manifest: mf({ texts: [box({ text: "sigma_ch^2 lesssim x" })] }) }))).toContain("pseudo-math")
  expect(rules(base({ manifest: mf({ texts: [box({ text: "\sigma^2", inKatex: true })] }) }))).not.toContain("pseudo-math")
  // ordinary prose must not trip it
  expect(rules(base({ manifest: mf({ texts: [box({ text: "shared across every query head" })] }) }))).not.toContain(
    "pseudo-math",
  )
})

test("web-chrome: radius > 3px or any shadow fails", () => {
  const m = (elements: any[]) => base({ manifest: mf({ elements }) })
  expect(rules(m([{ selector: "#pill", borderRadius: 12, boxShadow: "none" }]))).toContain("web-chrome")
  expect(rules(m([{ selector: "#sh", borderRadius: 0, boxShadow: "rgba(0,0,0,0.2) 0px 2px 8px" }]))).toContain(
    "web-chrome",
  )
  expect(rules(m([{ selector: "#ok", borderRadius: 2, boxShadow: "none" }]))).not.toContain("web-chrome")
})

test("font-allowlist: the first resolved face must be KaTeX_*", () => {
  const bad = mf({ texts: [box({ fontFamily: '"Segoe UI", sans-serif' })] })
  expect(rules(base({ manifest: bad }))).toContain("font-allowlist")
  const ok = mf({ texts: [box({ fontFamily: "KaTeX_Typewriter, monospace" })] })
  expect(rules(base({ manifest: ok }))).not.toContain("font-allowlist")
})
