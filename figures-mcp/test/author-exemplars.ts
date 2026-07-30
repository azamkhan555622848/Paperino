// Authors the two exemplar figures WITH the new system itself, and copies their PNGs
// into src/assets/exemplars/ — the images figure_review sends as the quality bar.
// Dogfooding: if the pipeline cannot produce a venue-grade figure, the exemplars will
// show it. Re-run after changing tokens or templates:
//
//   bun test/author-exemplars.ts
//
// (Not a test — it regenerates committed assets. Look at the PNGs before committing.)
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import { scaffold } from "../src/scaffold"
import { render } from "../src/render"
import { lint } from "../src/lint"
import { resolveVenue } from "../src/venue"

const ws = mkdtempSync(join(tmpdir(), "fig-exemplars-"))
const EXEMPLARS = join(import.meta.dir, "..", "src", "assets", "exemplars")

// ---- exemplar 1: schematic — a 1->2->2 pipeline routed entirely by the v4 router ----
//
// v3's schematic exemplar was two independent columns of bordered cards, each with a single
// bowed arrow. It exercised nothing the router does, so it steered every reviewed figure
// toward the very idiom that produced the defects v4 exists for: hand-tuned `bow`, whole-box
// anchors, and no answer at all for two edges entering one box.
//
// This one is the counter-example. It fans one source to two measurements and merges them
// into a tall consumer at two named ports, and one stage is DELIBERATELY BORDERLESS — its
// layout box runs to the column edge while its ink stops at the glyphs, so the arrowheads
// land on the words only because anchoring is done on ink. No decorative rules, no spacer
// divs, no legend: every stroke in the figure is an edge, and every edge means something.
await scaffold(ws, {
  name: "ex-schematic",
  archetype: "schematic",
  claim: "Distortion profiles and channel scores jointly determine the per-layer compression policy.",
  caption: "Pre-RoPE capture yields two per-layer measurements, which the compression policy consumes.",
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
    /* Stage widths + gutters sum to the 528px full-width box. The gutter has to leave room
       for the connector: at 10px an arrow collapses to a bare arrowhead with no shaft, which
       the router reports as edge-degenerate. */
    #fig-root { display: flex; align-items: center; gap: 40px; padding: 12px 10px; }
    .stage { display: flex; flex-direction: column; gap: 44px; }
    #stage-in { width: 124px; }
    #stage-mid { width: 168px; }
    #stage-out { width: 136px; }
    .node { border: var(--stroke-thin) solid var(--border-strong); padding: 9px 11px; display: flex; flex-direction: column; gap: 6px; }
    /* Borderless ON PURPOSE, and ONE LINE of ink. Its layout box spans the whole middle
       column while its glyphs stop well short of the column edge, so every arrowhead lands on
       the type only because anchoring is done on ink — the one thing a whole-box anchor
       cannot do, and the reason inkRect() exists.
       One line, not two: the ink rect of a two-line block is the UNION of the lines, whose
       right edge at mid-height is a corner of blank paper — the tail then leaves from nothing
       even though the geometry is correct. Same lesson as the unlabelled top gridline: lint
       passed, the picture did not. */
    .evidence { white-space: nowrap; }
    .evidence .math { margin-left: 7px; }
    .tall { min-height: 92px; justify-content: center; }
    strong { font-size: var(--fs-body); font-weight: 700; white-space: nowrap; }
    .sub { color: var(--text-muted); font-size: var(--fs-label); }
    /* --fs-body, not --fs-label: a formula set smaller than the words around it reads as a
       footnote to its own box. */
    .math { font-size: var(--fs-body); }
  </style>
</head>
<body>
  <div id="fig-root">
    <div class="stage" id="stage-in">
      <div class="node" data-node id="capture">
        <strong>Pre-RoPE capture</strong>
        <span class="sub">keys and values</span>
      </div>
    </div>
    <div class="stage" id="stage-mid">
      <div class="evidence" data-node id="distortion"><strong>Distortion profiles</strong><span class="math">\\mathcal{D}_K^{(\\ell)}(b)</span></div>
      <div class="evidence" data-node id="scores"><strong>Channel scores</strong><span class="math">s_{K,d}^{(\\ell)}</span></div>
    </div>
    <div class="stage" id="stage-out">
      <div class="node tall" data-node id="policy">
        <strong>Compression policy</strong>
        <span class="math">b_K^{(\\ell)},\\; b_V^{(\\ell)}</span>
        <span class="sub">per channel group</span>
      </div>
    </div>
  </div>
  <script type="module">
    import { renderMath } from "../lib/math.js"
    import { arrow, fan, figReady } from "../lib/annot.js"
    // Math FIRST — glyph geometry must be final before anything is measured, and on a
    // borderless node the glyphs ARE the anchor.
    await renderMath()
    // One source, two consumers: fan() spreads the tails along the source's right edge so the
    // two edges leave at different heights instead of stacking on one midpoint.
    fan("#capture", ["#distortion", "#scores"], { tone: "ref" })
    // Two edges into ONE tall node — the case that made an author draw fake 9px port squares
    // to manufacture anchor targets. Named ports make the squares unnecessary.
    arrow("#distortion", "#policy", { port: "right", to: "left:0.3", tone: "ref" })
    arrow("#scores", "#policy", { port: "right", to: "left:0.7", tone: "ref" })
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

// ---- exemplar 3: chart on the mpl engine — the bar for anything quantitative ----
//
// This exists because figure_review hands the model exemplars as "the bar". Reviewing a
// matplotlib chart against exemplar-chart.png — four bars, one linear axis, no legend —
// would steer it backwards into the very ceiling this engine was added to escape. So the
// exemplar deliberately exercises what the HTML engine has no primitive for: a log axis,
// a percentile band, two marker series, a reference line, an annotation and two panels.
//
// Every number rendered as ink is in data.json. That is not decoration: rule 8 fails the
// figure otherwise, and an exemplar that could not pass its own lint would be incoherent.
await scaffold(ws, {
  name: "ex-chart-mpl",
  archetype: "chart",
  engine: "mpl",
  claim: "Key error exceeds value error by 1-2 orders of magnitude, and layer 0 is a 10x outlier.",
  caption: "Quantization error against bit-width, and per-layer key error at four bits.",
  width: "full",
})
writeFileSync(
  join(ws, "figures", "ex-chart-mpl", "data.json"),
  JSON.stringify(
    {
      bits: [2, 3, 4, 6, 8],
      keys_median: [1.0, 0.25, 0.0625, 0.00390625, 0.000244140625],
      keys_lo: [0.6, 0.15, 0.0375, 0.00234375, 0.00014648],
      keys_hi: [1.85, 0.4625, 0.115625, 0.00722656, 0.00045166],
      values_median: [0.02857143, 0.00714286, 0.00178571, 0.00011161, 0.00000698],
      layers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      layer_error: [0.625, 0.068, 0.058, 0.049, 0.055, 0.047, 0.062, 0.081, 0.053, 0.05, 0.072, 0.066],
      median_layer: 0.0625,
      outlier_ratio: 10,
      layer_axis_floor: 0.02,
      layer_axis_ceiling: 2.0,
    },
    null,
    1,
  ),
)
writeFileSync(
  join(ws, "figures", "ex-chart-mpl", "figure.py"),
  `from matplotlib.ticker import NullFormatter

from paperino_mpl import ACCENT, ACCENT_WARM, INK, MUTED, data, figure, save

d = data()
fig, (a, b) = figure("full", panels=2, ratios=[1, 1.25])

# (a) median-layer error against bit-width, with the layer spread as a band.
a.fill_between(d["bits"], d["keys_lo"], d["keys_hi"], color=ACCENT_WARM, alpha=0.15, linewidth=0)
a.plot(d["bits"], d["keys_median"], marker="o", color=ACCENT_WARM, label=r"$\\sigma_K^{(\\ell)}(b)$  keys")
a.plot(d["bits"], d["values_median"], marker="s", color=ACCENT, label=r"$\\sigma_V^{(\\ell)}(b)$  values")
a.set_yscale("log")
a.set_xticks(d["bits"])
a.set_xlabel(r"Bit-width $b$")
a.set_ylabel(r"Quantization error  (MSE)")
a.set_title("(a) Median layer", loc="left", fontweight="bold")
a.legend()

# (b) per-layer key error at four bits; layer 0 carries the outlier.
colors = [ACCENT_WARM if i == 0 else MUTED for i in d["layers"]]
b.bar(d["layers"], d["layer_error"], width=0.72, color=colors)
b.axhline(d["median_layer"], color=INK, linewidth=0.8, linestyle="--")
b.set_yscale("log")
# A log axis spanning barely one decade makes matplotlib label the MINOR ticks, and the
# axis comes out reading 6x10^-1, 4x10^-1, 3x10^-1, 2x10^-1 -- unreadable, and the same
# class of failure as an unlabelled top gridline. Pin the limits so whole decades appear
# and silence the minor labels.
b.set_ylim(d["layer_axis_floor"], d["layer_axis_ceiling"])
b.yaxis.set_minor_formatter(NullFormatter())
b.set_xticks(d["layers"][::2])
b.set_xlabel(r"Layer index $\\ell$")
b.set_ylabel(r"$\\sigma_K^{(\\ell)}(b{=}4)$")
b.set_title("(b) Per-layer key error", loc="left", fontweight="bold")
b.text(
    len(d["layers"]) - 1, d["median_layer"] * 1.12, "median layer", color=MUTED, ha="right", va="bottom", fontsize=7.5
)
# Anchored inside the axes so it cannot collide with the panel title above it.
b.annotate(
    f"layer 0: {d['outlier_ratio']}x median",
    xy=(0.45, d["layer_error"][0]),
    xytext=(3.0, d["layer_error"][0] * 0.62),
    color=INK,
    arrowprops=dict(arrowstyle="-|>", color=INK, linewidth=0.8, connectionstyle="arc3,rad=-0.25"),
    va="center",
)

save(fig)
`,
)

for (const [name, out] of [
  ["ex-schematic", "exemplar-schematic.png"],
  ["ex-chart", "exemplar-chart.png"],
  ["ex-chart-mpl", "exemplar-chart-mpl.png"],
] as const) {
  const result = await render(ws, name)
  if (!result.ok) throw new Error(`${name} render failed: ${result.error}\n${result.consoleOutput.join("\n")}`)

  // An exemplar that cannot pass the rules it exemplifies is incoherent — and it would be
  // shipped as the bar every future figure is steered toward. Fail loudly instead.
  const dir = join(ws, "figures", name)
  const meta = parseYaml(readFileSync(join(dir, "meta.yaml"), "utf8"))
  const engine: "html" | "mpl" = meta.engine === "mpl" ? "mpl" : "html"
  const { errors } = lint({
    source: readFileSync(join(dir, engine === "mpl" ? "figure.py" : "figure.html"), "utf8"),
    meta: { ...meta, engine },
    data: JSON.parse(readFileSync(join(dir, "data.json"), "utf8")),
    allowedFaces: ["KaTeX_", resolveVenue(ws).textFace, ...resolveVenue(ws).mathFaces],
    mathFaces: resolveVenue(ws).mathFaces,
    manifest: JSON.parse(readFileSync(join(dir, "build", "bboxes.json"), "utf8")),
  })
  if (errors.length) throw new Error(`${name} FAILED ITS OWN LINT:\n${JSON.stringify(errors, null, 1)}`)

  cpSync(result.png, join(EXEMPLARS, out))
  console.log(`wrote ${out} (lint clean)`)
}
console.log("done — LOOK at both PNGs before committing; they are the bar the review loop steers toward")
