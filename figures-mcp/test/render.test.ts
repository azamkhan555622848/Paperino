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

// The keystone of the two-engine design: a matplotlib figure must produce the SAME manifest
// the HTML engine produces, or lint cannot cover both. If svg.fonttype ever regresses to
// "path", text nodes vanish and this is the test that notices — every text-level rule,
// provenance included, would otherwise pass vacuously on an unmeasured figure.
test(
  "a matplotlib figure yields a manifest with measurable text and gid-derived ticks",
  async () => {
    await scaffold(WS, { name: "mplfig", archetype: "chart", engine: "mpl", claim: "c", caption: "c", width: "full" })
    const dir = join(WS, "figures", "mplfig")
    writeFileSync(join(dir, "data.json"), JSON.stringify({ bits: [2, 4, 8], err: [1.0, 0.0625, 0.000244] }))
    writeFileSync(
      join(dir, "figure.py"),
      [
        "from paperino_mpl import ACCENT, data, figure, save",
        "d = data()",
        "fig, (ax,) = figure('full')",
        "ax.plot(d['bits'], d['err'], marker='o', color=ACCENT)",
        "ax.set_yscale('log')",
        "ax.set_xlabel('bit-width')",
        "save(fig)",
      ].join("\n"),
    )

    const result = await render(WS, "mplfig")
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const manifest = JSON.parse(readFileSync(join(dir, "build", "bboxes.json"), "utf8"))
    // Real <text> nodes, not outlined <path>.
    expect(manifest.texts.length).toBeGreaterThan(3)
    const axisLabel = manifest.texts.find((t: { text: string }) => t.text === "bit-width")
    expect(axisLabel).toBeDefined()
    // The vendored face resolved; a system-serif fallback here would fail rule 13.
    expect(axisLabel.fontFamily).toContain("TeX Gyre Termes")
    // Tick labels are computed, so they must be derived WITHOUT the author declaring it.
    expect(manifest.texts.filter((t: { derived: boolean }) => t.derived).length).toBeGreaterThan(2)
    // ...and the axis label is not a tick, so it must not be exempted.
    expect(axisLabel.derived).toBe(false)
    // The mpl engine's SVG is the figure itself, so it is published, not best-effort.
    expect(result.svg).toBe(join(dir, "build", "mplfig.svg"))
    expect(existsSync(result.pdf)).toBe(true)
  },
  120_000,
)

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
