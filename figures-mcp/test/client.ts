import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { join } from "node:path"

export async function connect() {
  const transport = new StdioClientTransport({
    command: "bun",
    args: [join(import.meta.dir, "..", "src", "server.ts")],
  })
  const client = new Client({ name: "figures-test", version: "0.0.0" })
  await client.connect(transport)
  return { client, close: () => client.close() }
}
