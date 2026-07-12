# Paperino Installer — Plan A (Packaging, Isolation, Runtimes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Windows NSIS installer of Paperino that runs on a machine with no bun/node/Python/Chromium, fully isolated from InteJer, with first-run runtime setup plumbing ready for the onboarding wizard (Plan B).

**Architecture:** Own product identity in electron-builder; a staging script assembles `resources/paperino/` (config template, Tectonic, jq, node-target figures-mcp bundle, PaperBanana source); at boot the main process renders the config template into userData and injects an isolated env (XDG dirs, tool paths) that the sidecar and every MCP child inherit; a DI-friendly setup service downloads Chromium and portable CPython into userData behind an IPC surface.

**Tech Stack:** electron-builder (NSIS), electron-updater, `ELECTRON_RUN_AS_NODE`, `bun build --target=node`, Playwright CLI installer, python-build-standalone, bun:test.

**Spec:** `docs/superpowers/specs/2026-07-13-paperino-installer-onboarding-design.md` (§1–§4, §7, plus §3 setup service; §5/§6 wizard+keys+models are **Plan B**).

## Global Constraints

- Repo root is `C:/Users/azamk/Documents` (mega-repo). **Never `git add -A`**; stage explicit paths. Paths below are relative to `C:/Users/azamk/Documents/Paperino/` unless noted.
- Identity (spec §1): appId `ai.paperino.desktop{.dev,.beta}`, productName `Paperino {Dev,Beta}`, artifact `paperino-${os}-${arch}.${ext}`, protocol scheme `paperino`, publish `{ provider: "github", owner: "azamkhan555622848", repo: "Paperino" }` (beta+prod).
- Isolation env (packaged only): `XDG_CONFIG_HOME={userData}/xdg/config`, `XDG_DATA_HOME={userData}/xdg/data`, `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`, `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1`. Dev flow (`paperino-dev.cmd`) untouched — everything keys off `app.isPackaged`.
- Template tokens, exactly: `{{RESOURCES}}` (= `<process.resourcesPath>/paperino`, forward slashes), `{{USERDATA}}`, `{{ELECTRON}}` (= `process.execPath`). Unknown leftover `{{...}}` after render = error.
- figures worker env contract: `PAPERINO_FIGURES_NODE` = node-compatible executable for the render worker; when set, the worker child env also gets `ELECTRON_RUN_AS_NODE=1` (plain node ignores it).
- No CDN/network at MCP runtime; the only downloads are the two first-run setup components into `{userData}`.
- Tests: `bun test` in the package being touched. Playwright hangs under bun — never move browser work into a bun process.
- Commit after every task with the exact listed paths. Conventional commits.

---

### Task 1: figures-mcp — worker exe override + node-target dist bundle

**Files:**
- Modify: `figures-mcp/src/render.ts` (the `runWorker` execFile call, ~line 40)
- Create: `figures-mcp/scripts/build-dist.ts`
- Modify: `figures-mcp/package.json` (add `"build:dist"` script)
- Test: `figures-mcp/test/render.test.ts` (extend), `figures-mcp/test/dist.test.ts` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: env contract `PAPERINO_FIGURES_NODE` (worker executable path; adds `ELECTRON_RUN_AS_NODE=1` to the worker env when set) consumed by the packaged config template (Task 3). Build output `figures-mcp/dist/` = `{ server.mjs, render-worker.mjs, assets/, templates/, node_modules/{playwright,playwright-core} }`, consumed by the staging script (Task 7). `dist/server.mjs` must start under any node-compatible runtime and answer MCP `initialize`.

- [ ] **Step 1: Write the failing override test**

Append to `figures-mcp/test/render.test.ts`:

```ts
test(
  "PAPERINO_FIGURES_NODE overrides the worker executable",
  async () => {
    // A fake "node" that always exits 7 proves render spawns the override, not "node".
    const fake = join(WS, "fake-node.cmd")
    writeFileSync(fake, "@echo off\r\nexit /b 7\r\n")
    process.env.PAPERINO_FIGURES_NODE = fake
    try {
      await scaffold(WS, { name: "fig-override", archetype: "schematic", claim: "c", caption: "c", width: "narrow" })
      const result = await render(WS, "fig-override")
      expect(result.ok).toBe(false) // fake node produced no __RESULT__ marker
    } finally {
      delete process.env.PAPERINO_FIGURES_NODE
    }
  },
  120_000,
)
```

Run: `cd C:/Users/azamk/Documents/Paperino/figures-mcp && bun test test/render.test.ts`
Expected: FAIL — `result.ok` is `true` because the override is ignored and the real worker ran.

- [ ] **Step 2: Implement the override in `src/render.ts`**

Replace the `execFile("node", ...)` opening of `runWorker` with:

```ts
    // Packaged builds have no node on PATH: the app sets PAPERINO_FIGURES_NODE to its
    // own electron.exe, and ELECTRON_RUN_AS_NODE makes that behave as node. Plain node
    // ignores the variable, so setting it unconditionally here is safe.
    const workerExe = process.env.PAPERINO_FIGURES_NODE || "node"
    execFile(
      workerExe,
      [WORKER, jobPath],
      {
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      },
```

(Everything after the options object is unchanged.)

Run: `bun test test/render.test.ts` → Expected: PASS (all, including the new test).

- [ ] **Step 3: Write the dist bundler**

Create `figures-mcp/scripts/build-dist.ts`:

```ts
#!/usr/bin/env bun
// Builds the packaged form of figures-mcp: a node-target bundle that runs under
// ELECTRON_RUN_AS_NODE (no bun on user machines). The render worker stays a separate
// file (it is spawned as a child) and resolves playwright from a real node_modules
// placed next to it. assets/ and templates/ ship alongside because scaffold.ts reads
// them relative to import.meta.dir.
import { cpSync, mkdirSync, rmSync } from "node:fs"
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
  external: ["playwright", "playwright-core"], // worker-only deps; server.ts never imports them
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

cpSync(join(root, "src", "render-worker.mjs"), join(dist, "render-worker.mjs"))
cpSync(join(root, "src", "assets"), join(dist, "assets"), { recursive: true })
cpSync(join(root, "src", "templates"), join(dist, "templates"), { recursive: true })
for (const pkg of ["playwright", "playwright-core"]) {
  cpSync(join(root, "node_modules", pkg), join(dist, "node_modules", pkg), {
    recursive: true,
    dereference: true,
  })
}
console.log("dist ready:", dist)
```

