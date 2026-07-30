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

/**
 * A hand-written figure, because the archetype templates declare no [data-node] and the
 * geometry this manifest must report only exists on a figure that declares nodes and draws
 * an edge between them. Returns the figure dir, so build/bboxes.json is one join away.
 */
async function scaffoldFixture(name: string, parts: { body: string; script: string }): Promise<string> {
  await scaffold(WS, { name, archetype: "schematic", claim: "c", caption: "c", width: "narrow" })
  const dir = join(WS, "figures", name)
  writeFileSync(
    join(dir, "figure.html"),
    [
      '<!doctype html><html><head><meta charset="utf-8" />',
      '<link rel="stylesheet" href="../tokens.css" />',
      "</head><body>",
      `<div id="fig-root">${parts.body}</div>`,
      '<script type="module">',
      'import { arrow, edge, fan, place, label, dimension, brace, highlight, figReady } from "../lib/annot.js"',
      parts.script,
      "figReady()",
      "</script></body></html>",
    ].join("\n"),
  )
  const result = await render(WS, name)
  expect(result.ok).toBe(true)
  return dir
}

test(
  "the manifest carries path geometry, declared nodes and intents",
  async () => {
    const ws = await scaffoldFixture("geom", {
      body: `<div id="a" data-node style="border:1px solid #000">A</div>
           <div id="b" data-node style="border:1px solid #000;margin-top:120px">B</div>
           <div id="ghost" data-node data-intent="unfilled slot" style="border:1px solid #000;width:40px;height:40px"></div>`,
      script: `arrow("#a", "#b")`,
    })
    const m = JSON.parse(readFileSync(join(ws, "build", "bboxes.json"), "utf8"))
    // ONE path: the arrowhead <marker> in <defs> is a <path> descendant of the overlay too,
    // and it is not a drawn stroke — sampled as one it would report a mark that touches no
    // node and fail rule 15 on every figure that draws an arrow.
    expect(m.paths.length).toBe(1)
    expect(m.paths[0].points.length).toBeGreaterThanOrEqual(2)
    expect(m.paths[0].width).toBeGreaterThan(0)
    expect(m.paths[0].kind).toBe("edge")
    expect(m.nodes.map((n: { selector: string }) => n.selector).sort()).toEqual(["#a", "#b", "#ghost"])
    expect(m.nodes.find((n: { selector: string }) => n.selector === "#ghost").hasText).toBe(false)
    expect(m.intents).toEqual([{ selector: "#ghost", reason: "unfilled slot" }])
    // Rule 17 matches style triples, so a transparent layout wrapper must never enter the
    // mark set: #fig-root's triple would "match" a legend swatch by accident and make the
    // rule unfireable. Only inked, textless elements are marks.
    const marks = m.legend.map((l: { selector: string }) => l.selector)
    expect(marks).toContain("#ghost")
    expect(marks).not.toContain("#fig-root")
    // A clean route reports nothing. This is the plumbing for rules 14/15, not a rule itself.
    expect(m.findings).toEqual([])
  },
  90_000,
)

test(
  "the manifest separates leaders and dimensions from edges, and carries router findings",
  async () => {
    const ws = await scaffoldFixture("kinds", {
      body: `<div id="p" data-node style="border:1px solid #000">P</div>
           <div id="q" data-node style="border:1px solid #000">Q</div>`,
      // P and Q are adjacent, so the two ports land < 21px apart: a degenerate edge.
      script: `arrow("#p", "#q")
             label("#p", "note", { leader: true })
             dimension("#p", "#q", { text: "40 dims" })`,
    })
    const m = JSON.parse(readFileSync(join(ws, "build", "bboxes.json"), "utf8"))
    // Rule 15 exempts a leader by KIND and rule 14 exempts a dimension by kind, so the three
    // must be distinguishable in the manifest — an undifferentiated "path" makes both
    // exemptions impossible to express.
    expect(m.paths.map((p: { kind: string }) => p.kind).sort()).toEqual(["dimension", "edge", "leader"])
    // A degenerate edge RENDERS and reports. window.__FIG_FINDINGS__ is the only route from
    // the router to lint; without it a blocked route is silent.
    expect(m.findings).toEqual([{ rule: "edge-degenerate", selector: "#p -> #q", blocked: [] }])
  },
  90_000,
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
