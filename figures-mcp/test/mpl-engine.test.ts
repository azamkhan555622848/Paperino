import { describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { findPython, runMpl } from "../src/engines/mpl"

const ASSETS = join(import.meta.dir, "..", "src", "assets")

/** A workspace with the vendored module and fonts in place, as scaffold would leave it. */
const workspace = (figurePy: string) => {
  const dir = join(import.meta.dir, `tmp-mpl-${Math.random().toString(36).slice(2)}`)
  const figureDir = join(dir, "figures", "demo")
  mkdirSync(figureDir, { recursive: true })
  cpSync(join(ASSETS, "paperino_mpl.py"), join(dir, "figures", "paperino_mpl.py"))
  cpSync(join(ASSETS, "fonts"), join(dir, "figures", "fonts"), { recursive: true })
  writeFileSync(join(figureDir, "data.json"), JSON.stringify({ x: [1, 2], y: [3, 4] }))
  writeFileSync(join(figureDir, "figure.py"), figurePy)
  return { dir, figureDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe("mpl engine", () => {
  test("findPython returns an absolute path or null, never a bare name", () => {
    const found = findPython()
    // A bare `python` on PATH could be any interpreter on the machine; resolving to one
    // would surface as a missing-matplotlib error rather than as the mis-resolution it is.
    if (found !== null) expect(found).toMatch(/[\\/]/)
  })

  test("a missing interpreter is reported as setup, and never as an impossible chart", async () => {
    const ws = workspace("pass\n")
    const result = await runMpl({ workspace: ws.dir, figureDir: ws.figureDir, name: "demo", python: null })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("needs setup")
      // Product rule 3's sibling: never report a capability as absent when a path remains.
      expect(result.error).toContain("engine=html")
    }
    ws.cleanup()
  })

  test.skipIf(findPython() === null)(
    "a figure.py that raises returns the traceback verbatim, not a generic failure",
    async () => {
      const ws = workspace("raise ValueError('deliberate')\n")
      const result = await runMpl({ workspace: ws.dir, figureDir: ws.figureDir, name: "demo" })
      expect(result.ok).toBe(false)
      // Verbatim, because the traceback names the line the agent has to patch.
      if (!result.ok) {
        expect(result.error).toContain("ValueError")
        expect(result.error).toContain("deliberate")
      }
      ws.cleanup()
    },
    60_000,
  )

  test.skipIf(findPython() === null)(
    "a figure.py that forgets save() is told so, rather than failing downstream",
    async () => {
      const ws = workspace("from paperino_mpl import figure\nfig, (ax,) = figure('full')\n")
      const result = await runMpl({ workspace: ws.dir, figureDir: ws.figureDir, name: "demo" })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain("save(fig)")
      ws.cleanup()
    },
    60_000,
  )

  test.skipIf(findPython() === null)(
    "a working figure writes the SVG the measurement stage reads",
    async () => {
      const ws = workspace(
        [
          "from paperino_mpl import ACCENT, data, figure, save",
          "d = data()",
          "fig, (ax,) = figure('full')",
          "ax.plot(d['x'], d['y'], marker='o', color=ACCENT)",
          "save(fig)",
        ].join("\n"),
      )
      const result = await runMpl({ workspace: ws.dir, figureDir: ws.figureDir, name: "demo" })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(existsSync(result.svg)).toBe(true)
        // All three artifacts, since LaTeX includes the PDF and review looks at the PNG.
        expect(existsSync(join(ws.figureDir, "build", "demo.pdf"))).toBe(true)
        expect(existsSync(join(ws.figureDir, "build", "demo.png"))).toBe(true)
      }
      ws.cleanup()
    },
    60_000,
  )
})
