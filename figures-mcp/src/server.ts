import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { parse } from "yaml"
import { scaffold } from "./scaffold"
import { render } from "./render"
import { lint } from "./lint"
import { dataQuery } from "./data-query"
import { resolveVenue } from "./venue"

const server = new McpServer({ name: "figures-mcp", version: "0.1.0" })
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] })
const image = (path: string) => ({
  type: "image" as const,
  data: readFileSync(path).toString("base64"),
  mimeType: "image/png",
})
// import.meta.dir is bun-only (undefined under node) — see scaffold.ts.
const EXEMPLARS = join(dirname(fileURLToPath(import.meta.url)), "assets", "exemplars")

const ws = z.string().describe("Absolute path to the paper workspace (the project root)")
const figName = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "kebab-case")

server.registerTool(
  "figure_scaffold",
  {
    description:
      "Create a new figure from an archetype template (schematic|gallery|chart|table) on the engine YOU pick (html|mpl — see the engine field; plots need mpl). Write the claim — the one sentence the figure must demonstrate — BEFORE designing. Vendors tokens.css + lib/ + fonts/ into the workspace on first use.",
    inputSchema: {
      workspace: ws,
      name: figName,
      archetype: z.enum(["schematic", "gallery", "chart", "table"]),
      engine: z
        .enum(["html", "mpl"])
        .default("html")
        .describe(
          "Which renderer authors this figure. YOU choose, per figure — there is no auto-detection.\n" +
            "  mpl  — anything QUANTITATIVE: axes, log scales, series, distributions, error bands, " +
            "reference lines, multi-panel comparisons, anything with a scale. You author figure.py " +
            "and have all of matplotlib. The html engine has two linear scales and no log, band, " +
            "marker, legend or panel primitive, so it CANNOT draw these — do not try.\n" +
            "  html — DIAGRAMS and structure: schematics, pipelines, free-form boxes and arrows, " +
            "rich inline math, annotated galleries, tables. You author figure.html with CSS layout " +
            "and the SVG annotation overlay, which matplotlib is poor at.\n" +
            "Both are linted by the same 17 rules, provenance included. If the figure is a plot, pick mpl.",
        ),
      claim: z.string().min(1),
      caption: z.string().min(1),
      width: z
        .enum(["narrow", "full"])
        .describe(
          "Render viewport, print-true: narrow=312px (3.25in single column), full=528px (5.5in text width). Author at this size — never draw large and scale down, which shrinks 9pt type below the 7pt floor.",
        ),
      alt: z.string().optional().describe("Screen-reader description; defaults to the caption"),
    },
  },
  async (a) => {
    const { figureDir } = await scaffold(a.workspace, a)
    return text(
      a.engine === "mpl"
        ? `scaffolded ${figureDir}. Edit figure.py: numbers come from data(), colors from the module ` +
          `(ACCENT, ACCENT_WARM, MUTED, GRID, INK), and you never set an rcParam or call savefig — ` +
          `figure() and save() own the print-true size and the SVG/PDF font modes. Put numbers in ` +
          `data.json, then figure_render.`
        : `scaffolded ${figureDir}. Edit figure.html (layout=HTML/flex/grid, annotations=lib/annot.js, colors=var(--…) only), put numbers in data.json, then figure_render.`,
    )
  },
)

server.registerTool(
  "figure_render",
  {
    description:
      "Render figures/<name>/figure.html headless at its fixed viewport. Produces build/<name>.png + .pdf + bboxes.json. Data from data.json is injected as window.__DATA__.",
    inputSchema: { workspace: ws, name: figName },
  },
  async (a) => {
    const result = await render(a.workspace, a.name)
    if (!result.ok) return text(`RENDER FAILED: ${result.error}\nconsole:\n${result.consoleOutput.join("\n") || "(empty)"}`)
    return text(`rendered: ${result.png}\npdf: ${result.pdf}\nNow run figure_lint.`)
  },
)

