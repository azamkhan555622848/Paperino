import { expect, test } from "bun:test"

test("the mpl template uses only the module's sanctioned surface", () => {
  const py = readFileSync(join(import.meta.dir, "..", "src", "templates", "chart-mpl", "figure.py"), "utf8")
  expect(py).toContain("from paperino_mpl import")
  // Prose is stripped first: the template's own docstring names these on purpose, to warn
  // against them. What must not appear is a call in CODE.
  const code = py
    .replace(/^"""[\s\S]*?"""/, "")
    .split("\n")
    .map((line) => line.replace(/#.*$/, ""))
    .join("\n")
  // Each fails silently if an author reaches past the module: an rcParams override can undo
  // svg.fonttype, and a direct savefig skips the print-true size entirely.
  expect(code).not.toMatch(/rcParams/)
  expect(code).not.toMatch(/savefig/)
  // A raw hex here is lint rule 5.
  expect(code).not.toMatch(/#[0-9a-fA-F]{6}\b/)
})

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse } from "yaml"
import { scaffold } from "../src/scaffold"
import { render } from "../src/render"
import { lint } from "../src/lint"

// The contract this file defends: a freshly scaffolded figure of ANY archetype renders
// and passes all 13 rules with no edits. If a template ships web chrome, a UI font, or
// pseudo-math, the agent inherits it — the template IS the lesson.
const DATA: Record<string, any> = {
  schematic: {},
  gallery: { items: [{ title: "Case A", body: "shared head" }, { title: "Case B", body: "per-channel" }] },
  chart: { series: [{ label: "VQ", value: 4.2 }, { label: "KIVI", value: 7.7 }] },
  table: {
    columns: [{ key: "method", label: "Method" }, { key: "score", label: "PPL" }],
    rows: [{ method: "VQ", score: 4.2 }, { method: "KIVI", score: 7.7 }],
  },
}

for (const archetype of ["schematic", "gallery", "chart", "table"] as const) {
  test(
    `${archetype} template renders and lints clean out of the box`,
    async () => {
      const ws = mkdtempSync(join(tmpdir(), `figtpl-${archetype}-`))
      // `from` is now REQUIRED to get a template: the default is the blank canvas. Without
      // it this loop scaffolded four identical empty pages and stopped testing templates at
      // all, while still passing — the most expensive kind of green.
      await scaffold(ws, { name: "fig-t", archetype, from: archetype, claim: "c", caption: "cap", width: "full" })
      writeFileSync(join(ws, "figures", "fig-t", "data.json"), JSON.stringify(DATA[archetype]))

      const result = await render(ws, "fig-t")
      if (!result.ok) throw new Error(`render failed: ${result.error}\n${result.consoleOutput.join("\n")}`)

      const dir = join(ws, "figures", "fig-t")
      const { errors } = lint({
        source: readFileSync(join(dir, "figure.html"), "utf8"),
        meta: parse(readFileSync(join(dir, "meta.yaml"), "utf8")),
        data: DATA[archetype],
        manifest: JSON.parse(readFileSync(result.bboxes, "utf8")),
      })
      expect(errors).toEqual([])
    },
    120_000,
  )
}

// The DEFAULT scaffold, which is now what almost every figure starts from. An empty page
// still has to survive the render worker (it measures content bottom, so a zero-height
// figure is a real edge case) and come back with no findings — a canvas that lints dirty on
// arrival would train the agent to treat lint output as noise.
test(
  "the blank canvas renders and lints clean out of the box",
  async () => {
    const ws = mkdtempSync(join(tmpdir(), "figtpl-canvas-"))
    await scaffold(ws, { name: "fig-t", archetype: "schematic", claim: "c", caption: "cap", width: "full" })
    const result = await render(ws, "fig-t")
    if (!result.ok) throw new Error(`render failed: ${result.error}\n${result.consoleOutput.join("\n")}`)
    const dir = join(ws, "figures", "fig-t")
    const { errors } = lint({
      source: readFileSync(join(dir, "figure.html"), "utf8"),
      meta: parse(readFileSync(join(dir, "meta.yaml"), "utf8")),
      data: {},
      manifest: JSON.parse(readFileSync(result.bboxes, "utf8")),
    })
    expect(errors).toEqual([])
  },
  120_000,
)

// Lint enforces what is machine-checkable; the templates must also TEACH the idiom,
// because whatever they demonstrate is what the agent copies. (These would pass on the
// v1 templates' tokens alone, so assert the teaching explicitly.)
test("templates teach the paper idiom", () => {
  const tpl = (a: string) => readFileSync(join(import.meta.dir, "..", "src", "templates", a, "figure.html"), "utf8")

  // math goes through KaTeX, never monospace pseudo-math
  expect(tpl("schematic")).toContain('class="math"')
  for (const a of ["canvas", "schematic", "gallery", "chart", "table"]) {
    expect(tpl(a)).toContain("renderMath")
    // no in-figure headline: the caption explains, the figure shows
    expect(tpl(a)).not.toMatch(/<h1|<h2\b/)
  }
  // panels are labelled (a), (b) — the schematic demonstrates it
  expect(tpl("schematic")).toContain("panel-label")
})