Add to `figures-mcp/package.json` scripts: `"build:dist": "bun scripts/build-dist.ts"`.

- [ ] **Step 4: Dist smoke test**

Create `figures-mcp/test/dist.test.ts`:

```ts
import { beforeAll, expect, test } from "bun:test"
import { execFileSync, execSync, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

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
```

Run: `bun test test/dist.test.ts` → Expected: PASS (2 tests). If the bundle fails on an unbundlable import, the build error names the module — add it to `external` **and** copy it into `dist/node_modules` in `build-dist.ts` (same pattern as playwright).

- [ ] **Step 5: Full suite + commit**

Run: `bun test` → Expected: all PASS.

```bash
cd C:/Users/azamk/Documents
git add Paperino/figures-mcp/src/render.ts Paperino/figures-mcp/scripts/build-dist.ts \
  Paperino/figures-mcp/package.json Paperino/figures-mcp/test/render.test.ts \
  Paperino/figures-mcp/test/dist.test.ts
git commit -m "feat(figures): packaged runtime — worker exe override + node-target dist bundle"
```

---

### Task 2: Paperino identity in electron-builder + protocol scheme

**Files:**
- Modify: `opencode-dev/packages/desktop/electron-builder.config.ts`
- Modify: `opencode-dev/packages/desktop/electron-builder.config.test.ts`
- Modify: `opencode-dev/packages/desktop/src/main/index.ts` (lines ~199 and ~264)

**Interfaces:**
- Consumes: nothing.
- Produces: channel identities used by everything packaged. appIds `ai.paperino.desktop{.dev,.beta,""}`; publish config on beta+prod → `azamkhan555622848/Paperino`; protocol scheme `paperino`.

- [ ] **Step 1: Update the config test (failing)**

In `electron-builder.config.test.ts` replace the `channels` array with:

```ts
const channels = [
  { channel: "dev", appId: "ai.paperino.desktop.dev" },
  { channel: "beta", appId: "ai.paperino.desktop.beta" },
  { channel: "prod", appId: "ai.paperino.desktop" },
] as const
```

and append inside the same `for` loop body, after the existing expectations:

```ts
    expect(config.artifactName).toBe("paperino-${os}-${arch}.${ext}")
    if (channel.channel !== "dev") {
      expect(config.publish).toEqual({
        provider: "github",
        owner: "azamkhan555622848",
        repo: "Paperino",
        channel: "latest",
      })
    }
```

Leave the legacy-Linux-pin test untouched (it asserts a shipped compat file, not identity).

Run: `cd C:/Users/azamk/Documents/Paperino/opencode-dev/packages/desktop && bun test electron-builder.config.test.ts`
Expected: FAIL — appIds still `ai.opencode.desktop*`.

- [ ] **Step 2: Rebrand the builder config**

In `electron-builder.config.ts`:

(a) Replace the `APP_IDS` block:

```ts
const APP_IDS = {
  dev: "ai.paperino.desktop.dev",
  beta: "ai.paperino.desktop.beta",
  prod: "ai.paperino.desktop",
} as const
```

(b) In `getBase`, replace `artifactName` and `protocols`:

```ts
  artifactName: "paperino-${os}-${arch}.${ext}",
```

```ts
  protocols: {
    name: "Paperino",
    schemes: ["paperino"],
  },
```

(c) Replace the three channel cases' identity:

```ts
    case "dev": {
      return {
        ...base,
        appId,
        productName: "Paperino Dev",
        rpm: { packageName: "paperino-dev" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: "Paperino Beta",
        protocols: { name: "Paperino Beta", schemes: ["paperino"] },
        publish: { provider: "github", owner: "azamkhan555622848", repo: "Paperino", channel: "latest" },
        rpm: { packageName: "paperino-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: "Paperino",
        protocols: { name: "Paperino", schemes: ["paperino"] },
        publish: { provider: "github", owner: "azamkhan555622848", repo: "Paperino", channel: "latest" },
        deb: { fpm: [legacyDesktopEntryFpm] },
        rpm: { packageName: "paperino", fpm: [legacyDesktopEntryFpm] },
      }
    }
```

- [ ] **Step 3: Protocol scheme in main**

In `src/main/index.ts`: change line ~264 `app.setAsDefaultProtocolClient("opencode")` → `app.setAsDefaultProtocolClient("paperino")`, and line ~199 `arg.startsWith("opencode://")` → `arg.startsWith("paperino://")`. Then verify nothing else references the old scheme:

Run: `grep -rn "opencode://" src/main src/preload | grep -v http`
Expected: no remaining hits.

- [ ] **Step 4: Run tests + commit**

Run: `bun test electron-builder.config.test.ts` → Expected: PASS.

```bash
cd C:/Users/azamk/Documents
git add Paperino/opencode-dev/packages/desktop/electron-builder.config.ts \
  Paperino/opencode-dev/packages/desktop/electron-builder.config.test.ts \
  Paperino/opencode-dev/packages/desktop/src/main/index.ts
git commit -m "feat(desktop): Paperino product identity — appIds, artifact, paperino:// scheme, publish repo"
```

---

### Task 3: Packaged config template + renderer (`packaged.ts`)

**Files:**
- Create: `opencode-dev/paperino-config/opencode.packaged.jsonc`
- Create: `opencode-dev/packages/desktop/src/main/paperino/packaged.ts`
- Test: `opencode-dev/packages/desktop/src/main/paperino/packaged.test.ts`

**Interfaces:**
- Consumes: figures dist layout + `PAPERINO_FIGURES_NODE` contract (Task 1).
- Produces:
  - `renderTemplate(text: string, tokens: Record<string, string>): string` — replaces every `{{KEY}}`; throws listing any unknown `{{...}}` left over.
  - `packagedTokens(opts: PackagedPaths): Record<string, string>` with `PackagedPaths = { resources: string; userData: string; electronExe: string }`.
  - `ensurePackagedConfig(opts: PackagedPaths): string` — copies `<resources>/paperino-config` → `<userData>/paperino-config` (machine-owned, wiped each call), renders `opencode.packaged.jsonc` → `opencode.jsonc`, removes the template copy, returns the config dir path.
  - Consumed by Task 4 (env) and Task 7 (boot hook).

