import { beforeEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { scaffold } from "../src/scaffold"
import { render } from "../src/render"

const WS = join(import.meta.dir, "tmp-render-ws")

beforeEach(() => {
  rmSync(WS, { recursive: true, force: true })
  mkdirSync(WS, { recursive: true })
})

test(
  "each archetype template renders out of the box",
  async () => {
    for (const archetype of ["schematic", "gallery", "chart", "table"] as const) {
      const name = `fig-${archetype}`
      await scaffold(WS, { name, archetype, claim: "c", caption: "c", width: "narrow" })
      if (archetype === "gallery")
        writeFileSync(join(WS, "figures", name, "data.json"), JSON.stringify({ items: [{ title: "T", body: "b" }] }))
      if (archetype === "chart")
        writeFileSync(
          join(WS, "figures", name, "data.json"),
          JSON.stringify({ series: [{ label: "a", value: 3 }, { label: "b", value: 5 }] }),
        )
      if (archetype === "table")
        writeFileSync(
          join(WS, "figures", name, "data.json"),
          JSON.stringify({
            rows: [{ k: "speedup", v: 14617 }],
            columns: [{ key: "k", label: "Metric" }, { key: "v", label: "Value" }],
          }),
        )
      const result = await render(WS, name)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      const manifest = JSON.parse(readFileSync(result.bboxes, "utf8"))
      expect(manifest.texts.length).toBeGreaterThan(0)
      // v2 manifest: lint 11-13 need the computed font, KaTeX membership, and web chrome
      expect(typeof manifest.texts[0].fontFamily).toBe("string")
      expect(typeof manifest.texts[0].inKatex).toBe("boolean")
      expect(Array.isArray(manifest.elements)).toBe(true)
      // print-true: `narrow` is a 3.25in column at 96dpi
      expect(manifest.viewport.width).toBe(312)
      expect(readFileSync(result.pdf).subarray(0, 5).toString()).toBe("%PDF-")
      expect(existsSync(result.png)).toBe(true)
    }
  },
  180_000,
)

test(
  "PAPERINO_FIGURES_NODE overrides the worker executable",
  async () => {
    // Packaged builds have no node: the app points this at its own electron.exe. A fake
    // "node" that exits nonzero proves render spawns the override rather than "node".
    const fake = join(WS, "fake-node.cmd")
    writeFileSync(fake, "@echo off\r\nexit /b 7\r\n")
    process.env.PAPERINO_FIGURES_NODE = fake
    try {
      await scaffold(WS, { name: "fig-override", archetype: "schematic", claim: "c", caption: "c", width: "narrow" })
      const result = await render(WS, "fig-override")
      expect(result.ok).toBe(false) // the fake worker emits no __RESULT__ marker
    } finally {
      delete process.env.PAPERINO_FIGURES_NODE
    }
  },
  120_000,
)

test(
  "a JS error in figure.html returns ok:false with console output",
  async () => {
    await scaffold(WS, { name: "fig-broken", archetype: "schematic", claim: "c", caption: "c", width: "narrow" })
    const html = readFileSync(join(WS, "figures", "fig-broken", "figure.html"), "utf8")
    writeFileSync(join(WS, "figures", "fig-broken", "figure.html"), html.replace("#box-b", "#does-not-exist"))
    const result = await render(WS, "fig-broken")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.consoleOutput.join("\n")).toContain("does-not-exist")
  },
  90_000,
)
