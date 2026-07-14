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
      "Create a new figure from an archetype template (schematic|gallery|chart|table). Write the claim — the one sentence the figure must demonstrate — BEFORE designing. Vendors tokens.css + lib/ into the workspace on first use.",
    inputSchema: {
      workspace: ws,
      name: figName,
      archetype: z.enum(["schematic", "gallery", "chart", "table"]),
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
      `scaffolded ${figureDir}. Edit figure.html (layout=HTML/flex/grid, annotations=lib/annot.js, colors=var(--…) only), put numbers in data.json, then figure_render.`,
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
      "Deterministic quality gate (13 rules: overlap, overflow, 7pt type floor, contrast, raw colors, stroke floor, palette, number provenance, svg viewBox, meta, pseudo-math, web-chrome, font allowlist). Must pass before figure_review. Patch by selector.",
    inputSchema: { workspace: ws, name: figName },
  },
  async (a) => {
    const dir = join(a.workspace, "figures", a.name)
    const bboxPath = join(dir, "build", "bboxes.json")
    if (!existsSync(bboxPath)) return text("no render found — run figure_render first")
    const errors = lint({
      source: readFileSync(join(dir, "figure.html"), "utf8"),
      meta: parse(readFileSync(join(dir, "meta.yaml"), "utf8")),
      data: JSON.parse(readFileSync(join(dir, "data.json"), "utf8")),
      manifest: JSON.parse(readFileSync(bboxPath, "utf8")),
    })
    const result = { passed: errors.length === 0, errors }
    writeFileSync(join(dir, "build", "lint.json"), JSON.stringify(result, null, 1))
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
      "- Is the element the caption is about the most salient thing?",
      "- Is anything encoded twice (color + position for the same variable)?",
      "- Would it survive at 50% scale? In grayscale?",
      "If issues remain, patch figure.html by selector and rerun figure_render + figure_lint. Max 4 iterations, then stop and surface to the user.",
    ].join("\n")
    return {
      content: [
        image(join(dir, "build", `${a.name}.png`)),
        image(join(EXEMPLARS, "exemplar-schematic.png")),
        image(join(EXEMPLARS, "exemplar-chart.png")),
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
