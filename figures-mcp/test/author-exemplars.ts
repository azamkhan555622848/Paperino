// Authors the two exemplar figures WITH the new system itself, and copies their PNGs
// into src/assets/exemplars/ — the images figure_review sends as the quality bar.
// Dogfooding: if the pipeline cannot produce a venue-grade figure, the exemplars will
// show it. Re-run after changing tokens or templates:
//
//   bun test/author-exemplars.ts
//
// (Not a test — it regenerates committed assets. Look at the PNGs before committing.)
import { cpSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scaffold } from "../src/scaffold"
import { render } from "../src/render"

const ws = mkdtempSync(join(tmpdir(), "fig-exemplars-"))
const EXEMPLARS = join(import.meta.dir, "..", "src", "assets", "exemplars")

// ---- exemplar 1: schematic — a two-panel mechanism sketch carrying real math ----
await scaffold(ws, {
  name: "ex-schematic",
  archetype: "schematic",
  claim: "Shared residuals add coherently; independent residuals add stochastically.",
  caption: "Aggregation of quantization residuals across a query group.",
  width: "full",
})
writeFileSync(
  join(ws, "figures", "ex-schematic", "figure.html"),
  `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="../tokens.css" />
  <style>
    #fig-root { display: flex; gap: 26px; padding: 12px; align-items: flex-start; }
    /* the gap has to leave room for the connector: at 10px the arrow collapses to a
       bare arrowhead with no shaft */
    .col { display: flex; flex-direction: column; gap: 26px; flex: 1; }
  </style>
</head>
<body>
  <div id="fig-root">
    <div class="col">
      <span class="panel-label" id="panel-a">(a)</span>
      <div class="card" id="kv-shared"><h3>compressed KV head</h3><p>one residual <span class="math">\\Delta_{\\mathrm{vec}}</span>, read by all <span class="math">g</span> heads</p></div>
      <div class="card" id="sum-coherent"><h3>coherent sum</h3><p><span class="math">O(g\\,\\sigma_{\\mathrm{vec}})</span></p></div>
    </div>
    <div class="col">
      <span class="panel-label" id="panel-b">(b)</span>
      <div class="card" id="kv-indep"><h3>per-channel residuals</h3><p>independent <span class="math">\\Delta_{\\mathrm{ch},h}</span> per head</p></div>
      <div class="card" id="sum-stochastic"><h3>stochastic sum</h3><p><span class="math">O(\\sqrt{g\\,d}\\,\\sigma_{\\mathrm{ch}})</span></p></div>
    </div>
  </div>
  <script type="module">
    import { renderMath } from "../lib/math.js"
    import { arrow, figReady } from "../lib/annot.js"
    await renderMath()
    arrow("#kv-shared", "#sum-coherent", { bow: 0.2 })
    arrow("#kv-indep", "#sum-stochastic", { bow: 0.2 })
    figReady()
  </script>
</body>
</html>
`,
)

// ---- exemplar 2: chart — data-bound bars, a real quantitative y-axis, axis titles ----
// The stock template is deliberately minimal (bars + category ticks). An exemplar must
// show the whole idiom: a chart with no y-scale and no axis titles is not publishable,
// and whatever the exemplar shows is what the review loop steers toward.
await scaffold(ws, {
  name: "ex-chart",
  archetype: "chart",
  claim: "Perplexity grows with the GQA ratio.",
  caption: "4-bit perplexity by GQA ratio.",
  width: "narrow",
})
writeFileSync(
  join(ws, "figures", "ex-chart", "data.json"),
  JSON.stringify({
    series: [
      { label: "2:1", value: 5.1 },
      { label: "4:1", value: 6.0 },
      { label: "5:1", value: 6.4 },
      { label: "8:1", value: 7.6 },
    ],
  }),
)
writeFileSync(
  join(ws, "figures", "ex-chart", "figure.html"),
  `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="../tokens.css" />
  <style>
    #fig-root { padding: 10px 12px 30px 34px; }
    .plot { position: relative; height: 150px; border-left: var(--stroke-thin) solid var(--border-strong); border-bottom: var(--stroke-thin) solid var(--border-strong); }
    .bar { position: absolute; bottom: 0; background: var(--accent); }
    .tick-x { position: absolute; font-size: var(--fs-small); color: var(--text-muted); bottom: -17px; transform: translateX(-50%); }
    .tick-y { position: absolute; font-size: var(--fs-small); color: var(--text-muted); right: calc(100% + 5px); transform: translateY(50%); }
    .grid { position: absolute; left: 0; right: 0; border-top: 0.8px solid var(--border); }
    .axis-y { position: absolute; left: -30px; top: 50%; transform: rotate(-90deg) translateX(50%); transform-origin: left top; font-size: var(--fs-label); white-space: nowrap; }
    .axis-x { text-align: center; font-size: var(--fs-label); margin-top: 20px; }
  </style>
</head>
<body>
  <div id="fig-root">
    <div class="plot" id="plot"><span class="axis-y" id="axis-y">perplexity</span></div>
    <div class="axis-x" id="axis-x">GQA ratio</div>
  </div>
  <script type="module">
    import { renderMath } from "../lib/math.js"
    import { scaleLinear, scaleBand, derived, niceDomain } from "../lib/scale.js"
    import { figReady } from "../lib/annot.js"
    const data = window.__DATA__.series ?? []
    const plot = document.querySelector("#plot")
    const W = plot.clientWidth || 260
    const H = 150
    const x = scaleBand(data.map((d) => d.label), [0, W])
    // niceDomain: headroom over the tallest bar, and the top gridline is labelled —
    // a bar poking past the last tick into an unmarked edge reads as clipped.
    const y = scaleLinear(niceDomain([0, Math.max(...data.map((d) => d.value), 1)], 4), [0, H])

    // y-axis: gridlines + tick labels. ticks() are computed, not experiment numbers, so
    // derived() stamps them for the provenance lint.
    for (const t of y.ticks(4)) {
      const line = document.createElement("div")
      line.className = "grid"
      line.style.bottom = \`\${y(t)}px\`
      plot.appendChild(line)
      const lab = derived(t)
      lab.className = "tick-y"
      lab.style.bottom = \`\${y(t)}px\`
      plot.appendChild(lab)
    }

    for (const [i, d] of data.entries()) {
      const bar = document.createElement("div")
      bar.className = "bar"
      bar.id = \`bar-\${i}\`
      bar.style.left = \`\${x(d.label)}px\`
      bar.style.width = \`\${x.bandwidth()}px\`
      bar.style.height = \`\${y(d.value)}px\`
      plot.appendChild(bar)
      const lab = derived(d.label)
      lab.className = "tick-x"
      lab.style.left = \`\${x(d.label) + x.bandwidth() / 2}px\` // centered under the bar
      plot.appendChild(lab)
    }
    await renderMath()
    figReady()
  </script>
</body>
</html>
`,
)

for (const [name, out] of [
  ["ex-schematic", "exemplar-schematic.png"],
  ["ex-chart", "exemplar-chart.png"],
] as const) {
  const result = await render(ws, name)
  if (!result.ok) throw new Error(`${name} render failed: ${result.error}\n${result.consoleOutput.join("\n")}`)
  cpSync(result.png, join(EXEMPLARS, out))
  console.log(`wrote ${out}`)
}
console.log("done — LOOK at both PNGs before committing; they are the bar the review loop steers toward")