- [ ] **Step 1: Write the failing tests**

Create `packaged.test.ts`:

```ts
import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { renderTemplate, ensurePackagedConfig } from "./packaged"

test("renderTemplate substitutes every token", () => {
  const out = renderTemplate('{"a":"{{RESOURCES}}/bin","b":"{{ELECTRON}}"}', {
    RESOURCES: "C:/app/resources/paperino",
    ELECTRON: "C:/app/Paperino.exe",
  })
  expect(out).toBe('{"a":"C:/app/resources/paperino/bin","b":"C:/app/Paperino.exe"}')
})

test("renderTemplate throws on unknown leftover tokens", () => {
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
  expect(existsSync(join(dir, "opencode.packaged.jsonc"))).toBe(false)

  // machine-owned: stale files from a previous version disappear on re-run
  writeFileSync(join(dir, "stale.txt"), "old")
  ensurePackagedConfig({ resources, userData, electronExe: "C:\\app\\Paperino.exe" })
  expect(existsSync(join(dir, "stale.txt"))).toBe(false)
})
```

Run: `cd C:/Users/azamk/Documents/Paperino/opencode-dev/packages/desktop && bun test src/main/paperino/packaged.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 2: Implement `packaged.ts`**

```ts
import { cpSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// The packaged app never trusts install-time paths: the live opencode.jsonc is rendered
// from a token template on every boot, so moving or updating the install can never
// strand a stale absolute path (the failure mode the dev config would have shipped).
const fwd = (p: string) => p.replaceAll("\\", "/")

export function renderTemplate(text: string, tokens: Record<string, string>): string {
  let out = text
  for (const [key, value] of Object.entries(tokens)) out = out.replaceAll(`{{${key}}}`, value)
  const leftover = out.match(/\{\{[A-Z_]+\}\}/g)
  if (leftover) throw new Error(`unresolved config-template tokens: ${[...new Set(leftover)].join(", ")}`)
  return out
}

export type PackagedPaths = { resources: string; userData: string; electronExe: string }

export function packagedTokens(opts: PackagedPaths): Record<string, string> {
  return { RESOURCES: fwd(opts.resources), USERDATA: fwd(opts.userData), ELECTRON: fwd(opts.electronExe) }
}

/** Copy resources/paperino-config into userData and render the template. Machine-owned:
 *  the target is wiped first, so removed files never linger across updates. */
export function ensurePackagedConfig(opts: PackagedPaths): string {
  const source = join(opts.resources, "paperino-config")
  const target = join(opts.userData, "paperino-config")
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  cpSync(source, target, { recursive: true })
  const templatePath = join(target, "opencode.packaged.jsonc")
  const rendered = renderTemplate(readFileSync(templatePath, "utf8"), packagedTokens(opts))
  writeFileSync(join(target, "opencode.jsonc"), rendered)
  unlinkSync(templatePath)
  return target
}
```

Run the test → Expected: PASS (3 tests).

- [ ] **Step 3: Write the shipped template**

Create `opencode-dev/paperino-config/opencode.packaged.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  // Rendered at boot by packages/desktop/src/main/paperino/packaged.ts:
  //   {{RESOURCES}} -> <resourcesPath>/paperino   {{USERDATA}} -> app userData
  //   {{ELECTRON}}  -> the app's own executable (node-compatible via ELECTRON_RUN_AS_NODE)
  // GPT-5.6 Terra on the ChatGPT subscription (built-in codex plugin OAuth).
  // Plan B extends this with luna/sol/codex declarations and the onboarding wizard.
  "model": "openai/gpt-5.6-terra",
  "provider": {
    "openai": {
      "models": {
        "gpt-5.6-terra": {
          "id": "gpt-5.6-terra",
          "name": "GPT-5.6 Terra",
          "reasoning": true,
          "tool_call": true,
          "attachment": true,
          "limit": { "context": 400000, "input": 272000, "output": 128000 }
        }
      }
    }
  },
  "mcp": {
    // figures-mcp as a node-target bundle on the app's own runtime — users need no bun/node.
    "figures": {
      "type": "local",
      "command": ["{{ELECTRON}}", "{{RESOURCES}}/figures-mcp/server.mjs"],
      "enabled": true,
      "environment": {
        "ELECTRON_RUN_AS_NODE": "1",
        "PAPERINO_FIGURES_NODE": "{{ELECTRON}}",
        "PAPERINO_JQ": "{{RESOURCES}}/bin/jq/jq.exe",
        "PLAYWRIGHT_BROWSERS_PATH": "{{USERDATA}}/browsers"
      }
    },
    // PaperBanana on the first-run portable Python. Model pins mirror the dev config.
    "paperbanana": {
      "type": "local",
      "command": ["{{USERDATA}}/python/python.exe", "{{RESOURCES}}/paperbanana/server.py"],
      "enabled": true,
      "timeout": 600000,
      "environment": {
        "PAPERBANANA_ROOT": "{{RESOURCES}}/paperbanana/PaperBanana-main",
        "MAIN_MODEL_NAME": "google/gemini-3.5-flash",
        "IMAGE_GEN_MODEL_NAME": "google/gemini-3.1-flash-image-preview"
      }
    }
  }
  // No InteJer disable-list: the packaged sidecar has isolated XDG dirs, so the
  // machine-global opencode config is never merged in the first place.
}
```

- [ ] **Step 4: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/opencode-dev/paperino-config/opencode.packaged.jsonc \
  Paperino/opencode-dev/packages/desktop/src/main/paperino/packaged.ts \
  Paperino/opencode-dev/packages/desktop/src/main/paperino/packaged.test.ts
git commit -m "feat(desktop): packaged config template + boot-time renderer (no install-time paths)"
```

---

### Task 4: Isolated packaged env + tectonic fallback

**Files:**
- Modify: `opencode-dev/packages/desktop/src/main/paperino/packaged.ts` (add `packagedEnv`)
- Modify: `opencode-dev/packages/desktop/src/main/paperino/core.ts` (`tectonicBinary`)
- Test: `packaged.test.ts` + `core.test.ts` (extend)

