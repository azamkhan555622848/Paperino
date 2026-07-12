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
  writeFileSync(join(target, "opencode.jsonc"), rendered)
  unlinkSync(templatePath)
  return target
}
