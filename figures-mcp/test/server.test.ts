import { expect, test } from "bun:test"
import { connect } from "./client"

test(
  "server starts and lists tools over stdio",
  async () => {
    const { client, close } = await connect()
    try {
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name)).toContain("ping")
    } finally {
      await close()
    }
  },
  30_000,
)
