#!/usr/bin/env bun
// The packaged form: a node-target bundle run under ELECTRON_RUN_AS_NODE on the app's own
// electron.exe, so an installed Paperino needs neither bun nor node.
//
// Unlike figures-mcp there is nothing to vendor alongside it — no worker process, no browser, no
// assets. literature-mcp is fetch plus fs.
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const dist = join(root, "dist")

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

const result = await Bun.build({
  entrypoints: [join(root, "src", "server.ts")],
  outdir: dist,
  target: "node",
  format: "esm",
  naming: "server.mjs",
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
console.log("dist ready:", dist)
