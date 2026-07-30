import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { render } from "../src/render"
import { polylineHits } from "../src/route"
import { scaffold } from "../src/scaffold"

// The browser half of the router. route.test.ts pins the arithmetic on plain rects; this file
// pins what annot.js actually DRAWS, because the whole v3 failure was that the geometry the
// author declared and the geometry that landed on the page were different things.
//
// Every fixture lays its boxes out with explicit absolute rects, so the test KNOWS each
// obstacle's coordinates and can assert the drawn polyline cleared it — not merely that some
// path exists.
const LIB = join(import.meta.dir, "..", "src", "assets", "lib", "annot.js")

const page = (body: string, script: string, css = "") => `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="../tokens.css" />
  <style>
    #fig-root { position: relative; width: 460px; height: 260px; }
    .n { position: absolute; box-sizing: border-box; padding: 4px 6px;
         background: var(--bg); border: var(--stroke-thin) solid var(--border-strong); }
    ${css}
  </style>
</head>
<body>
  <div id="fig-root">${body}</div>
  <script type="module">
    import { arrow, edge, fan, place, label, dimension, figReady } from "../lib/annot.js"
    ${script}
    figReady()
  </script>
</body>
</html>`

const workspaces: string[] = []
afterAll(() => {
  for (const ws of workspaces) rmSync(ws, { recursive: true, force: true })
})

/** Render one figure and hand back the overlay SVG plus the bbox manifest. */
async function drawn(name: string, body: string, script: string, css = "") {
  const ws = mkdtempSync(join(tmpdir(), `figannot-${name}-`))
  workspaces.push(ws)
  await scaffold(ws, { name, archetype: "schematic", claim: "c", caption: "c", width: "full" })
  writeFileSync(join(ws, "figures", name, "figure.html"), page(body, script, css))
  const result = await render(ws, name)
  if (!result.ok) throw new Error(`render failed: ${result.error}\n${result.consoleOutput.join("\n")}`)
  if (!result.svg) throw new Error("no overlay svg was published")
  return { svg: readFileSync(result.svg, "utf8"), manifest: JSON.parse(readFileSync(result.bboxes, "utf8")) }
}

/** Every overlay `<path>` carrying `attr`, as its raw `d`. */
const paths = (svg: string, attr: string) =>
  [...svg.matchAll(/<path\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes(attr))
    .map((tag) => /\sd="([^"]+)"/.exec(tag)?.[1] ?? "")

const polyline = (d: string): [number, number][] =>
  [...d.matchAll(/[ML]\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])

test("annot.js v4 runs on the shared router and reports what it could not route", () => {
  const src = readFileSync(LIB, "utf8")
  expect(src.split("\n", 1)[0]).toBe("// paperino-annot v4.0")
  // One implementation, compiled: a hand-ported copy of the intersection test would drift
  // from route.ts invisibly.
  expect(src).toContain('from "./route.js"')
  for (const fn of ["edge", "fan", "place", "label", "dimension"]) expect(src).toContain(`export function ${fn}(`)
  // A blocked route renders and REPORTS. A throw leaves the model with no picture to look at.
  expect(src).toContain("window.__FIG_FINDINGS__")
})

test(
  "an edge routes around a declared node instead of through it",
  async () => {
    const mid = { x: 0, y: 90, w: 150, h: 60 }
    const { svg } = await drawn(
      "routed",
      `<div class="n" data-node id="a" style="left:0;top:0;width:240px;height:44px">Capture</div>
       <div class="n" data-node id="mid" style="left:0;top:90px;width:150px;height:60px">Distortion</div>
       <div class="n" data-node id="b" style="left:0;top:200px;width:240px;height:44px">Scores</div>`,
      `arrow("#a", "#b")`,
    )
    const ds = paths(svg, "data-edge")
    expect(ds.length).toBe(1)
    // A mitred polyline, not a quadratic: v3's only control was `bow`, a scalar whose correct
    // value depends on #mid's rect — which the authoring model cannot see.
    expect(ds[0]).not.toMatch(/[QCASTqcast]/)
    const pts = polyline(ds[0])
    expect(pts.length).toBeGreaterThanOrEqual(4)
    expect(polylineHits(pts, [mid], 2.8)).toBe(0)
    // ...and it still leaves and enters the two boxes it was asked to connect.
    expect(pts[0]).toEqual([120, 44])
    expect(pts[pts.length - 1]).toEqual([120, 200])
  },
  120_000,
)

test(
  "ports anchor two edges into one node, and anchors sit on visible ink",
  async () => {
    const { svg } = await drawn(
      "ported",
      `<div class="n" data-node id="src" style="left:0;top:0;width:120px;height:40px">Capture</div>
       <div class="ev" data-node id="ev" style="left:0;top:70px;width:220px;height:40px">Distortion</div>
       <div class="n" data-node id="policy" style="left:300px;top:0;width:130px;height:180px">Policy</div>`,
      `arrow("#src", "#policy", { port: "right", to: "left:0.25" })
       arrow("#ev", "#policy", { port: "right", to: "left:0.75" })`,
      `.ev { position: absolute; box-sizing: border-box; padding: 4px 8px;
             border-left: var(--stroke) solid var(--border-strong); }`,
    )
    const [one, two] = paths(svg, "data-edge").map(polyline)
    // Two edges into ONE tall node land on distinct ports. Without them an author drew two
    // 9x9 bordered squares to manufacture anchor targets, and they shipped in a paper.
    expect(one[0]).toEqual([120, 20])
    expect(one[one.length - 1]).toEqual([300, 45])
    expect(two[two.length - 1]).toEqual([300, 135])
    // #ev carries ONE border (left) and no fill of its own, so its layout box reaches x=220
    // with no ink anywhere near it. The anchor must be the right edge of its GLYPHS.
    expect(two[0][0]).toBeGreaterThan(20)
    expect(two[0][0]).toBeLessThan(150)
  },
  120_000,
)

test(
  "place, label and dimension resolve their own geometry",
  async () => {
    const { svg, manifest } = await drawn(
      "placed",
      `<div class="n" data-node id="a" style="left:0;top:0;width:140px;height:44px">Stage A</div>
       <div class="n" data-node id="b" style="left:0;top:120px;width:140px;height:44px">Stage B</div>
       <span id="tag">rank r</span>`,
      `place("#tag", { near: "#a" })
       label("#b", "measured span", { leader: true })
       dimension("#a", "#b", { text: "4096 dims" })`,
    )
    const tag = manifest.texts.find((t: { selector: string }) => t.selector === "#tag")
    expect(tag).toBeDefined()
    // In flow the span sits ON #a. "Near that, overlapping nothing" is precisely the sentence
    // a blind author cannot execute, so place() resolves it from measurement.
    expect(tag.rect.x).toBeGreaterThanOrEqual(140)
    expect(tag.rect.y).toBeLessThan(120)
    expect(svg).toContain("measured span")
    expect(paths(svg, "data-leader").length).toBe(1)
    expect(paths(svg, "data-dimension").length).toBe(1)
    expect(svg).toContain("4096 dims")
  },
  120_000,
)
