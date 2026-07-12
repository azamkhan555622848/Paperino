import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensurePackagedConfig, renderTemplate } from "./packaged"

test("renderTemplate substitutes every token", () => {
  const out = renderTemplate('{"a":"{{RESOURCES}}/bin","b":"{{ELECTRON}}"}', {
    RESOURCES: "C:/app/resources/paperino",
    ELECTRON: "C:/app/Paperino.exe",
  })
  expect(out).toBe('{"a":"C:/app/resources/paperino/bin","b":"C:/app/Paperino.exe"}')
})

test("renderTemplate throws on unknown leftover tokens", () => {
  // A typo'd token must fail loudly at boot, not ship a config with a literal {{...}}
  // that the sidecar would then try to exec as a path.
  expect(() => renderTemplate("x {{NOPE}} y", { RESOURCES: "r" })).toThrow(/NOPE/)
})

test("ensurePackagedConfig copies, renders, and is machine-owned", () => {
  const tmp = mkdtempSync(join(tmpdir(), "pkgcfg-"))
  const resources = join(tmp, "resources", "paperino")
  const userData = join(tmp, "userData")
  mkdirSync(join(resources, "paperino-config", "command"), { recursive: true })
  writeFileSync(join(resources, "paperino-config", "AGENTS.md"), "persona")
  writeFileSync(join(resources, "paperino-config", "command", "new-paper.md"), "cmd")
  writeFileSync(
    join(resources, "paperino-config", "opencode.packaged.jsonc"),
    '{ "mcp": { "figures": { "command": ["{{ELECTRON}}", "{{RESOURCES}}/figures-mcp/server.mjs"] } } }',
  )

  const dir = ensurePackagedConfig({ resources, userData, electronExe: "C:\\app\\Paperino.exe" })

  expect(dir).toBe(join(userData, "paperino-config"))
  expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe("persona")
  const rendered = readFileSync(join(dir, "opencode.jsonc"), "utf8")
  expect(rendered).toContain('"C:/app/Paperino.exe"')
  expect(rendered).toContain("/figures-mcp/server.mjs")
  // the template itself must not linger in the live config dir
  expect(existsSync(join(dir, "opencode.packaged.jsonc"))).toBe(false)

  // machine-owned: a file removed in a new version must not survive the update
  writeFileSync(join(dir, "stale.txt"), "old")
  ensurePackagedConfig({ resources, userData, electronExe: "C:\\app\\Paperino.exe" })
  expect(existsSync(join(dir, "stale.txt"))).toBe(false)
})
