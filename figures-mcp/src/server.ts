import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

export const server = new McpServer({ name: "figures-mcp", version: "0.1.0" })

server.registerTool("ping", { description: "Liveness check" }, async () => ({
  content: [{ type: "text", text: "pong" }],
}))

await server.connect(new StdioServerTransport())