**Interfaces:**
- Consumes: `PackagedPaths` (Task 3).
- Produces: `packagedEnv(opts: PackagedPaths & { configDir: string; basePath: string }): Record<string, string>` returning exactly:
  `OPENCODE_CONFIG_DIR`, `XDG_CONFIG_HOME` (`{userData}/xdg/config`), `XDG_DATA_HOME` (`{userData}/xdg/data`), `OPENCODE_DISABLE_EXTERNAL_SKILLS: "1"`, `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1"`, `PAPERINO_TECTONIC` (`{resources}/bin/tectonic/tectonic.exe`), `PLAYWRIGHT_BROWSERS_PATH` (`{userData}/browsers`), `PAPERINO_PYTHON` (`{userData}/python/python.exe`), `PATH` (`{userData}\python;` + basePath). Consumed by the boot hook (Task 7) via `Object.assign(process.env, ...)` — `createSidecarEnv()` in `src/main/server.ts:210` copies `process.env`, and MCP children inherit from the sidecar.
- Also: `tectonicBinary(packagedResources?: string)` exported from `core.ts` — `PAPERINO_TECTONIC` env wins, else `<packagedResources>/bin/tectonic/tectonic.exe` when given, else `"tectonic"`.

- [ ] **Step 1: Failing tests**

Append to `packaged.test.ts`:

```ts
import { packagedEnv } from "./packaged"
import { join as joinPath } from "node:path"

test("packagedEnv isolates XDG dirs and wires every tool path", () => {
  const env = packagedEnv({
    resources: "C:/app/resources/paperino",
    userData: "C:/ud",
    electronExe: "C:/app/Paperino.exe",
    configDir: "C:/ud/paperino-config",
    basePath: "C:/Windows/system32",
  })
  expect(env).toEqual({
    OPENCODE_CONFIG_DIR: "C:/ud/paperino-config",
    XDG_CONFIG_HOME: "C:/ud/xdg/config",
    XDG_DATA_HOME: "C:/ud/xdg/data",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    PAPERINO_TECTONIC: "C:/app/resources/paperino/bin/tectonic/tectonic.exe",
    PLAYWRIGHT_BROWSERS_PATH: "C:/ud/browsers",
    PAPERINO_PYTHON: "C:/ud/python/python.exe",
    PATH: `${joinPath("C:/ud", "python")};C:/Windows/system32`,
  })
})
```

And to the desktop `src/main/paperino/core.test.ts` (add `tectonicBinary` to the `./core` import):

```ts
test("tectonicBinary honors PAPERINO_TECTONIC, then the packaged fallback, then PATH", () => {
  const prev = process.env.PAPERINO_TECTONIC
  process.env.PAPERINO_TECTONIC = "C:/explicit/tectonic.exe"
  expect(tectonicBinary()).toBe("C:/explicit/tectonic.exe")
  delete process.env.PAPERINO_TECTONIC
  expect(tectonicBinary("C:\\app\\resources\\paperino")).toBe("C:/app/resources/paperino/bin/tectonic/tectonic.exe")
  expect(tectonicBinary()).toBe("tectonic")
  if (prev !== undefined) process.env.PAPERINO_TECTONIC = prev
})
```

Run: `bun test src/main/paperino/` → Expected: the two new tests FAIL (function missing / not exported).

- [ ] **Step 2: Implement**

Append to `packaged.ts`:

```ts
/** The full isolation + tool env for packaged builds. Assigned into process.env at boot,
 *  inherited by the sidecar (createSidecarEnv copies process.env) and by every MCP child.
 *  XDG isolation is the InteJer firewall: the machine-global ~/.config/opencode (its 9
 *  hardware servers), its skills, and the shared auth store are structurally unreachable. */
export function packagedEnv(opts: PackagedPaths & { configDir: string; basePath: string }): Record<string, string> {
  return {
    OPENCODE_CONFIG_DIR: fwd(opts.configDir),
    XDG_CONFIG_HOME: fwd(join(opts.userData, "xdg", "config")),
    XDG_DATA_HOME: fwd(join(opts.userData, "xdg", "data")),
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    PAPERINO_TECTONIC: fwd(join(opts.resources, "bin", "tectonic", "tectonic.exe")),
    PLAYWRIGHT_BROWSERS_PATH: fwd(join(opts.userData, "browsers")),
    PAPERINO_PYTHON: fwd(join(opts.userData, "python", "python.exe")),
    // Bare `python` in the agent's shells must resolve to the portable env — the same
    // contract paperino-dev.cmd gives the office skills in dev.
    PATH: `${join(opts.userData, "python")};${opts.basePath}`,
  }
}
```

In `core.ts`, replace `tectonicBinary`:

```ts
export function tectonicBinary(packagedResources?: string) {
  if (process.env.PAPERINO_TECTONIC) return process.env.PAPERINO_TECTONIC
  if (packagedResources) return `${packagedResources.replaceAll("\\", "/")}/bin/tectonic/tectonic.exe`
  return "tectonic"
}
```

(Its `compile()` call site keeps calling `tectonicBinary()` with no argument — the packaged path arrives via `PAPERINO_TECTONIC` from `packagedEnv`; the parameter makes the fallback testable.)

Run: `bun test src/main/paperino/` → Expected: PASS (all, including the pre-existing compile/classify tests).

- [ ] **Step 3: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/opencode-dev/packages/desktop/src/main/paperino/packaged.ts \
  Paperino/opencode-dev/packages/desktop/src/main/paperino/packaged.test.ts \
  Paperino/opencode-dev/packages/desktop/src/main/paperino/core.ts \
  Paperino/opencode-dev/packages/desktop/src/main/paperino/core.test.ts
git commit -m "feat(desktop): isolated packaged env (XDG firewall vs InteJer) + tectonic fallback"
```

---

### Task 5: First-run setup service (Chromium + portable Python)

**Files:**
- Create: `opencode-dev/packages/desktop/src/main/paperino/setup.ts`
- Test: `opencode-dev/packages/desktop/src/main/paperino/setup.test.ts`
- Create: `paperbanana-mcp/requirements.lock` (generated — command below)

**Interfaces:**
- Consumes: nothing from other tasks (paths passed in).
- Produces (consumed by Task 6's IPC and Plan B's wizard):
  - `type SetupComponent = "chromium" | "python"`
  - `type SetupProgress = { component: SetupComponent; phase: string; percent?: number }`
  - `setupStatus(userData: string): Record<SetupComponent, { installed: boolean }>`
  - `runSetup(component: SetupComponent, ctx: SetupContext, onProgress: (p: SetupProgress) => void): Promise<void>` — idempotent via marker files `{userData}/setup/<component>.done`.
  - `type SetupContext = { userData: string; resources: string; electronExe: string; exec?: ExecFn; download?: DownloadFn }` with `ExecFn = (exe, args, env) => Promise<void>` and `DownloadFn = (url, dest, onPercent?) => Promise<void>` — injectable for tests; defaults use `child_process.execFile` and node `https` with redirect-following.

- [ ] **Step 1: Pin the Python build**

Resolve the current CPython 3.12 `install_only` Windows asset of python-build-standalone:

```bash
gh api repos/astral-sh/python-build-standalone/releases/latest \
  --jq '.tag_name, (.assets[].name | select(test("cpython-3.12.*x86_64-pc-windows-msvc-install_only.tar.gz$")))'
