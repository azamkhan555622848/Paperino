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
  ...over,
})

const base = (over: Partial<LintInput> = {}): LintInput => ({
  source: `<link rel="stylesheet" href="../tokens.css">`,
  meta: { archetype: "schematic", caption: "c", alt: "a", claim: "x" },
  data: {},
  manifest: { viewport: { width: 550, height: 300 }, texts: [box()], strokes: [] },
  ...over,
})

const rules = (input: LintInput) => lint(input).map((e) => e.rule)

test("clean input passes all rules", () => expect(lint(base())).toEqual([]))

test("text-overlap", () => {
  const m = {
    viewport: { width: 550, height: 300 },
    texts: [box(), box({ selector: "#u", rect: { x: 12, y: 12, w: 50, h: 14 } })],
    strokes: [],
  }
  expect(rules(base({ manifest: m }))).toContain("text-overlap")
})

test("overflow", () => {
  const m = { viewport: { width: 550, height: 300 }, texts: [box({ rect: { x: 540, y: 10, w: 50, h: 14 } })], strokes: [] }
  expect(rules(base({ manifest: m }))).toContain("overflow")
})

test("min-type-size", () => {
  const m = { viewport: { width: 550, height: 300 }, texts: [box({ fontSize: 8 })], strokes: [] }
  expect(rules(base({ manifest: m }))).toContain("min-type-size")
})

test("contrast", () => {
  const m = { viewport: { width: 550, height: 300 }, texts: [box({ color: "rgb(200, 200, 200)" })], strokes: [] }
  expect(rules(base({ manifest: m }))).toContain("contrast")
})

test("no-raw-color", () => {
  expect(rules(base({ source: `<div style="color: #f59e0b">x</div>` }))).toContain("no-raw-color")
  expect(rules(base({ source: `<div style="color: rgb(1,2,3)">x</div>` }))).toContain("no-raw-color")
  expect(rules(base({ source: `<div style="color: var(--accent)">x</div>` }))).toEqual([])
})

test("stroke-floor", () => {
  const m = { viewport: { width: 550, height: 300 }, texts: [box()], strokes: [{ selector: "#p", width: 0.5 }] }
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
  expect(rules(base({ manifest: { viewport: { width: 550, height: 300 }, texts, strokes: [] } }))).toContain("palette")
})

test("provenance: table numbers must trace to data.json", () => {
  const m = { viewport: { width: 550, height: 300 }, texts: [box({ text: "14617" })], strokes: [] }
  const meta = { archetype: "table", caption: "c", alt: "a", claim: "x" }
  expect(rules(base({ meta, data: { rows: [{ v: 14617 }] }, manifest: m }))).toEqual([])
  expect(rules(base({ meta, data: { rows: [{ v: 999 }] }, manifest: m }))).toContain("provenance")
})

test("provenance accepts a cell whose whole text is a string value from data", () => {
  // "5C" is a step label carried straight from data.json — the 5 is not a claim
  const m = { viewport: { width: 550, height: 300 }, texts: [box({ text: "5C" })], strokes: [] }
  const meta = { archetype: "table", caption: "c", alt: "a", claim: "x" }
  expect(rules(base({ meta, data: { rows: [{ step: "5C" }] }, manifest: m }))).toEqual([])
  expect(rules(base({ meta, data: { rows: [{ step: "9C" }] }, manifest: m }))).toContain("provenance")
})

test("provenance sees through thousands separators", () => {
  const m = { viewport: { width: 550, height: 300 }, texts: [box({ text: "14,617" })], strokes: [] }
  const meta = { archetype: "table", caption: "c", alt: "a", claim: "x" }
  expect(rules(base({ meta, data: { rows: [{ v: 14617 }] }, manifest: m }))).toEqual([])
})

test("provenance exempts data-derived nodes", () => {
  const m = { viewport: { width: 550, height: 300 }, texts: [box({ text: "20", derived: true })], strokes: [] }
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
  const m = { viewport: { width: 550, height: 300 }, texts: [box({ fontSize: 6 })], strokes: [] }
  const [err] = lint(base({ manifest: m }))
  expect(err).toEqual({ rule: "min-type-size", selector: "#t", actual: "6px", expected: ">= 9px" })
})
