import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { lint } from "../src/lint"
import { render } from "../src/render"
import { scaffold } from "../src/scaffold"

// The escape mechanism, END TO END through a real render. lint.test.ts pins the rules against
// synthetic manifests; what only a browser can prove is that the SELECTORS agree — the render
// worker writes `intents[].selector` from cssPath(), and every rule looks its waiver up by the
// selector it reports. Two spellings of the same element and the whole mechanism goes quiet:
// nothing is waived, nothing is reported, and no test built from hand-written manifests notices.
const ws = mkdtempSync(join(tmpdir(), "figintent-"))
afterAll(() => rmSync(ws, { recursive: true, force: true }))

const FIGURE = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="../tokens.css" />
  <style>
    #fig-root { position: relative; width: 460px; height: 200px; }
    .n { position: absolute; box-sizing: border-box; padding: 4px 6px;
         background: var(--bg); border: var(--stroke-thin) solid var(--border-strong); }
  </style>
</head>
<body>
  <div id="fig-root">
    <div class="n" id="a" data-node style="left:0;top:0;width:120px;height:40px">Source</div>
    <div class="n" id="b" data-node style="left:300px;top:0;width:120px;height:40px">Target</div>
    <span id="mid" style="position:absolute;left:150px;top:12px">crossed label</span>
    <i id="slot" data-node data-intent="unfilled slot" style="position:absolute;left:0;top:90px;
       display:block;width:40px;height:40px;box-sizing:border-box;
       border:var(--stroke-thin) solid var(--border-strong)"></i>
    <div class="n" id="round" data-intent="rounded architecture block"
         style="left:120px;top:90px;width:130px;height:40px;border-radius:8px">Rounded</div>
    <span id="tiny" data-intent="looks nicer" style="position:absolute;left:300px;top:100px;font-size:6px">tiny</span>
  </div>
  <script type="module">
    import { edge, figReady } from "../lib/annot.js"
    // edge() draws exactly what it is told, so this one really does cross #mid's glyphs.
    edge("#a", [], "#b", { intent: "annotation drawn across the label on purpose" })
    figReady()
  </script>
</body>
</html>`

test(
  "a declared intent waives the style rules it names and never the absolute ones",
  async () => {
    await scaffold(ws, { name: "esc", archetype: "schematic", claim: "c", caption: "c", width: "full" })
    writeFileSync(join(ws, "figures", "esc", "figure.html"), FIGURE)
    const result = await render(ws, "esc")
    if (!result.ok) throw new Error(`render failed: ${result.error}\n${result.consoleOutput.join("\n")}`)
    const manifest = JSON.parse(readFileSync(result.bboxes, "utf8"))

    // The page really did carry all four claims into the manifest.
    expect(manifest.intents.map((i: { selector: string }) => i.selector).sort()).toEqual([
      "#annot-overlay > path:nth-child(2)",
      "#round",
      "#slot",
      "#tiny",
    ])

    const { errors, exemptions } = lint({
      source: FIGURE,
      meta: { archetype: "schematic", caption: "c", alt: "a", claim: "c" },
      data: {},
      manifest,
    })
    const waived = (rule: string) => exemptions.find((e) => e.rule === rule)

    // 14: the edge does cross #mid, and the claim on the path waives it.
    expect(errors.map((e) => e.rule)).not.toContain("stroke-over-text")
    expect(waived("stroke-over-text")?.reason).toBe("annotation drawn across the label on purpose")
    // 16: an empty 40x40 node, declared.
    expect(errors.map((e) => e.rule)).not.toContain("empty-node")
    expect(waived("empty-node")).toEqual({ rule: "empty-node", selector: "#slot", reason: "unfilled slot" })
    // 12: radius is escapable.
    expect(errors.map((e) => e.rule)).not.toContain("web-chrome")
    expect(waived("web-chrome")?.selector).toBe("#round")

    // ...and the hard line holds: 6px text stays a failure, and CLAIMING it is a second one.
    const tiny = errors.filter((e) => e.selector === "#tiny").map((e) => e.rule)
    expect(tiny).toContain("min-type-size")
    expect(tiny).toContain("intent-not-permitted")
    expect(exemptions.some((e) => e.selector === "#tiny")).toBe(false)
    expect(errors.map((e) => e.rule)).not.toContain("dangling-edge")
  },
  120_000,
)