```

Expected: a tag (e.g. `20250918`) and one asset name. The pinned URL for Step 4 is
`https://github.com/astral-sh/python-build-standalone/releases/download/<tag>/<asset>` — versioned, never `latest`, so installs are reproducible.

- [ ] **Step 2: Generate the PaperBanana lock**

```bash
cd C:/Users/azamk/Documents/Paperino
paperbanana-mcp/.venv/Scripts/python.exe -m pip freeze > paperbanana-mcp/requirements.lock
head -5 paperbanana-mcp/requirements.lock
```
Expected: pinned `package==version` lines (the exact env PaperBanana runs with today).

- [ ] **Step 3: Failing tests for the service logic**

Create `setup.test.ts` (orchestration with fakes — the real downloads are Task 8's smoke):

```ts
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runSetup, setupStatus, type SetupProgress } from "./setup"

const ctx = (tmp: string) => ({
  userData: join(tmp, "ud"),
  resources: join(tmp, "res"),
  electronExe: "C:/app/Paperino.exe",
})

test("setupStatus reports installed only when markers exist", () => {
  const tmp = mkdtempSync(join(tmpdir(), "setup-"))
  const c = ctx(tmp)
  expect(setupStatus(c.userData)).toEqual({ chromium: { installed: false }, python: { installed: false } })
  mkdirSync(join(c.userData, "setup"), { recursive: true })
  writeFileSync(join(c.userData, "setup", "chromium.done"), "1")
  expect(setupStatus(c.userData).chromium.installed).toBe(true)
})

test("runSetup(chromium) invokes the playwright CLI under electron-as-node and writes the marker", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "setup-"))
  const c = ctx(tmp)
  const calls: { exe: string; args: string[]; env: Record<string, string | undefined> }[] = []
  const events: SetupProgress[] = []
  await runSetup(
    "chromium",
    { ...c, exec: async (exe, args, env) => void calls.push({ exe, args, env }) },
    (p) => events.push(p),
  )
  expect(calls).toHaveLength(1)
  expect(calls[0].exe).toBe(c.electronExe)
  expect(calls[0].args.join(" ")).toContain("playwright")
  expect(calls[0].args).toContain("install")
  expect(calls[0].args).toContain("chromium")
  expect(calls[0].env.ELECTRON_RUN_AS_NODE).toBe("1")
  expect(calls[0].env.PLAYWRIGHT_BROWSERS_PATH).toBe(join(c.userData, "browsers"))
  expect(setupStatus(c.userData).chromium.installed).toBe(true)
  expect(events.at(-1)?.phase).toBe("done")
})

test("runSetup(python) downloads, extracts with tar, pip-installs both locks, writes marker", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "setup-"))
  const c = ctx(tmp)
  mkdirSync(join(c.resources, "paperbanana"), { recursive: true })
  writeFileSync(join(c.resources, "paperbanana", "requirements.lock"), "x==1")
  mkdirSync(join(c.resources, "paperino-config", "skill"), { recursive: true })
  writeFileSync(join(c.resources, "paperino-config", "skill", "requirements.txt"), "y==2")
  const execs: string[] = []
  const downloads: string[] = []
  await runSetup(
    "python",
    {
      ...c,
      download: async (url, dest) => {
        downloads.push(url)
        writeFileSync(dest, "fake-archive")
      },
      exec: async (exe, args) => void execs.push([exe, ...args].join(" ")),
    },
    () => {},
  )
  expect(downloads[0]).toContain("python-build-standalone")
  expect(execs[0]).toContain("tar")
  expect(execs[1]).toContain("requirements.lock")
  expect(execs[2]).toContain("requirements.txt")
  expect(setupStatus(c.userData).python.installed).toBe(true)
})

test("runSetup is a no-op when the marker already exists", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "setup-"))
  const c = ctx(tmp)
  mkdirSync(join(c.userData, "setup"), { recursive: true })
  writeFileSync(join(c.userData, "setup", "chromium.done"), "1")
  let called = 0
  await runSetup("chromium", { ...c, exec: async () => void called++ }, () => {})
  expect(called).toBe(0)
})
```

Run: `bun test src/main/paperino/setup.test.ts` → Expected: FAIL — module missing.

- [ ] **Step 4: Implement `setup.ts`**

```ts
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { get } from "node:https"
import { join } from "node:path"
import { execFile } from "node:child_process"

// First-run runtime setup (spec §3). Slim installer: Chromium (Playwright) and a
// portable CPython are downloaded into userData with progress, not shipped. Each
// component is guarded by a marker file so re-running is free, and both are re-runnable
// from Settings ("Complete setup") after a skip or a failure.

export type SetupComponent = "chromium" | "python"
export type SetupProgress = { component: SetupComponent; phase: string; percent?: number }
export type ExecFn = (exe: string, args: string[], env: Record<string, string | undefined>) => Promise<void>
export type DownloadFn = (url: string, dest: string, onPercent?: (p: number) => void) => Promise<void>
export type SetupContext = {
  userData: string
  resources: string
  electronExe: string
  exec?: ExecFn
  download?: DownloadFn
}

// Pinned by Task 5 Step 1 — a versioned release URL, never `latest`, so installs are
// reproducible. Replace tag+asset with the values that step resolved.
const PYTHON_URL =
  "https://github.com/astral-sh/python-build-standalone/releases/download/<TAG-FROM-STEP-1>/<ASSET-FROM-STEP-1>"

const markerPath = (userData: string, component: SetupComponent) => join(userData, "setup", `${component}.done`)

export function setupStatus(userData: string): Record<SetupComponent, { installed: boolean }> {
  return {
    chromium: { installed: existsSync(markerPath(userData, "chromium")) },
    python: { installed: existsSync(markerPath(userData, "python")) },
  }
}

const defaultExec: ExecFn = (exe, args, env) =>
  new Promise((resolve, reject) => {
    execFile(
      exe,
      args,
      { env: env as NodeJS.ProcessEnv, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
      (error, _out, stderr) =>
        error ? reject(new Error(`${exe} ${args[0] ?? ""} failed: ${stderr || error.message}`)) : resolve(),
    )
  })

const defaultDownload: DownloadFn = (url, dest, onPercent) =>
  new Promise((resolve, reject) => {
    const request = (target: string, hops: number) => {
      if (hops > 5) return reject(new Error(`too many redirects for ${target}`))
      get(target, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
          return request(res.headers.location, hops + 1)
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${target}`))
        const total = Number(res.headers["content-length"] ?? 0)
        let seen = 0
        const file = createWriteStream(dest)
        res.on("data", (chunk: Buffer) => {
          seen += chunk.length
          if (total && onPercent) onPercent(Math.round((seen / total) * 100))
        })
        res.pipe(file)
        file.on("finish", () => file.close(() => resolve()))
        file.on("error", reject)
      }).on("error", reject)
    }
    request(url, 0)
  })

