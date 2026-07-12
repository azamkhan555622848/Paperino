import { expect, test } from "bun:test"
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
      await scaffold(ws, { name: "fig-t", archetype, claim: "c", caption: "cap", width: "full" })
      writeFileSync(join(ws, "figures", "fig-t", "data.json"), JSON.stringify(DATA[archetype]))

      const result = await render(ws, "fig-t")
      if (!result.ok) throw new Error(`render failed: ${result.error}\n${result.consoleOutput.join("\n")}`)

      const dir = join(ws, "figures", "fig-t")
      const errors = lint({
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

// Lint enforces what is machine-checkable; the templates must also TEACH the idiom,
// because whatever they demonstrate is what the agent copies. (These would pass on the
// v1 templates' tokens alone, so assert the teaching explicitly.)
test("templates teach the paper idiom", () => {
  const tpl = (a: string) => readFileSync(join(import.meta.dir, "..", "src", "templates", a, "figure.html"), "utf8")

  // math goes through KaTeX, never monospace pseudo-math
  expect(tpl("schematic")).toContain('class="math"')
  for (const a of ["schematic", "gallery", "chart", "table"]) {
    expect(tpl(a)).toContain("renderMath")
    // no in-figure headline: the caption explains, the figure shows
    expect(tpl(a)).not.toMatch(/<h1|<h2\b/)
  }
  // panels are labelled (a), (b) — the schematic demonstrates it
  expect(tpl("schematic")).toContain("panel-label")
})
