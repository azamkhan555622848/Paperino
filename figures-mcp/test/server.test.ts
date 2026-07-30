import { expect, test } from "bun:test"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { connect } from "./client"

const WS = join(import.meta.dir, "tmp-server-ws")

test(
  "server starts and lists exactly the five figure tools",
  async () => {
    const { client, close } = await connect()
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort()
      expect(names).toEqual(["data_query", "figure_lint", "figure_render", "figure_review", "figure_scaffold"])
    } finally {
      await close()
    }
  },
  30_000,
)

test(
  "full loop over MCP: scaffold -> render -> lint -> review",
  async () => {
    rmSync(WS, { recursive: true, force: true })
    mkdirSync(WS, { recursive: true })
    const { client, close } = await connect()
    try {
      const scaffolded = await client.callTool({
        name: "figure_scaffold",
        arguments: { workspace: WS, name: "fig-x", archetype: "schematic", claim: "A precedes B", caption: "cap", width: "narrow" },
      })
      // The catalogue must survive the trip over MCP: it is the only place the agent is told
      // what the surface is, and a blank canvas with no catalogue is a blank canvas with no
      // API. `data-legend` in particular existed nowhere an author could read it.
      const scaffoldText = (scaffolded.content as any[]).find((c) => c.type === "text").text
      expect(scaffoldText).toContain("data-legend")
      expect(scaffoldText).toContain("arrow(")
      // ...and the default really is the canvas, end to end, not just in scaffold()'s unit test.
      expect(readFileSync(join(WS, "figures", "fig-x", "figure.html"), "utf8")).not.toContain("panel-label")
      const rendered = await client.callTool({ name: "figure_render", arguments: { workspace: WS, name: "fig-x" } })
      expect(JSON.stringify(rendered.content)).toContain("png")

      const linted = await client.callTool({ name: "figure_lint", arguments: { workspace: WS, name: "fig-x" } })
      const lintText = (linted.content as any[]).find((c) => c.type === "text").text
      expect(JSON.parse(lintText).passed).toBe(true)

      const review = await client.callTool({ name: "figure_review", arguments: { workspace: WS, name: "fig-x" } })
      const types = (review.content as any[]).map((c) => c.type)
      expect(types.filter((t) => t === "image").length).toBe(3) // render + 2 exemplars
      expect(JSON.stringify(review.content)).toContain("A precedes B")
    } finally {
      await close()
    }
  },
  180_000,
)

test(
  "figure_review refuses when lint has not passed",
  async () => {
    const { client, close } = await connect()
    try {
      const res = await client.callTool({ name: "figure_review", arguments: { workspace: WS, name: "never-linted" } })
      expect(JSON.stringify(res.content)).toMatch(/lint|render/i)
    } finally {
      await close()
    }
  },
  30_000,
)
