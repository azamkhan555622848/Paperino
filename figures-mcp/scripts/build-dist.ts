#!/usr/bin/env bun
// Builds the packaged form of figures-mcp: a node-target bundle that runs under
// ELECTRON_RUN_AS_NODE on the app's own electron.exe, so users need no bun and no node.
//
// The render worker stays a SEPARATE file — it is spawned as a child process (Playwright
// hangs under bun; see render-worker.mjs) and resolves playwright from a real node_modules
// placed next to it. assets/ and templates/ ship alongside because scaffold.ts and
// render.ts read them relative to import.meta.dir.
import { cpSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const dist = join(root, "dist")

// route.js must be regenerated BEFORE assets/ is copied, or dist ships a stale browser lib.
await Bun.$`bun ${join(root, "scripts", "build-lib.ts")}`.quiet()

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

const result = await Bun.build({
  entrypoints: [join(root, "src", "server.ts")],
  outdir: dist,
  target: "node",
  format: "esm",
  naming: "server.mjs",
  external: ["playwright", "playwright-core"], // worker-only; server.ts never imports them
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

cpSync(join(root, "src", "render-worker.mjs"), join(dist, "render-worker.mjs"))
// Skip Python bytecode. Importing paperino_mpl.py during dev leaves a __pycache__ beside it,
// and cpSync copies whole trees — so a .pyc compiled by the DEV interpreter was riding into
// the installer, where the runtime is a different CPython that can only ignore it.
const noPycache = { recursive: true, filter: (src: string) => !src.includes("__pycache__") }
cpSync(join(root, "src", "assets"), join(dist, "assets"), noPycache)
cpSync(join(root, "src", "templates"), join(dist, "templates"), noPycache)
for (const pkg of ["playwright", "playwright-core"]) {
  cpSync(join(root, "node_modules", pkg), join(dist, "node_modules", pkg), {
    recursive: true,
    dereference: true,
  })
}
console.log("dist ready:", dist)
