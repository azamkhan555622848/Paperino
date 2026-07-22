import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  classifyChange,
  compile,
  emittedPdf,
  isPaperWorkspace,
  parseTectonicLog,
  resolveRoot,
  tectonicBinary,
} from "./core"

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

  // The output PDF is named after the root, so the self-retrigger guard must follow it.
  // Hardcoding main.pdf would loop forever on a workspace rooted at paper.tex.
  test("the ignored PDF follows the root", () => {
    const output = () => "paper.pdf"
    expect(classifyChange("paper.pdf", output)).toBe(null)
    // main.pdf is no longer this workspace's output — it is just another PDF, i.e. a source.
    expect(classifyChange("main.pdf", output)).toBe("source")
  })

  test("figure PDFs are still sources", () => {
    expect(classifyChange("figures/method.pdf")).toBe("source")
    expect(classifyChange("figures/fig-jspace/build/fig-jspace.pdf")).toBe("source")
  })

  // papers/ is the full-text shelf: PDFs the ladder fetches or the user drops. A .pdf is
  // otherwise a source (figures are PDFs), so without this rule every fetched paper would
  // look like a manuscript edit and retrigger the compile forever.
  test("fetched papers do not trigger a recompile", () => {
    expect(classifyChange("papers/10.1038_s41586-021-03819-2.pdf")).toBe(null)
    expect(classifyChange("papers\\someones-download.pdf")).toBe(null)
    expect(classifyChange("papers/.index.json")).toBe(null)
  })

  // The guard is anchored at the top level, so a figure that happens to live under a
  // directory named "papers" deeper in the tree is still a source.
  test("the shelf guard is anchored, not a substring match", () => {
    expect(classifyChange("figures/papers/method.pdf")).toBe("source")
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

describe("resolveRoot", () => {
  const DOC = "\\documentclass{article}\\begin{document}x\\end{document}"
  const scratch = () => mkdtempSync(join(tmpdir(), "paperino-root-"))

  test("main.tex is the root, and its PDF is main.pdf", () => {
    const dir = scratch()
    writeFileSync(join(dir, "main.tex"), DOC)
    expect(resolveRoot(dir)).toBe("main.tex")
    expect(emittedPdf(dir)).toBe("main.pdf")
    rmSync(dir, { recursive: true, force: true })
  })

  // The case that motivated this: a project holding BOTH a main.tex and the IEEE submission
  // it was reformatted into. Auto-detection cannot know which one the author cares about, so
  // the panel kept compiling main.tex and the IEEE version was never previewable.
  test("paperino.yaml's root: beats main.tex", () => {
    const dir = scratch()
    writeFileSync(join(dir, "main.tex"), DOC)
    writeFileSync(join(dir, "main-tai-author.tex"), DOC)
    writeFileSync(join(dir, "paperino.yaml"), "title: t\nvenue: ieee\nroot: main-tai-author.tex\n")
    expect(resolveRoot(dir)).toBe("main-tai-author.tex")
    expect(emittedPdf(dir)).toBe("main-tai-author.pdf")
    rmSync(dir, { recursive: true, force: true })
  })

  // Silently compiling main.tex instead would hand the user a preview of a paper they did not
  // ask for and no hint as to why. A missing file is a compile error, and compile errors show.
  test("a root: naming a missing file is surfaced, not quietly replaced by main.tex", () => {
    const dir = scratch()
    writeFileSync(join(dir, "main.tex"), DOC)
    writeFileSync(join(dir, "paperino.yaml"), "root: typo.tex\n")
    expect(resolveRoot(dir)).toBe("typo.tex")
    rmSync(dir, { recursive: true, force: true })
  })

  // An imported submission is usually one paper.tex and no main.tex at all. Before this it
  // was not a paper workspace, so it got an empty panel and no live compile, forever.
  test("a lone \\documentclass file is the root when there is no main.tex", () => {
    const dir = scratch()
    writeFileSync(join(dir, "paper.tex"), DOC)
    writeFileSync(join(dir, "macros.tex"), "\\newcommand{\\eg}{e.g.}")
    expect(resolveRoot(dir)).toBe("paper.tex")
    expect(isPaperWorkspace(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test("two candidate roots is an ambiguity — guess neither, and let the user name one", () => {
    const dir = scratch()
    writeFileSync(join(dir, "paper.tex"), DOC)
    writeFileSync(join(dir, "poster.tex"), DOC)
    expect(resolveRoot(dir)).toBe(null)
    expect(isPaperWorkspace(dir)).toBe(false)

    writeFileSync(join(dir, "paperino.yaml"), "root: poster.tex\n")
    expect(resolveRoot(dir)).toBe("poster.tex")
    rmSync(dir, { recursive: true, force: true })
  })

  test("a commented-out \\documentclass does not make a file a root", () => {
    const dir = scratch()
    writeFileSync(join(dir, "notes.tex"), "% \\documentclass{article} — the old preamble\n")
    expect(resolveRoot(dir)).toBe(null)
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

  // End to end for the configurable root: tectonic names its output after the source, so the
  // panel's PDF and the copy beside the manuscript must both follow the root, not "main".
  test(
    "a paperino.yaml root: is what actually gets compiled",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "paperino-compile-"))
      writeFileSync(join(dir, "main.tex"), "\\documentclass{article}\\begin{document}WRONG\\end{document}")
      writeFileSync(join(dir, "ieee.tex"), "\\documentclass{article}\\begin{document}RIGHT\\end{document}")
      writeFileSync(join(dir, "paperino.yaml"), "root: ieee.tex\n")

      const result = await compile(dir)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.pdfPath).toBe(join(dir, ".paperino", "ieee.pdf"))
        expect(result.emittedPath).toBe(join(dir, "ieee.pdf"))
      }
      expect(existsSync(join(dir, "ieee.pdf"))).toBe(true)
      // The root it was told to ignore was never built.
      expect(existsSync(join(dir, "main.pdf"))).toBe(false)
      rmSync(dir, { recursive: true, force: true })
    },
    180_000,
  )
})

describe("tectonicBinary", () => {
  test("env wins, then the packaged fallback, then PATH", () => {
    const prev = process.env.PAPERINO_TECTONIC
    process.env.PAPERINO_TECTONIC = "C:/explicit/tectonic.exe"
    expect(tectonicBinary()).toBe("C:/explicit/tectonic.exe")

    delete process.env.PAPERINO_TECTONIC
    // A packaged build ships Tectonic in resources; an end user has no `tectonic` on PATH.
    expect(tectonicBinary("C:\\app\\resources\\paperino")).toBe(
      "C:/app/resources/paperino/bin/tectonic/tectonic.exe",
    )
    expect(tectonicBinary()).toBe("tectonic")

    if (prev !== undefined) process.env.PAPERINO_TECTONIC = prev
  })
})
