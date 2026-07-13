import { cpSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// The packaged app never trusts install-time paths. The live opencode.jsonc is rendered
// from a token template on EVERY boot, so relocating or updating the install can never
// strand a stale absolute path — which is exactly what shipping the dev paperino-config
// (full of C:/Users/azamk/... paths) would have done.
const fwd = (p: string) => p.replaceAll("\\", "/")

export function renderTemplate(text: string, tokens: Record<string, string>): string {
  let out = text
  for (const [key, value] of Object.entries(tokens)) out = out.replaceAll(`{{${key}}}`, value)
  // A typo'd token must fail loudly at boot rather than ship a config whose MCP command
  // is a literal "{{ELECTRON}}" that the sidecar would try to exec.
  const leftover = out.match(/\{\{[A-Z_]+\}\}/g)
  if (leftover) throw new Error(`unresolved config-template tokens: ${[...new Set(leftover)].join(", ")}`)
  return out
}

export type PackagedPaths = { resources: string; userData: string; electronExe: string }

export function packagedTokens(opts: PackagedPaths): Record<string, string> {
  return { RESOURCES: fwd(opts.resources), USERDATA: fwd(opts.userData), ELECTRON: fwd(opts.electronExe) }
}

/**
 * Copy resources/paperino-config into userData and render the template into the live
 * opencode.jsonc. Machine-owned: the target is wiped first, so a file dropped in a newer
 * version never lingers from an older one.
 */
export function ensurePackagedConfig(opts: PackagedPaths): string {
  const source = join(opts.resources, "paperino-config")
  const target = join(opts.userData, "paperino-config")
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  cpSync(source, target, { recursive: true })

  const templatePath = join(target, "opencode.packaged.jsonc")
  const rendered = renderTemplate(readFileSync(templatePath, "utf8"), packagedTokens(opts))
  // Say what the file is. It is rewritten on every launch, so anyone who edits it in place
  // (or reads it while debugging) should know that before, not after.
  const banner = "// GENERATED at launch from opencode.packaged.jsonc. Edits here are overwritten.\n"
  writeFileSync(join(target, "opencode.jsonc"), banner + rendered)
  unlinkSync(templatePath)
  return target
}

/**
 * The isolation + tool environment for packaged builds. Assigned into process.env at boot;
 * the sidecar inherits it (createSidecarEnv in main/server.ts copies process.env) and every
 * MCP child inherits it from the sidecar.
 *
 * The XDG pair is the InteJer firewall. InteJer is built on this same opencode fork and
 * lives on the same machine: it owns the machine-global ~/.config/opencode (nine hardware
 * MCP servers, IoT skills) and the shared ~/.local/share/opencode/auth.json. Pointing
 * XDG_CONFIG_HOME/XDG_DATA_HOME inside Paperino's userData makes all of that structurally
 * unreachable — no disable-list to maintain, nothing to leak.
 */
export function packagedEnv(opts: PackagedPaths & { configDir: string; basePath: string }): Record<string, string> {
  return {
    OPENCODE_CONFIG_DIR: fwd(opts.configDir),
    XDG_CONFIG_HOME: fwd(join(opts.userData, "xdg", "config")),
    XDG_DATA_HOME: fwd(join(opts.userData, "xdg", "data")),
    // An end user's unrelated Claude/agent skills must not be hoovered into the paper agent.
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
    // ~/.opencode is a config dir for EVERY session and is keyed off os.homedir(), so the XDG
    // redirect above does not reach it. On a machine that also runs InteJer it holds ten IoT
    // skills (esp32-dev, stm32-dev, zephyr-rtos...) — observed leaking into a packaged build.
    OPENCODE_DISABLE_HOME_CONFIG: "1",
    PAPERINO_TECTONIC: fwd(join(opts.resources, "bin", "tectonic", "tectonic.exe")),
    PLAYWRIGHT_BROWSERS_PATH: fwd(join(opts.userData, "browsers")),
    PAPERINO_PYTHON: fwd(join(opts.userData, "python", "python.exe")),
    // A bare `python` AND a bare `tectonic` in the agent's shells must resolve to what we
    // ship — the same contract paperino-dev.cmd gives them in dev.
    //
    // PAPERINO_TECTONIC alone is not enough: it is read by the Electron main process, which
    // is why a packaged build's Preview panel compiled happily while the agent's own
    // `tectonic paper.tex` did not. Asked to preview a .tex that is not the root main.tex,
    // the agent shells out BY NAME (AGENTS.md tells it to compile such a file itself) — and
    // with no tectonic on PATH it went hunting for pdflatex/latexmk/xelatex, found none, and
    // told the user "the local LaTeX compiler is unavailable". Nothing was missing; it just
    // could not be named.
    PATH: `${join(opts.userData, "python")};${join(opts.resources, "bin", "tectonic")};${opts.basePath}`,
  }
}
