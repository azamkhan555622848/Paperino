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

/** An mpl figure: source is figure.py, and the venue face is Termes. */
const mpl = (over: Partial<LintInput> = {}): LintInput => ({
  source: "from paperino_mpl import ACCENT, data, figure, save\n",
  meta: { archetype: "chart", engine: "mpl", caption: "c", alt: "a", claim: "x" },
  data: { values: [3.7] },
  allowedFaces: ["KaTeX_", "TeX Gyre Termes"],
  manifest: { viewport: { width: 528, height: 300 }, texts: [], strokes: [], elements: [] },
  ...over,
})

test("rule 8 still fires on a matplotlib label that invents a number", () => {
  // The whole point of a second engine passing through the same lint. An engine that
  // escaped provenance would be a downgrade however good its output looked.
  const { errors } = lint(
    mpl({
      manifest: {
        viewport: { width: 528, height: 300 },
        texts: [box({ text: "9.9x faster", fontFamily: '"TeX Gyre Termes", serif' })],
        strokes: [],
        elements: [],
      },
    }),
  )
  expect(errors.some((e) => e.rule === "provenance" && e.actual === "9.9")).toBe(true)
})

test("rule 8 passes when the matplotlib label traces to data.json", () => {
  const { errors } = lint(
    mpl({
      data: { speedup: 9.9 },
      manifest: {
        viewport: { width: 528, height: 300 },
        texts: [box({ text: "9.9x faster", fontFamily: '"TeX Gyre Termes", serif' })],
        strokes: [],
        elements: [],
      },
    }),
  )
  expect(errors.some((e) => e.rule === "provenance")).toBe(false)
})

test("rule 9 does not fire on matplotlib's own root svg", () => {
  // It carries a viewBox AND pt dimensions, and no human wrote it — failing here would be
  // an error the author cannot fix.
  const { errors } = lint(mpl({ source: '<svg width="516pt" height="216pt" viewBox="0 0 516 216">' }))
  expect(errors.some((e) => e.rule === "root-svg")).toBe(false)
})

test("rule 9 still fires on authored html markup", () => {
  const { errors } = lint(base({ source: '<svg width="100" height="50">' }))
  expect(errors.some((e) => e.rule === "root-svg")).toBe(true)
})

test("rule 13 narrows to the venue face and still catches a silent fallback", () => {
  const withFace = (fontFamily: string) =>
    mpl({ manifest: { viewport: { width: 528, height: 300 }, texts: [box({ fontFamily })], strokes: [], elements: [] } })
  expect(lint(withFace('"TeX Gyre Termes", serif')).errors.some((e) => e.rule === "font-allowlist")).toBe(false)
  expect(lint(withFace('"DejaVu Serif", serif')).errors.some((e) => e.rule === "font-allowlist")).toBe(true)
  // A Computer Modern paper must reject Termes, or a figure mismatches its own caption.
  const cmOnly = withFace('"TeX Gyre Termes", serif')
  cmOnly.allowedFaces = ["KaTeX_"]
  expect(lint(cmOnly).errors.some((e) => e.rule === "font-allowlist")).toBe(true)
})

/** Manifest helper for the v2 rules — keeps the new tests readable. */
const mf = (over: Partial<LintInput["manifest"]> = {}): LintInput["manifest"] => ({
  viewport: { width: 528, height: 300 },
  texts: [box()],
  strokes: [],
  elements: [],
  ...over,
})

const rules = (input: LintInput) => lint(input).errors.map((e) => e.rule)

test("clean input passes all rules", () => expect(lint(base()).errors).toEqual([]))

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

// Rule 8 used to be gated to chart|table. A fabricated number reaches the paper just as
// readily through a schematic node label, so it now runs on every archetype.
test("provenance runs on schematic and gallery, not just chart and table", () => {
  const m = mf({ texts: [box({ text: "512 experts" })] })
  for (const archetype of ["schematic", "gallery", "chart", "table"]) {
    const meta = { archetype, caption: "c", alt: "a", claim: "x" }
    expect(rules(base({ meta, data: { experts: 999 }, manifest: m }))).toContain("provenance")
    expect(rules(base({ meta, data: { experts: 512 }, manifest: m }))).toEqual([])
  }
})