export async function runSetup(
  component: SetupComponent,
  ctx: SetupContext,
  onProgress: (p: SetupProgress) => void,
): Promise<void> {
  const marker = markerPath(ctx.userData, component)
  if (existsSync(marker)) return
  const exec = ctx.exec ?? defaultExec
  const download = ctx.download ?? defaultDownload
  const emit = (phase: string, percent?: number) => onProgress({ component, phase, percent })

  if (component === "chromium") {
    emit("installing Chromium", 0)
    await exec(
      ctx.electronExe,
      [join(ctx.resources, "figures-mcp", "node_modules", "playwright", "cli.js"), "install", "chromium"],
      {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        PLAYWRIGHT_BROWSERS_PATH: join(ctx.userData, "browsers"),
      },
    )
  } else {
    const archive = join(ctx.userData, "setup", "python.tar.gz")
    mkdirSync(join(ctx.userData, "setup"), { recursive: true })
    emit("downloading Python", 0)
    await download(PYTHON_URL, archive, (p) => emit("downloading Python", p))
    emit("extracting Python")
    mkdirSync(join(ctx.userData, "python"), { recursive: true })
    // bsdtar ships with Windows 10+; --strip-components drops the archive's top-level dir.
    await exec("tar", ["-xzf", archive, "-C", join(ctx.userData, "python"), "--strip-components", "1"], {
      ...process.env,
    })
    const python = join(ctx.userData, "python", "python.exe")
    emit("installing PaperBanana packages")
    await exec(python, ["-m", "pip", "install", "-r", join(ctx.resources, "paperbanana", "requirements.lock")], {
      ...process.env,
    })
    emit("installing office-skill packages")
    await exec(
      python,
      ["-m", "pip", "install", "-r", join(ctx.resources, "paperino-config", "skill", "requirements.txt")],
      { ...process.env },
    )
  }

  mkdirSync(join(ctx.userData, "setup"), { recursive: true })
  writeFileSync(marker, new Date().toISOString())
  emit("done", 100)
}
```

Run: `bun test src/main/paperino/setup.test.ts` → Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/opencode-dev/packages/desktop/src/main/paperino/setup.ts \
  Paperino/opencode-dev/packages/desktop/src/main/paperino/setup.test.ts \
  Paperino/paperbanana-mcp/requirements.lock
git commit -m "feat(desktop): first-run setup service — Chromium + portable Python, idempotent markers"
```

---

### Task 6: Setup IPC + preload surface, PaperBanana root override

**Files:**
- Modify: `opencode-dev/packages/desktop/src/main/paperino/ipc.ts`
- Modify: `opencode-dev/packages/desktop/src/preload/index.ts` (the `paperino` block)
- Modify: `opencode-dev/packages/desktop/src/preload/types.ts` (`PaperinoAPI`)
- Modify: `paperbanana-mcp/server.py`

