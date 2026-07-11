import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { classifyChange, compile, isPaperWorkspace, parseTectonicLog } from "./core"

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

  // Real tectonic output: \input{sections/02-introduction} is reported without the .tex extension
  test("extracts extensionless \\input paths", () => {
    const errors = parseTectonicLog("error: sections/02-introduction:2: Undefined control sequence")
    expect(errors[0]).toEqual({
      file: "sections/02-introduction",
      line: 2,
      message: "Undefined control sequence",
    })
  })

  test("errors without file:line still produce an entry", () => {
    const errors = parseTectonicLog('error: could not open "missing.tex"')
    expect(errors.length).toBe(1)
    expect(errors[0].line).toBe(null)
    expect(errors[0].file).toBe("main.tex")
  })

  test("clean log produces no errors", () => {
    expect(parseTectonicLog("note: Running TeX ...\nnote: writing main.pdf")).toEqual([])
  })
})

describe("classifyChange", () => {
  test("manuscript sources trigger a recompile", () => {
    expect(classifyChange("main.tex")).toBe("source")
    expect(classifyChange("sections\\02-introduction.tex")).toBe("source")
    expect(classifyChange("references.bib")).toBe("source")
    expect(classifyChange("paperino.yaml")).toBe("source")
    expect(classifyChange("figures/method.png")).toBe("source")
  })

  test("the agent-written preview.pdf is previewed, not compiled", () => {
    expect(classifyChange(".paperino/preview.pdf")).toBe("preview")
    expect(classifyChange(".paperino\\preview.pdf")).toBe("preview")
  })

  test("the rest of the build output is ignored, so compiling cannot retrigger itself", () => {
    expect(classifyChange(".paperino/main.pdf")).toBe(null)
    expect(classifyChange(".paperino/compile.log")).toBe(null)
    expect(classifyChange(".paperino/main.log")).toBe(null)
  })

  test("the emitted main.pdf does not retrigger the compile that wrote it", () => {
    // compile() now writes the PDF next to main.tex, where the user actually opens it.
    // A .pdf is otherwise a source (Figure Studio emits figures as PDFs), so without
    // this rule the copy would look like a source edit and compile forever.
    expect(classifyChange("main.pdf")).toBe(null)
    expect(classifyChange(".\\main.pdf")).toBe(null)
  })

  test("figure PDFs are still sources", () => {
    expect(classifyChange("figures/method.pdf")).toBe("source")
    expect(classifyChange("figures/fig-jspace/build/fig-jspace.pdf")).toBe("source")
  })

  test("unrelated files are ignored", () => {
    expect(classifyChange("notes.md")).toBe(null)
    expect(classifyChange("src/main.py")).toBe(null)
  })
})

describe("isPaperWorkspace", () => {
  test("true for the fixture, false for a non-workspace dir", () => {
    expect(isPaperWorkspace(FIXTURE)).toBe(true)
    expect(isPaperWorkspace(PAPERINO_ROOT)).toBe(false)
    expect(isPaperWorkspace(join(PAPERINO_ROOT, "fixtures", "plain-project"))).toBe(false)
  })

  // A LaTeX project that predates /new-paper has no paperino.yaml. It still gets a live preview:
  // requiring the marker file left such projects staring at an empty panel forever.
  test("a main.tex with no paperino.yaml is still a paper workspace", () => {
    const dir = mkdtempSync(join(tmpdir(), "paperino-test-"))
    expect(isPaperWorkspace(dir)).toBe(false)
    writeFileSync(join(dir, "main.tex"), "\\documentclass{article}\\begin{document}x\\end{document}")
    expect(isPaperWorkspace(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
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

  test(
    "the compiled PDF also lands next to main.tex, where the user opens it",
    async () => {
      const emitted = join(FIXTURE, "main.pdf")
      rmSync(emitted, { force: true })

      const result = await compile(FIXTURE)
      expect(result.ok).toBe(true)

      // The whole point of the bug: the panel showed a fresh paper while main.pdf in the
      // folder stayed months stale, because the output only ever went to .paperino/.
      expect(existsSync(emitted)).toBe(true)
      expect(readFileSync(emitted)).toEqual(readFileSync(join(FIXTURE, ".paperino", "main.pdf")))
    },
    180_000,
  )
})
