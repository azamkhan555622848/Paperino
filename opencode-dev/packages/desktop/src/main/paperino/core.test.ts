import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { compile, isPaperWorkspace, parseTectonicLog } from "./core"

// core.test.ts lives at Paperino/opencode-dev/packages/desktop/src/main/paperino/
const PAPERINO_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..", "..")
const FIXTURE = join(PAPERINO_ROOT, "fixtures", "demo-paper")
process.env.PAPERINO_TECTONIC = join(PAPERINO_ROOT, "tools", "tectonic", "tectonic.exe")

describe("parseTectonicLog", () => {
  test("extracts file, line and message from tectonic error lines", () => {
    const log = [
      "note: connecting to https://relay.fullyjustified.net",
      "error: sections/02-introduction.tex:3: Undefined control sequence.",
      "error: halted on potentially-recoverable error as specified",
    ].join("\n")
    const errors = parseTectonicLog(log)
    expect(errors[0]).toEqual({
      file: "sections/02-introduction.tex",
      line: 3,
      message: "Undefined control sequence.",
    })
  })

  test("errors without file:line still produce an entry", () => {
    const errors = parseTectonicLog('error: could not open "missing.tex"')
    expect(errors.length).toBe(1)
    expect(errors[0].line).toBe(null)
  })

  test("clean log produces no errors", () => {
    expect(parseTectonicLog("note: Running TeX ...\nnote: writing main.pdf")).toEqual([])
  })
})

describe("isPaperWorkspace", () => {
  test("true for the fixture, false for a non-workspace dir", () => {
    expect(isPaperWorkspace(FIXTURE)).toBe(true)
    expect(isPaperWorkspace(PAPERINO_ROOT)).toBe(false)
  })
})

describe("compile (integration, needs tectonic + network on first run)", () => {
  test(
    "fixture compiles to .paperino/main.pdf and writes compile.log",
    async () => {
      const result = await compile(FIXTURE)
      expect(result.ok).toBe(true)
      if (result.ok) expect(existsSync(result.pdfPath)).toBe(true)
      expect(existsSync(join(FIXTURE, ".paperino", "compile.log"))).toBe(true)
    },
    180_000,
  )
})