server.registerTool(
  "figure_lint",
  {
    description:
      "Deterministic quality gate (17 rules: overlap, overflow, 7pt type floor, contrast, raw colors, " +
      "stroke floor, palette, number provenance, svg viewBox, meta, pseudo-math, web-chrome, font allowlist, " +
      "stroke-over-text, dangling-edge, empty-node, orphan-legend — plus the router's own unroutable/degenerate " +
      "findings). Must pass before figure_review. Patch by selector.\n" +
      'A style rule you meant to break is declared in the source: data-intent="<reason>" on the element or ' +
      "path, reported back in `exemptions`. It does NOT waive overflow, the 7pt floor, provenance or the font " +
      "allowlist — declaring one of those is itself the error `intent-not-permitted`.",
    inputSchema: { workspace: ws, name: figName },
  },
  async (a) => {
    const dir = join(a.workspace, "figures", a.name)
    const bboxPath = join(dir, "build", "bboxes.json")
    if (!existsSync(bboxPath)) return text("no render found — run figure_render first")
    const meta = parse(readFileSync(join(dir, "meta.yaml"), "utf8"))
    const engine: "html" | "mpl" = meta.engine === "mpl" ? "mpl" : "html"
    // The venue face, not every face we ship: a Times paper accepts Termes and a Computer
    // Modern paper accepts KaTeX, so a figure set in the other one is caught rather than
    // silently mismatching its own caption. KaTeX_ stays allowed either way — the HTML
    // engine typesets math with it regardless of venue.
    const venue = resolveVenue(a.workspace)
    // `meta` is spread whole, so an optional `fonts:` in meta.yaml reaches rule 13 and is
    // APPENDED to the venue allowlist. A deliberate extra face is an input to that rule, not
    // an escape from it — the rule still catches an undeclared silent fallback.
    const result = lint({
      source: readFileSync(join(dir, engine === "mpl" ? "figure.py" : "figure.html"), "utf8"),
      meta: { ...meta, engine },
      data: JSON.parse(readFileSync(join(dir, "data.json"), "utf8")),
      allowedFaces: ["KaTeX_", venue.textFace, ...venue.mathFaces],
      mathFaces: venue.mathFaces,
      manifest: JSON.parse(readFileSync(bboxPath, "utf8")),
    })
    writeFileSync(join(dir, "build", "lint.json"), JSON.stringify(result, null, 1))
    // The full object, exemptions included: a waiver the agent claimed must be visible to it
    // in the same breath as the failures, and figure_review is later asked to justify each.
    return text(JSON.stringify(result, null, 1))
  },
)

server.registerTool(
  "figure_review",
  {
    description:
      "Vision review. Returns the rendered PNG + the figure's claim + rubric + 2 exemplar figures. YOU review the image against the rubric and patch figure.html by selector. Hard cap: 4 review iterations per figure, then stop and show the user.",
    inputSchema: { workspace: ws, name: figName },
  },
  async (a) => {
    const dir = join(a.workspace, "figures", a.name)
    const lintPath = join(dir, "build", "lint.json")
    if (!existsSync(lintPath)) return text("refused: run figure_render then figure_lint first")
    const lintResult = JSON.parse(readFileSync(lintPath, "utf8"))
    if (!lintResult.passed) return text(`refused: lint has ${lintResult.errors.length} failure(s) — fix those first`)
    const meta = parse(readFileSync(join(dir, "meta.yaml"), "utf8"))
    const rubric = [
      `CLAIM this figure must demonstrate: "${meta.claim}"`,
      `Caption: "${meta.caption}"`,
      "",
      "Review the FIRST image (the render). The other two images are exemplars of the bar:",
      "publication figures that sit natively inside a LaTeX paper.",
      'Answer as JSON: {"demonstrates_claim": bool, "issues": [{"severity", "selector", "problem", "fix"}], "readable_at_50pct": bool}',
      "- Would a reviewer notice this was NOT made with TikZ/pgfplots? A web-app look (rounded cards, pill badges, UI fonts, drop shadows) = reject.",
      "- Any pseudo-math (sigma_ch, x^2 as plain text)? Every symbol must be typeset in a .math span.",
      "- Minimal in-figure prose: the caption explains, the figure shows. No headline inside the figure; panels are (a), (b).",
      "- Is this the RIGHT ENGINE? A plot drawn as boxes, or a diagram forced onto axes, is a " +
        "wrong-engine failure: say so and re-scaffold on the other engine rather than patching this one.",
      "- Is the element the caption is about the most salient thing?",
      "- Is anything encoded twice (color + position for the same variable)?",
      "- Would it survive at 50% scale? In grayscale?",
      "If issues remain, patch figure.html by selector and rerun figure_render + figure_lint. Max 4 iterations, then stop and surface to the user.",
    ].join("\n")
    // Exemplars are the bar the model steers toward, so they must match the engine. Showing
    // a matplotlib chart the four-bar div exemplar would steer it back into exactly the
    // ceiling this engine exists to escape.
    const exemplars =
      meta.engine === "mpl"
        ? ["exemplar-chart-mpl.png", "exemplar-schematic.png"]
        : ["exemplar-schematic.png", "exemplar-chart.png"]
    return {
      content: [
        image(join(dir, "build", `${a.name}.png`)),
        ...exemplars.map((file) => image(join(EXEMPLARS, file))),
        { type: "text" as const, text: rubric },
      ],
    }
  },
)

server.registerTool(
  "data_query",
  {
    description:
      "Read-only jq over JSON files in the workspace (artifacts/, figures/*/data.json). This is how numbers travel into figures — never retype them.",
    inputSchema: { workspace: ws, path: z.string(), jq_expr: z.string() },
  },
  async (a) => text(await dataQuery(a.workspace, a.path, a.jq_expr)),
)

await server.connect(new StdioServerTransport())
