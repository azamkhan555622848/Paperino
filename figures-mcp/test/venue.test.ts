import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { resolveVenue } from "../src/venue"

const ws = (yaml?: string) => {
  const dir = join(tmpdir(), `venue-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  if (yaml !== undefined) writeFileSync(join(dir, "paperino.yaml"), yaml)
  return dir
}

describe("resolveVenue", () => {
  test("no paperino.yaml falls back to neurips, preserving today's 312/528px", () => {
    const dir = ws()
    const v = resolveVenue(dir)
    expect(v.id).toBe("neurips")
    expect(v.px).toEqual({ narrow: 312, full: 528 })
    rmSync(dir, { recursive: true, force: true })
  })

  // The spaces are load-bearing. matplotlib normalizes font.family to the name inside the
  // font file, so it emits 'TeX Gyre Termes' no matter what you ask for; tokens.css and the
  // lint allowlist have to agree with THAT, or Chromium falls back to a system serif.
  test("ieee is Times-metric with STIX math and two-column widths", () => {
    const dir = ws("venue: ieee\n")
    const v = resolveVenue(dir)
    expect(v.textFace).toBe("TeX Gyre Termes")
    expect(v.mathFontset).toBe("stix")
    expect(v.inches).toEqual({ narrow: 3.5, full: 7.16 })
    expect(v.px).toEqual({ narrow: 336, full: 687 })
    rmSync(dir, { recursive: true, force: true })
  })

  test("article keeps Computer Modern and cm math", () => {
    const dir = ws("venue: article\n")
    const v = resolveVenue(dir)
    expect(v.textFace).toBe("KaTeX_Main")
    expect(v.mathFontset).toBe("cm")
    rmSync(dir, { recursive: true, force: true })
  })

  test("an unknown venue falls back to neurips rather than throwing", () => {
    const dir = ws("venue: nature\n")
    expect(resolveVenue(dir).id).toBe("neurips")
    rmSync(dir, { recursive: true, force: true })
  })

  test("a malformed paperino.yaml does not break figure rendering", () => {
    const dir = ws("venue: [unclosed\n  broken: :\n")
    expect(resolveVenue(dir).id).toBe("neurips")
    rmSync(dir, { recursive: true, force: true })
  })
})
