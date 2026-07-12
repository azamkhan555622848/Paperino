import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensurePackagedConfig, packagedEnv, renderTemplate } from "./packaged"

// Three files declare the app id independently: electron-builder stamps it into the installer,
// main/index.ts derives userData from it, and copy-metainfo.ts names the Linux AppStream entry
// after it. When the first two drifted, a packaged Paperino installed as ai.paperino.desktop but
// wrote its state into ai.opencode.desktop — the directory an InteJer install owns. copy-metainfo
// drifted too, shipping OpenCode's id, name and bugtracker inside Paperino's own app.asar, since
// electron-builder packs resources/**/*. Read as text: importing index.ts needs electron.
function appIds(file: string): Record<string, string> {
  const source = readFileSync(join(import.meta.dir, file), "utf8")
  const block = source.match(/const APP_IDS[^{]*\{([^}]*)\}/)
  if (!block) throw new Error(`no APP_IDS in ${file}`)
  return Object.fromEntries([...block[1]!.matchAll(/(\w+):\s*"([^"]+)"/g)].map((m) => [m[1]!, m[2]!]))
}

test("every declaration of the app id agrees, so userData cannot collide with InteJer", () => {
  const main = appIds("../index.ts")
  const builder = appIds("../../../electron-builder.config.ts")
  const metainfo = appIds("../../../scripts/copy-metainfo.ts")

  expect(main).toEqual(builder)
  expect(main).toEqual(metainfo)
  expect(main.prod).toBe("ai.paperino.desktop")
  for (const id of Object.values(main)) expect(id).toStartWith("ai.paperino.desktop")
})

// The generator names its output after the app id, so a rename must not strand the previous
// file in resources/ — electron-builder packs resources/**/*, and both would ship.
test("copy-metainfo sweeps stale metainfo files before writing", () => {
  const source = readFileSync(join(import.meta.dir, "../../../scripts/copy-metainfo.ts"), "utf8")
  expect(source).toMatch(/rmSync\(.*metainfo|\.metainfo\.xml[\s\S]*rmSync/)
})

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

test("packagedEnv isolates the XDG dirs and wires every tool path", () => {
  const env = packagedEnv({
    resources: "C:/app/resources/paperino",
    userData: "C:/ud",
    electronExe: "C:/app/Paperino.exe",
    configDir: "C:/ud/paperino-config",
    basePath: "C:/Windows/system32",
  })
  expect(env).toEqual({
    OPENCODE_CONFIG_DIR: "C:/ud/paperino-config",
    // The InteJer firewall: with its own XDG dirs the sidecar never merges the
    // machine-global ~/.config/opencode (InteJer's hardware servers + skills), and its
    // auth store is its own rather than the shared ~/.local/share/opencode/auth.json.
    XDG_CONFIG_HOME: "C:/ud/xdg/config",
    XDG_DATA_HOME: "C:/ud/xdg/data",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    // ~/.opencode is resolved from os.homedir(), so the XDG pair above cannot reach it and
    // every session loads its skills. A packaged build proved it: InteJer's ten IoT skills
    // (esp32-dev, stm32-dev, zephyr-rtos...) were discoverable by the paper agent.
    OPENCODE_DISABLE_HOME_CONFIG: "1",
    PAPERINO_TECTONIC: "C:/app/resources/paperino/bin/tectonic/tectonic.exe",
    PLAYWRIGHT_BROWSERS_PATH: "C:/ud/browsers",
    PAPERINO_PYTHON: "C:/ud/python/python.exe",
    PATH: `${join("C:/ud", "python")};C:/Windows/system32`,
  })
})
