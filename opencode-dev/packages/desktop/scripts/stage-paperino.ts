#!/usr/bin/env bun
// Assembles resources-paperino/, which electron-builder ships as <resources>/paperino —
// everything the packaged app needs beyond its own JS bundles.
//
// This directory is BUILD OUTPUT (like resources/icons): it is wiped and rebuilt on every
// prebuild, so never edit it by hand.
import { $ } from "bun"
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

const desktop = join(import.meta.dir, "..")
// packages/desktop -> packages -> opencode-dev -> Paperino
const paperino = join(desktop, "..", "..", "..")
const out = join(desktop, "resources-paperino")

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// 1. Config: persona, commands, office skills, and the TOKEN TEMPLATE. The dev
//    opencode.jsonc is deliberately not shipped — it is full of this machine's paths.
const cfgSrc = join(paperino, "opencode-dev", "paperino-config")
const cfgOut = join(out, "paperino-config")
mkdirSync(cfgOut, { recursive: true })
for (const item of ["AGENTS.md", "command", "skill", "opencode.packaged.jsonc"]) {
  const from = join(cfgSrc, item)
  if (!existsSync(from)) throw new Error(`staging: missing ${from}`)
  cpSync(from, join(cfgOut, item), { recursive: true })
}

// 2. Pinned binaries the app shells out to.
for (const bin of ["tectonic", "jq"]) {
  const from = join(paperino, "tools", bin)
  if (!existsSync(from)) throw new Error(`staging: missing ${from} — see CLAUDE.md (tools/ is gitignored)`)
  cpSync(from, join(out, "bin", bin), { recursive: true })
}

// 3. figures-mcp as a node-target bundle (runs on the app's own electron.exe).
await $`bun ${join(paperino, "figures-mcp", "scripts", "build-dist.ts")}`.cwd(join(paperino, "figures-mcp"))
cpSync(join(paperino, "figures-mcp", "dist"), join(out, "figures-mcp"), { recursive: true })

// 3b. literature-mcp, same node-target trick. Paperclip needs no staging at all — it is a URL.
await $`bun ${join(paperino, "literature-mcp", "scripts", "build-dist.ts")}`.cwd(join(paperino, "literature-mcp"))
cpSync(join(paperino, "literature-mcp", "dist"), join(out, "literature-mcp"), { recursive: true })

// 4. PaperBanana: our server, its lock, and the upstream source (minus repo junk).
const pbOut = join(out, "paperbanana")
mkdirSync(pbOut, { recursive: true })
cpSync(join(paperino, "paperbanana-mcp", "server.py"), join(pbOut, "server.py"))
cpSync(join(paperino, "paperbanana-mcp", "requirements.lock"), join(pbOut, "requirements.lock"))
cpSync(join(paperino, "PaperBanana-main"), join(pbOut, "PaperBanana-main"), {
  recursive: true,
  filter: (src) => !/[\\/]\.git([\\/]|$)|__pycache__|\.venv/.test(src),
})

console.log("staged:", out)
