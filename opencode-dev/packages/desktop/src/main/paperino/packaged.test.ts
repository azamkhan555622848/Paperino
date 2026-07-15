import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensurePackagedConfig, packagedEnv, packagedTokens, renderTemplate } from "./packaged"

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
    // Both interpreters must also be reachable BY NAME — see the next test.
    PATH: `${join("C:/ud", "python")};${join("C:/app/resources/paperino", "bin", "tectonic")};C:/Windows/system32`,
  })
})

// The agent compiles a non-root .tex by shelling out to a bare `tectonic` (AGENTS.md tells it
// to). PAPERINO_TECTONIC does not help there — that variable is read by the Electron main
// process, so a packaged build's Preview panel compiled happily while the agent, one process
// away, reported "the local LaTeX compiler is unavailable" and refused to preview the file.
// There is no pdflatex/latexmk/xelatex to fall back to; the binary we ship has to be on PATH.
test("a bare `tectonic` and a bare `python` resolve to the binaries we ship", () => {
  const env = packagedEnv({
    resources: "C:/app/resources/paperino",
    userData: "C:/ud",
    electronExe: "C:/app/Paperino.exe",
    configDir: "C:/ud/paperino-config",
    basePath: "C:/Windows/system32",
  })
  const dirs = env.PATH!.split(";")
  expect(dirs).toContain(join("C:/app/resources/paperino", "bin", "tectonic"))
  expect(dirs).toContain(join("C:/ud", "python"))
  // Ours win over whatever the user already has installed.
  expect(dirs.indexOf("C:/Windows/system32")).toBe(dirs.length - 1)
})

describe("the packaged config registers the citation stack", () => {
  const rendered = () => {
    // packaged.test.ts lives at packages/desktop/src/main/paperino/
    const template = readFileSync(
      join(import.meta.dir, "..", "..", "..", "..", "..", "paperino-config", "opencode.packaged.jsonc"),
      "utf8",
    )
    return renderTemplate(
      template,
      packagedTokens({
        resources: "C:/app/resources/paperino",
        userData: "C:/ud",
        electronExe: "C:/app/Paperino.exe",
      }),
    )
  }

  test("literature-mcp runs on the app's own executable", () => {
    const config = rendered()
    expect(config).toContain("C:/app/resources/paperino/literature-mcp/server.mjs")
    expect(config).toContain('"ELECTRON_RUN_AS_NODE": "1"')
  })

  // Paperclip authenticates by MCP OAuth (dynamic client registration + PKCE). An X-API-Key here
  // would bake a secret into the installer — and ship one user's key to everyone who downloads it.
  test("paperclip is a bare URL with no credential in it", () => {
    const config = rendered()
    expect(config).toContain('"url": "https://paperclip.gxl.ai/mcp"')
    expect(config).not.toContain("X-API-Key")
    expect(config).not.toContain("gxl_")
  })

  // The keystone of product rule 2. Without this the agent can hand-write references.bib — or paste
  // in the BibTeX that paperclip's own `export` tool hands it — and "machine-owned" means nothing.
  // findLast semantics: the allow must come FIRST, or the deny is shadowed and silently useless.
  test("the agent is denied write access to references.bib", () => {
    const config = rendered()
    const edit = config.indexOf('"edit"')
    expect(edit).toBeGreaterThan(-1)
    const allow = config.indexOf('"*": "allow"', edit)
    const deny = config.indexOf('"references.bib": "deny"', edit)
    expect(allow).toBeGreaterThan(-1)
    expect(deny).toBeGreaterThan(allow)
  })

  test("no token survives rendering", () => {
    expect(rendered()).not.toContain("{{")
  })
})