// Names are most of the ink in a schematic. Digits inside one are notation, not a claim —
// the tell is a letter BEFORE the digits, optionally across a hyphen.
test("provenance exempts digits that belong to a name", () => {
  const meta = { archetype: "schematic", caption: "c", alt: "a", claim: "x" }
  for (const text of ["ResNet-50", "GPT-2", "conv3", "Top-5 error", "a 3x3 conv on ResNet-50"]) {
    const m = mf({ texts: [box({ text })] })
    // "3x3" leads with a bare 3, so seed it; every other digit here rides a name.
    expect(rules(base({ meta, data: { kernel: 3 }, manifest: m }))).toEqual([])
  }
})

// ...but a letter AFTER the digits is a unit, not a name. A value wearing a unit is exactly
// what this rule exists to catch.
test("provenance does not exempt a value wearing a unit", () => {
  const meta = { archetype: "schematic", caption: "c", alt: "a", claim: "x" }
  for (const text of ["12ms", "50%", "3.2x speedup"]) {
    const m = mf({ texts: [box({ text })] })
    expect(rules(base({ meta, data: { unrelated: 7 }, manifest: m }))).toContain("provenance")
  }
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
  const [err] = lint(base({ manifest: m })).errors
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

// ---- v4 geometry rules 14-17 and the declared-intent escape (spec 2026-07-30) ----
//
// All thirteen earlier rules police INK — a glyph or a stroke in isolation. None asks where
// it landed relative to anything else, which is how an arrow through a text block, arrows
// ending in empty gutters and a legend for absent marks all shipped under
// `{"passed": true, "errors": []}`.

const emptyManifest = {
  viewport: { width: 528, height: 300 },
  texts: [] as any[],
  strokes: [] as any[],
  elements: [] as any[],
  paths: [] as any[],
  nodes: [] as any[],
  legend: [] as any[],
  intents: [] as any[],
  findings: [] as any[],
}
const baseInput = {
  source: "<div></div>",
  meta: { archetype: "schematic", caption: "c", alt: "a", claim: "k" },
  data: {},
  manifest: emptyManifest,
}
const ok = (o: object): LintInput => ({ ...baseInput, ...o })

const textBox = (selector: string, text: string) => ({
  selector,
  text,
  rect: { x: 10, y: 10, w: 80, h: 12 },
  fontSize: 12,
  color: "rgb(20, 20, 20)",
  background: "rgb(255, 255, 255)",
  derived: false,
  fontFamily: "KaTeX_Main",
  inKatex: false,
})

test("14 stroke-over-text fails an arrow crossing a glyph", () => {
  const text = { ...textBox("#label", "Reconstruction-distortion profiles"), rect: { x: 100, y: 100, w: 120, h: 12 } }
  const input = ok({
    manifest: {
      ...emptyManifest,
      texts: [text],
      paths: [{ selector: "#annot-overlay > path", points: [[80, 106], [240, 106]], width: 1, kind: "edge" }],
    },
  })
  expect(lint(input).errors.map((e) => e.rule)).toContain("stroke-over-text")
})

test("14 permits a declared strikethrough", () => {
  const text = { ...textBox("#label", "old value"), rect: { x: 100, y: 100, w: 60, h: 12 } }
  const result = lint(
    ok({
      manifest: {
        ...emptyManifest,
        texts: [text],
        paths: [{ selector: "#strike", points: [[95, 106], [165, 106]], width: 1, kind: "edge" }],
        intents: [{ selector: "#strike", reason: "struck-through superseded value" }],
      },
    }),
  )
  expect(result.errors.map((e) => e.rule)).not.toContain("stroke-over-text")
  // ONE data-intent waives every escapable rule that path trips, and EVERY waiver is
  // reported. This manifest declares no [data-node] at all, so the same stroke is also a
  // rule-15 dangling edge; handing figure_review the complete list is the safeguard, so
  // reporting only the first waiver would hide one. Recorded once per (rule, selector) —
  // two dangling endpoints on one path is one waiver, not two.
  expect(result.exemptions).toEqual([
    { rule: "stroke-over-text", selector: "#strike", reason: "struck-through superseded value" },
    { rule: "dangling-edge", selector: "#strike", reason: "struck-through superseded value" },
  ])
})

test("15 dangling-edge fails an endpoint attached to nothing, but not a leader", () => {
  const node = { selector: "#a", rect: { x: 0, y: 0, w: 50, h: 50 }, hasText: true, intent: null }
  const edge = { selector: "#e", points: [[50, 25], [300, 25]], width: 1, kind: "edge" }
  expect(lint(ok({ manifest: { ...emptyManifest, nodes: [node], paths: [edge] } })).errors.map((e) => e.rule)).toContain(
    "dangling-edge",
  )
  const leader = { ...edge, kind: "leader" }
  expect(
    lint(ok({ manifest: { ...emptyManifest, nodes: [node], paths: [leader] } })).errors.map((e) => e.rule),
  ).not.toContain("dangling-edge")
})

test("16 empty-node fails a bordered box with no text, unless declared", () => {
  const ghost = { selector: "#port", rect: { x: 0, y: 0, w: 40, h: 40 }, hasText: false, intent: null }
  expect(lint(ok({ manifest: { ...emptyManifest, nodes: [ghost] } })).errors.map((e) => e.rule)).toContain("empty-node")
  // Under 100px^2 is a rule/tick, not a node.
  const tick = { ...ghost, rect: { x: 0, y: 0, w: 9, h: 9 } }
  expect(lint(ok({ manifest: { ...emptyManifest, nodes: [tick] } })).errors.map((e) => e.rule)).not.toContain("empty-node")
  const declared = { ...ghost, intent: "unfilled slot" }
  expect(lint(ok({ manifest: { ...emptyManifest, nodes: [declared] } })).errors.map((e) => e.rule)).not.toContain(
    "empty-node",
  )
})

test("17 orphan-legend fails a swatch matching no real mark", () => {
  const legend = [
    { selector: "#sw1", style: "rgb(0,0,255)|solid|rgba(0, 0, 0, 0)", inLegend: true },
    { selector: "#mark1", style: "rgb(0,0,255)|solid|rgba(0, 0, 0, 0)", inLegend: false },
    { selector: "#sw2", style: "rgb(200,0,0)|dashed|rgba(0, 0, 0, 0)", inLegend: true },
  ]
  const found = lint(ok({ manifest: { ...emptyManifest, legend } })).errors
  expect(found.filter((e) => e.rule === "orphan-legend").map((e) => e.selector)).toEqual(["#sw2"])
})

test("router findings become lint errors", () => {
  const findings = [{ rule: "edge-unroutable", selector: "#a -> #b", blocked: ["#c"] }]
  expect(lint(ok({ manifest: { ...emptyManifest, findings } })).errors.map((e) => e.rule)).toContain("edge-unroutable")
})

test("intent-not-permitted fires when an absolute rule is waived", () => {
  // 6px is below the 7pt floor. data-intent must not buy an exemption from it.
  const tiny = { ...textBox("#tiny", "x"), fontSize: 6 }
  const result = lint(
    ok({ manifest: { ...emptyManifest, texts: [tiny], intents: [{ selector: "#tiny", reason: "looks nicer" }] } }),
  )
  expect(result.errors.map((e) => e.rule)).toContain("min-type-size")
  expect(result.errors.map((e) => e.rule)).toContain("intent-not-permitted")
  // ...and the waiver buys nothing: the absolute rule is still reported, and nothing lands
  // in `exemptions` to make it look honoured.
  expect(result.exemptions).toEqual([])
})

// One per absolute rule: the hard line has to hold across all four, not only the one that
// was convenient to construct.
test("intent-not-permitted covers overflow, provenance and font-allowlist too", () => {
  const at = (t: object) => {
    const box = { ...textBox("#x", "hello"), ...t }
    return lint(ok({ manifest: { ...emptyManifest, texts: [box], intents: [{ selector: "#x", reason: "i meant it" }] } }))
      .errors.map((e) => e.rule)
  }
  expect(at({ rect: { x: 540, y: 10, w: 50, h: 14 } })).toEqual(expect.arrayContaining(["overflow", "intent-not-permitted"]))
  expect(at({ text: "512 experts" })).toEqual(expect.arrayContaining(["provenance", "intent-not-permitted"]))
  expect(at({ fontFamily: '"Segoe UI", sans-serif' })).toEqual(
    expect.arrayContaining(["font-allowlist", "intent-not-permitted"]),
  )
})

test("7 palette and 12 web-chrome accept a declared intent", () => {
  const six = ["255,0,0", "0,0,255", "0,128,0", "255,128,0", "128,0,255", "0,160,160"].map((c, i) => ({
    ...textBox(`#c${i}`, "x"),
    color: `rgb(${c})`,
  }))
  const declared = lint(
    ok({ manifest: { ...emptyManifest, texts: six, intents: [{ selector: "figure", reason: "six ablation conditions" }] } }),
  )
  expect(declared.errors.map((e) => e.rule)).not.toContain("palette")
  // ...and undeclared, the cap still holds.
  expect(lint(ok({ manifest: { ...emptyManifest, texts: six } })).errors.map((e) => e.rule)).toContain("palette")

  const radius = { selector: "#blk", borderRadius: 8, boxShadow: "none" }
  expect(
    lint(ok({ manifest: { ...emptyManifest, elements: [radius], intents: [{ selector: "#blk", reason: "rounded architecture blocks" }] } }))
      .errors.map((e) => e.rule),
  ).not.toContain("web-chrome")
})

test("a box-shadow can never be waived", () => {
  const result = lint(
    ok({
      manifest: {
        ...emptyManifest,
        elements: [{ selector: "#card", borderRadius: 0, boxShadow: "rgba(0,0,0,0.2) 0px 2px 6px" }],
        intents: [{ selector: "#card", reason: "depth" }],
      },
    }),
  )
  expect(result.errors.map((e) => e.rule)).toContain("web-chrome")
  expect(result.errors.map((e) => e.rule)).toContain("intent-not-permitted")
  expect(result.exemptions).toEqual([])
})

test("meta.fonts is an input to rule 13, not an escape from it", () => {
  const withFace = (fontFamily: string, fonts?: string[]) =>
    lint({
      ...baseInput,
      meta: { ...baseInput.meta, ...(fonts ? { fonts } : {}) },
      manifest: { ...emptyManifest, texts: [{ ...textBox("#t", "x"), fontFamily }] },
    } as LintInput).errors.map((e) => e.rule)
  expect(withFace('"Inconsolata", monospace')).toContain("font-allowlist")
  expect(withFace('"Inconsolata", monospace', ["Inconsolata"])).not.toContain("font-allowlist")
  // A declared face does not license every OTHER face: the rule still catches a silent
  // fallback, which is the whole reason it exists.
  expect(withFace('"Segoe UI", sans-serif', ["Inconsolata"])).toContain("font-allowlist")
})

test("passed is false exactly when errors is non-empty", () => {
  expect(lint(ok({})).passed).toBe(true)
  expect(lint(ok({ manifest: { ...emptyManifest, findings: [{ rule: "edge-degenerate", selector: "#a -> #b", blocked: [] }] } })).passed).toBe(false)
})

// ---------------------------------------------------------------------------------------
// Defects the v4 rule audit confirmed. Each of these passed lint before the fix, which is
// exactly the failure mode the whole subsystem exists to prevent: a rule that reports clean
// on the figure it was written for.
// ---------------------------------------------------------------------------------------

test("13 an empty entry in meta.fonts cannot switch the allowlist off", () => {
  // `"".startsWith("")` is true for EVERY face, so one blank list item disabled rule 13
  // entirely — an off switch on an ABSOLUTE rule, reachable by leaving a YAML item empty.
  const segoe = box({ fontFamily: '"Segoe UI", sans-serif' })
  const { errors } = lint(
    base({
      meta: { archetype: "schematic", caption: "c", alt: "a", claim: "x", fonts: ["", "   "] },
      manifest: { viewport: { width: 528, height: 300 }, texts: [segoe], strokes: [], elements: [] },
    }),
  )
  expect(errors.map((e) => e.rule)).toContain("font-allowlist")
})

test("13 a genuinely declared face is still accepted", () => {
  const inter = box({ fontFamily: '"Inter", sans-serif' })
  const { errors } = lint(
    base({
      meta: { archetype: "schematic", caption: "c", alt: "a", claim: "x", fonts: ["Inter"] },
      manifest: { viewport: { width: 528, height: 300 }, texts: [inter], strokes: [], elements: [] },
    }),
  )
  expect(errors.map((e) => e.rule)).not.toContain("font-allowlist")
})

test("a hand-written katex class is forgery, not markup", () => {
  // inKatex buys exemption from provenance, the 7pt floor and overlap. KaTeX injects its
  // classes at runtime, so an author never writes one — `class="katex"` around plain text
  // was a route around rule 8.
  const { errors } = lint(base({ source: `<div class="katex">512 experts</div>` }))
  expect(errors.map((e) => e.rule)).toContain("forged-katex")
})

test("14 a stroke through a FORMULA is a crossing like any other", () => {
  // Rules 1/3/8 exempt KaTeX because its layout engine positions glyph boxes relative to
  // each other — that is about a formula's internals. Rule 14 exempting math meant that,
  // since rule 11 forces every symbol into a .math span, the commonest form of the defect
  // rule 14 exists for was invisible.
  const formula = { ...textBox("#f", "D"), rect: { x: 100, y: 100, w: 40, h: 12 }, inKatex: true }
  const { errors } = lint(
    ok({
      manifest: {
        ...emptyManifest,
        texts: [formula],
        paths: [{ selector: "#p", points: [[80, 106], [200, 106]], width: 1, kind: "edge", endpoints: [] }],
      },
    }),
  )
  expect(errors.map((e) => e.rule)).toContain("stroke-over-text")
})

test("14 does not fail an edge for crossing its OWN anchor glyphs", () => {
  // The false positive that would have blocked Task 8. An ink-anchored tail starts ON its
  // node's text edge, so the corridor always overlaps that text. The router excludes both
  // endpoint elements; lint has to make the same exclusion or every correct arrow from a
  // borderless node reports crossing the label it is attached to.
  const anchorText = { ...textBox("#evidence > strong", "Distortion profiles"), rect: { x: 100, y: 100, w: 90, h: 12 }, node: "#evidence" }
  const { errors } = lint(
    ok({
      manifest: {
        ...emptyManifest,
        texts: [anchorText],
        nodes: [{ selector: "#evidence", rect: { x: 100, y: 100, w: 90, h: 12 }, hasText: true, intent: null }],
        paths: [
          { selector: "#p", points: [[190, 106], [400, 106]], width: 1, kind: "edge", endpoints: ["#evidence", "#sink"] },
        ],
      },
    }),
  )
  expect(errors.map((e) => e.rule)).not.toContain("stroke-over-text")
})

test("14 still fails that same edge when it crosses a DIFFERENT node's text", () => {
  const own = { ...textBox("#evidence > strong", "Distortion"), rect: { x: 100, y: 100, w: 90, h: 12 }, node: "#evidence" }
  const other = { ...textBox("#mid > strong", "Channel scores"), rect: { x: 240, y: 100, w: 90, h: 12 }, node: "#mid" }
  const { errors } = lint(
    ok({
      manifest: {
        ...emptyManifest,
        texts: [own, other],
        paths: [
          { selector: "#p", points: [[190, 106], [400, 106]], width: 1, kind: "edge", endpoints: ["#evidence", "#sink"] },
        ],
      },
    }),
  )
  expect(errors.map((e) => e.rule)).toContain("stroke-over-text")
})

test("14 a dimension line across a label is still a crossing", () => {
  // kind === "dimension" used to skip rule 14 wholesale. dimension() draws at max(bottom)+gap,
  // i.e. into the next row, so it can land straight through the label below it.
  const label = { ...textBox("#l", "Latency budget"), rect: { x: 100, y: 100, w: 120, h: 12 } }
  const { errors } = lint(
    ok({
      manifest: {
        ...emptyManifest,
        texts: [label],
        paths: [{ selector: "#d", points: [[60, 106], [300, 106]], width: 1, kind: "dimension", endpoints: [] }],
      },
    }),
  )
  expect(errors.map((e) => e.rule)).toContain("stroke-over-text")
})

test("14 and 15 do not run on the mpl engine", () => {
  // matplotlib positions its own strokes and labels, and its spines sit within a few px of
  // every tick label by design — the same reasoning that exempts mpl from rule 9. Running
  // these there would fail every chart.
  const label = { ...textBox("#l", "8"), rect: { x: 100, y: 100, w: 10, h: 12 }, fontFamily: '"TeX Gyre Termes", serif' }
  const { errors } = lint(
    mpl({
      manifest: {
        ...emptyManifest,
        texts: [label],
        paths: [{ selector: "#spine", points: [[60, 106], [300, 106]], width: 1, kind: "edge", endpoints: [] }],
      },
    }),
  )
  expect(errors.map((e) => e.rule)).not.toContain("stroke-over-text")
  expect(errors.map((e) => e.rule)).not.toContain("dangling-edge")
})
