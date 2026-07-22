import { beforeAll, expect, test } from "bun:test"
import { execFileSync, execSync, spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// The packaged app has no bun and no node — literature-mcp runs as a node-target bundle under
// ELECTRON_RUN_AS_NODE. This suite proves the bundle is self-contained and actually speaks MCP on a
// plain node runtime, which is the part that cannot be checked from source.
const ROOT = join(import.meta.dir, "..")
const DIST = join(ROOT, "dist")

beforeAll(() => {
  execFileSync("bun", [join(ROOT, "scripts", "build-dist.ts")], { stdio: "inherit" })
})

test("dist layout is complete", () => {
  expect(existsSync(join(DIST, "server.mjs"))).toBe(true)
})

test("dist bakes in no path from the machine that built it", () => {
  // figures-mcp once shipped C:\Users\<me>\...\jq.exe as a default, which exists on exactly one
  // machine. The bundle stores such a path as JS SOURCE, so its separators are escaped: grepping
  // for homedir() ("C:\Users\me") misses "C:\\Users\\me" and the test passes over a real bug.
  // Unescape first, and check the forward-slash spelling too.
  const bundle = readFileSync(join(DIST, "server.mjs"), "utf8")
  const unescaped = bundle.split("\\\\").join("\\")
  const forward = (p: string) => p.split("\\").join("/")

  for (const machinePath of [homedir(), ROOT]) {
    expect(unescaped).not.toInclude(machinePath)
    expect(bundle).not.toInclude(forward(machinePath))
  }
})

test("dist bakes in no TDM key", () => {
  // A key in the bundle is one institution's entitlement shipped to every machine — the same
  // failure class as the old X-API-Key in a config. Keys are read from auth.json at call time;
  // only the ENV VAR NAMES and the auth-store key names may appear here.
  const bundle = readFileSync(join(DIST, "server.mjs"), "utf8")
  const auth = join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode", "auth.json")
  if (!existsSync(auth)) return
  const store = JSON.parse(readFileSync(auth, "utf8")) as Record<string, { key?: string } | undefined>
  for (const name of ["tdm-springer", "tdm-elsevier", "tdm-wiley"]) {
    const key = store[name]?.key
    if (key && key.length > 8) expect(bundle).not.toInclude(key)
  }
})

test(
  "dist server answers MCP initialize under plain node",
  async () => {
    const nodeExe = execSync("where node", { encoding: "utf8" }).split(/\r?\n/)[0]!.trim()
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
