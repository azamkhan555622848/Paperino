import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The module cannot be imported from bun, so these are source-level guards. They exist
// because each thing they check fails SILENTLY at runtime: a figure with the wrong
// svg.fonttype renders perfectly and lints perfectly, having measured nothing at all.
// test/render.test.ts proves the behaviour end to end; this catches the edit that breaks it.
const src = readFileSync(join(import.meta.dir, "..", "src", "assets", "paperino_mpl.py"), "utf8")

describe("paperino_mpl.py", () => {
  test("owns the two rcParams whose absence is silent and fatal", () => {
    // "path" (the default) outlines text into <path>, so the manifest walker finds no text
    // nodes and every text rule — provenance included — passes vacuously.
    expect(src).toContain('"svg.fonttype": "none"')
    // Type 3 is rejected outright by IEEE, ACM and Elsevier.
    expect(src).toContain('"pdf.fonttype": 42')
  })

  test("carries a version marker on line 1 so scaffold can refresh it", () => {
    expect(src.split("\n", 1)[0]).toMatch(/^# paperino-mpl v\d+\.\d+$/)
  })

  test("names the font face exactly as the font file spells it", () => {
    // matplotlib normalizes font.family to the name inside the file, so this must be the
    // spaced spelling that tokens.css also declares. A mismatch means Chromium silently
    // substitutes a system serif: wrong glyphs and a rule 13 failure, no error between.
    expect(src).toContain('"TeX Gyre Termes"')
    // Comments are stripped first — the module's own comment names the wrong spelling on
    // purpose, to warn against it. What must not appear is the spaceless form in CODE.
    const code = src
      .split("\n")
      .map((line) => line.replace(/#.*$/, ""))
      .join("\n")
    expect(code).not.toContain("TeXGyreTermes")
  })

  test("registers OTF as well as TTF, since Termes ships as CFF outlines", () => {
    expect(src).toContain('".otf"')
  })

  test("reads data.json as utf-8-sig so a BOM is not a decode error", () => {
    expect(src).toContain('encoding="utf-8-sig"')
  })

  test("no font size drops below the 7pt floor lint rule 3 enforces", () => {
    const sizes = Array.from(
      src.matchAll(/"(?:font|axes\.label|axes\.title|[xy]tick\.label|legend\.font)size":\s*([\d.]+)/g),
    )
    expect(sizes.length).toBeGreaterThan(3)
    for (const m of sizes) expect(Number(m[1])).toBeGreaterThanOrEqual(7)
  })

  test("no stroke width drops below the 0.5pt that maps past lint rule 6's 0.75px floor", () => {
    const widths = Array.from(
      src.matchAll(
        /"(?:axes\.linewidth|[xy]tick\.(?:major|minor)\.width|grid\.linewidth|lines\.linewidth)":\s*([\d.]+)/g,
      ),
    )
    expect(widths.length).toBeGreaterThan(2)
    for (const m of widths) expect(Number(m[1])).toBeGreaterThanOrEqual(0.5)
  })

  test("the palette is the tokens.css ink, so the two engines cannot drift", () => {
    for (const hex of ["#111111", "#555555", "#999999", "#1a4f9c", "#b03a2e"]) expect(src).toContain(hex)
  })

  test("the default aspect knows how many panels it is dividing", () => {
    // A single flat factor gave a 2.4:1 letterbox on a full-width single-panel figure.
    expect(src).toMatch(/0\.60 if panels == 1 else 0\.40/)
  })
})
