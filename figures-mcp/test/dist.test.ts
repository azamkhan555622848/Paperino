import { beforeAll, expect, test } from "bun:test"
import { execFileSync, execSync, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

// The packaged app has no bun and no node: figures-mcp ships as a node-target bundle run
// under ELECTRON_RUN_AS_NODE. This suite proves the bundle is self-contained and actually
// speaks MCP on a plain node runtime — the thing that cannot be verified from source.
const ROOT = join(import.meta.dir, "..")
const DIST = join(ROOT, "dist")

beforeAll(() => {
  execFileSync("bun", [join(ROOT, "scripts", "build-dist.ts")], { stdio: "inherit" })
})

test("dist layout is complete", () => {
  for (const p of [
    "server.mjs",
    "render-worker.mjs",
    "assets/tokens.css",
    "assets/lib/katex/katex.mjs",
    "templates/schematic/figure.html",
    "node_modules/playwright/cli.js",
    "node_modules/playwright-core/package.json",
  ])
    expect(existsSync(join(DIST, p))).toBe(true)
})

test(
  "dist server answers MCP initialize under plain node",
  async () => {
    const nodeExe = execSync("where node", { encoding: "utf8" }).split(/\r?\n/)[0].trim()
    const child = spawn(nodeExe, [join(DIST, "server.mjs")], { stdio: ["pipe", "pipe", "pipe"] })
    const request =
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "dist-smoke", version: "0" },
        },
      }) + "\n"
    let errbuf = ""
    const reply = await new Promise<string>((resolve, reject) => {
      let buffer = ""
      const timer = setTimeout(() => reject(new Error(`no reply; stderr: ${errbuf}`)), 20_000)
      child.stderr.on("data", (d) => (errbuf += d))
      child.stdout.on("data", (d) => {
        buffer += d
        if (buffer.includes('"result"')) {
          clearTimeout(timer)
          resolve(buffer)
        }
      })
      child.stdin.write(request)
    }).finally(() => child.kill())
    expect(reply).toContain('"serverInfo"')
  },
  60_000,
)