**Interfaces:**
- Consumes: `setupStatus`/`runSetup` (Task 5), `PAPERBANANA_ROOT` env (template, Task 3).
- Produces (consumed by Plan B's wizard):
  - IPC: `ipcMain.handle("paperino-setup-status")` → status record; `ipcMain.handle("paperino-setup-run", component)` → `{ ok: true } | { ok: false; error: string }`; progress pushed as `webContents.send("paperino-setup-progress", SetupProgress)` to all windows.
  - Preload: `api.paperino.setupStatus()`, `api.paperino.setupRun(component)`, `api.paperino.onSetupProgress(cb): () => void`.
  - `server.py`: honors `PAPERBANANA_ROOT` for the package dir and `XDG_DATA_HOME` for `auth.json`. (Dual-key endpoint selection is Plan B.)

- [ ] **Step 1: IPC handlers**

In `src/main/paperino/ipc.ts`, extend imports and append at the end of `registerPaperinoIpc` (mirror the `paperino-list-files` pattern):

```ts
import { runSetup, setupStatus, type SetupComponent, type SetupProgress } from "./setup"
import { BrowserWindow, app } from "electron"
import { join } from "node:path"
```

```ts
  ipcMain.handle("paperino-setup-status", () => setupStatus(app.getPath("userData")))
  ipcMain.handle("paperino-setup-run", async (_event, component: SetupComponent) => {
    try {
      await runSetup(
        component,
        {
          userData: app.getPath("userData"),
          resources: join(process.resourcesPath, "paperino"),
          electronExe: process.execPath,
        },
        (p: SetupProgress) => {
          for (const win of BrowserWindow.getAllWindows()) win.webContents.send("paperino-setup-progress", p)
        },
      )
      return { ok: true as const }
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
    }
  })
```

- [ ] **Step 2: Preload surface**

In `src/preload/types.ts`, extend `PaperinoAPI` with:

```ts
  setupStatus: () => Promise<Record<"chromium" | "python", { installed: boolean }>>
  setupRun: (component: "chromium" | "python") => Promise<{ ok: true } | { ok: false; error: string }>
  onSetupProgress: (
    cb: (p: { component: "chromium" | "python"; phase: string; percent?: number }) => void,
  ) => () => void
```

In `src/preload/index.ts`, inside the `paperino: { ... }` object:

```ts
    setupStatus: () => ipcRenderer.invoke("paperino-setup-status"),
    setupRun: (component) => ipcRenderer.invoke("paperino-setup-run", component),
    onSetupProgress: (cb) => {
      const listener = (_event: unknown, p: Parameters<typeof cb>[0]) => cb(p)
      ipcRenderer.on("paperino-setup-progress", listener)
      return () => ipcRenderer.removeListener("paperino-setup-progress", listener)
    },
```

Run: `cd C:/Users/azamk/Documents/Paperino/opencode-dev/packages/desktop && bun run typecheck`
Expected: exit 0.

- [ ] **Step 3: `server.py` packaged-path awareness**

In `paperbanana-mcp/server.py`: locate the statement that puts the PaperBanana source on `sys.path` (top of file, after the stdlib imports) and replace its path expression with:

```python
_PAPERBANANA_ROOT = os.environ.get("PAPERBANANA_ROOT") or str(
    Path(__file__).resolve().parent.parent / "PaperBanana-main"
)
sys.path.insert(0, _PAPERBANANA_ROOT)
```

and in the auth-store lookup (~line 52, the function reading `~/.local/share/opencode/auth.json`), replace the hardcoded base with:

```python
    data_home = os.environ.get("XDG_DATA_HOME")
    base = Path(data_home) if data_home else Path.home() / ".local" / "share"
    auth = base / "opencode" / "auth.json"
```

Verify dev behavior unchanged:
Run: `cd C:/Users/azamk/Documents/Paperino && paperbanana-mcp/.venv/Scripts/python.exe paperbanana-mcp/smoke_test.py`
Expected: same result as before the edit.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/opencode-dev/packages/desktop/src/main/paperino/ipc.ts \
  Paperino/opencode-dev/packages/desktop/src/preload/index.ts \
  Paperino/opencode-dev/packages/desktop/src/preload/types.ts \
  Paperino/paperbanana-mcp/server.py
git commit -m "feat(desktop): setup IPC/preload surface; paperbanana honors PAPERBANANA_ROOT + XDG_DATA_HOME"
```

---

### Task 7: Staging script + extraResources + boot hook

**Files:**
- Create: `opencode-dev/packages/desktop/scripts/stage-paperino.ts`
- Modify: `opencode-dev/packages/desktop/scripts/prebuild.ts` (append one line)
- Modify: `opencode-dev/packages/desktop/electron-builder.config.ts` (extraResources entry)
- Modify: `opencode-dev/packages/desktop/src/main/index.ts` (boot hook)

**Interfaces:**
- Consumes: figures dist (Task 1), template (Task 3), `ensurePackagedConfig`/`packagedEnv` (Tasks 3–4).
- Produces: staged tree `packages/desktop/resources-paperino/` → packaged as `<resourcesPath>/paperino/` with layout `{ paperino-config/, bin/tectonic/, bin/jq/, figures-mcp/, paperbanana/ }` — exactly what `{{RESOURCES}}` points into.

- [ ] **Step 1: Staging script**

Create `scripts/stage-paperino.ts`:

```ts
#!/usr/bin/env bun
// Assembles resources-paperino/, which electron-builder ships as <resources>/paperino.
// Everything the packaged app needs beyond the JS bundles lives here: the config
// template + persona + skills, pinned binaries (tectonic, jq), the node-target
// figures-mcp dist, and the PaperBanana source + lock.
import { $ } from "bun"
import { cpSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

const desktop = join(import.meta.dir, "..")
const paperino = join(desktop, "..", "..", "..") // Paperino/ project root
const out = join(desktop, "resources-paperino")

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// 1. config: persona + commands + skills + the packaged template. The dev
//    opencode.jsonc is deliberately NOT shipped — it carries this machine's paths.
const cfgSrc = join(paperino, "opencode-dev", "paperino-config")
const cfgOut = join(out, "paperino-config")
mkdirSync(cfgOut, { recursive: true })
for (const item of ["AGENTS.md", "command", "skill", "opencode.packaged.jsonc"])
  cpSync(join(cfgSrc, item), join(cfgOut, item), { recursive: true })

// 2. pinned binaries
cpSync(join(paperino, "tools", "tectonic"), join(out, "bin", "tectonic"), { recursive: true })
cpSync(join(paperino, "tools", "jq"), join(out, "bin", "jq"), { recursive: true })

// 3. figures-mcp node-target dist
await $`cd ${join(paperino, "figures-mcp")} && bun scripts/build-dist.ts`
cpSync(join(paperino, "figures-mcp", "dist"), join(out, "figures-mcp"), { recursive: true })

// 4. PaperBanana: server + lock + source (minus repo junk)
const pbOut = join(out, "paperbanana")
mkdirSync(pbOut, { recursive: true })
cpSync(join(paperino, "paperbanana-mcp", "server.py"), join(pbOut, "server.py"))
cpSync(join(paperino, "paperbanana-mcp", "requirements.lock"), join(pbOut, "requirements.lock"))
cpSync(join(paperino, "PaperBanana-main"), join(pbOut, "PaperBanana-main"), {
  recursive: true,
  filter: (src) => !/\.git(\\|\/|$)|__pycache__|\.venv/.test(src),
})
console.log("staged:", out)
```

Append to `scripts/prebuild.ts` (after the existing commands):

```ts
await $`bun ./scripts/stage-paperino.ts`
```

Run: `cd C:/Users/azamk/Documents/Paperino/opencode-dev/packages/desktop && bun scripts/stage-paperino.ts`
Expected: `staged: ...resources-paperino`. Verify layout:
`ls resources-paperino resources-paperino/bin resources-paperino/figures-mcp resources-paperino/paperbanana | head -20`
Expected: `paperino-config`, `bin/tectonic`, `bin/jq`, `figures-mcp/server.mjs`, `paperbanana/server.py`.

- [ ] **Step 2: extraResources entry**

In `electron-builder.config.ts` `getBase`, extend `extraResources` to:

```ts
  extraResources: [
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
    {
      from: "resources-paperino/",
      to: "paperino/",
    },
  ],
```

- [ ] **Step 3: Boot hook in `src/main/index.ts`**

Immediately after `app.setAppUserModelId(appId)` and the userData path setup (~line 136–140), insert:

```ts
  // Packaged Paperino is self-describing: render the config template into userData and
  // inject the isolated env BEFORE anything spawns. createSidecarEnv() copies process.env,
  // so the sidecar and every MCP child inherit all of it. Dev builds skip this entirely —
  // paperino-dev.cmd owns the dev environment.
  if (app.isPackaged) {
    const resources = join(process.resourcesPath, "paperino")
    const userData = app.getPath("userData")
    const configDir = ensurePackagedConfig({ resources, userData, electronExe: process.execPath })
    Object.assign(
      process.env,
      packagedEnv({
        resources,
        userData,
        electronExe: process.execPath,
        configDir,
        basePath: process.env.PATH ?? "",
      }),
    )
  }
```

with a static import at the top of the file:

```ts
import { ensurePackagedConfig, packagedEnv } from "./paperino/packaged"
```

(`join` is already imported there; if not, add it to the existing `node:path` import.)

Run: `bun run typecheck` → Expected: exit 0.
Run: `bun test src/main/paperino/ electron-builder.config.test.ts` → Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/opencode-dev/packages/desktop/scripts/stage-paperino.ts \
  Paperino/opencode-dev/packages/desktop/scripts/prebuild.ts \
  Paperino/opencode-dev/packages/desktop/electron-builder.config.ts \
  Paperino/opencode-dev/packages/desktop/src/main/index.ts
git commit -m "feat(desktop): stage resources/paperino payload + packaged boot hook (config render + env inject)"
```

---

### Task 8: Package smoke — build, install, verify isolation

The acceptance gate for Plan A (spec §9 build smoke + isolation acceptance; full wizard acceptance is Plan B). No planned source changes — a fix discovered here is committed with the task that owns the file.

**Files:**
- Modify: `Paperino/CLAUDE.md` (new "Packaging" section)

- [ ] **Step 1: Build the dev-channel installer**

```bash
cd C:/Users/azamk/Documents/Paperino/opencode-dev/packages/desktop
bun run prebuild
bun run build
bun run package:win
```
Expected: exit 0; `dist/paperino-win-x64.exe` exists.
Run: `ls -la dist/*.exe` → Expected: < 200MB (spec: slim installer ~150MB).

- [ ] **Step 2: Install and inspect**

Run `dist/paperino-win-x64.exe` (NSIS one-click, per-user). After launch verify:
- Window/taskbar shows **Paperino Dev** with the Fold icon.
- `%APPDATA%/ai.paperino.desktop.dev/paperino-config/opencode.jsonc` exists, contains **no `{{` tokens** and **no dev-machine paths** (nothing under `C:/Users/azamk/Documents/Paperino/figures-mcp` etc.).
- `%APPDATA%/ai.paperino.desktop.dev/xdg/` appears after the server starts.

- [ ] **Step 3: Isolation acceptance (the InteJer test)**

On this machine (InteJer's global config + skills present):
- MCP status: exactly **2 servers** (`figures`, `paperbanana` — paperbanana listed-but-failing is correct until Python setup runs); **zero** of `freecad kicad partfetch platformio playwright mongodb thingsboard embedded-debugger stitch`.
- Skills: none of `pcb-*`, `bun-file-io`, `frontend-design`, `esp32-*` are available to the agent.
- Auth: connect any provider in the installed app → the credential appears in `%APPDATA%/ai.paperino.desktop.dev/xdg/data/opencode/auth.json`, and `~/.local/share/opencode/auth.json` is untouched (compare mtimes).

- [ ] **Step 4: Runtime setup + Figure Studio end-to-end in the installed app**

From the installed app's DevTools console (dev channel exposes CDP on :9222):

```js
await window.api.paperino.setupRun("chromium")
await window.api.paperino.setupRun("python")
```
Expected: both `{ok: true}`; `%APPDATA%/ai.paperino.desktop.dev/browsers/chromium-*` and `.../python/python.exe` exist.
Then in a scratch paper workspace inside the installed app: scaffold + render one schematic figure (`figure_render` proves server.mjs under electron-as-node, the worker override, downloaded Chromium, PAPERINO_JQ), and compile the demo paper (bundled Tectonic via injected env).

- [ ] **Step 5: Document + commit**

Add to `Paperino/CLAUDE.md` after the "Brand" section:

```markdown
## Packaging (installable Paperino)

Spec: `docs/superpowers/specs/2026-07-13-paperino-installer-onboarding-design.md`.

- Build: `cd opencode-dev/packages/desktop && bun run prebuild && bun run build && bun run package:win`
  (channel via `OPENCODE_CHANNEL`, default dev). `prebuild` stages `resources-paperino/`
  via `scripts/stage-paperino.ts` — config template, tectonic, jq, figures-mcp node-target
  dist, PaperBanana source. **`resources-paperino/` is build output**, like `resources/icons`.
- The packaged app renders `paperino-config/opencode.packaged.jsonc` (tokens `{{RESOURCES}}`
  `{{USERDATA}}` `{{ELECTRON}}`) into userData on every boot and injects the isolated env in
  `main/index.ts` — `XDG_CONFIG_HOME`/`XDG_DATA_HOME` under userData are the **InteJer
  firewall**: the machine-global opencode config, its skills, and the shared auth.json are
  structurally unreachable. Dev (`paperino-dev.cmd`) is untouched; everything keys off
  `app.isPackaged`.
- No bun/node/Python/Chromium ships: figures-mcp runs its server AND render worker under
  `ELECTRON_RUN_AS_NODE` (`PAPERINO_FIGURES_NODE`); Chromium and portable CPython download
  on first run into userData (`src/main/paperino/setup.ts`, markers in `userData/setup/`).
- Release: `OPENCODE_CHANNEL=prod bun run package:win`, then
  `gh release create vX.Y.Z dist/paperino-win-x64.exe dist/latest.yml --latest`
  on `azamkhan555622848/Paperino` (releases must be public for electron-updater).
```

```bash
cd C:/Users/azamk/Documents
git add Paperino/CLAUDE.md
git commit -m "docs: packaging + isolation build/release runbook"
```

---

**Plan B (separate plan, written after this ships):** onboarding wizard UI consuming `api.paperino.setup*` + the provider-auth flows, PaperBanana dual-key endpoint selection, `gpt-5.6-{luna,sol}` + `gpt-5.3-codex` declarations with the vendor allowlist patch, and the full wizard acceptance from spec §9.
