import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { stringify } from "yaml"

const ASSETS = join(import.meta.dir, "assets")
const TEMPLATES = join(import.meta.dir, "templates")

export type Archetype = "schematic" | "gallery" | "chart" | "table"
export type ScaffoldOpts = {
  name: string
  archetype: Archetype
  claim: string
  caption: string
  width: "narrow" | "full"
  /** Screen-reader description. Defaults to the caption so a fresh figure lints clean. */
  alt?: string
}

export class ScaffoldError extends Error {}

export async function scaffold(workspace: string, opts: ScaffoldOpts): Promise<{ figureDir: string }> {
  const figuresDir = join(workspace, "figures")
  const figureDir = join(figuresDir, opts.name)
  if (existsSync(figureDir)) throw new ScaffoldError(`figure "${opts.name}" already exists at ${figureDir}`)

  // Vendor the design system once per workspace — papers stay self-contained.
  mkdirSync(figuresDir, { recursive: true })
  if (!existsSync(join(figuresDir, "tokens.css"))) cpSync(join(ASSETS, "tokens.css"), join(figuresDir, "tokens.css"))
  if (!existsSync(join(figuresDir, "lib"))) cpSync(join(ASSETS, "lib"), join(figuresDir, "lib"), { recursive: true })

  mkdirSync(figureDir)
  cpSync(join(TEMPLATES, opts.archetype, "figure.html"), join(figureDir, "figure.html"))
  writeFileSync(join(figureDir, "data.json"), "{}\n")
  writeFileSync(
    join(figureDir, "meta.yaml"),
    stringify({
      id: opts.name,
      archetype: opts.archetype,
      width: opts.width,
      caption: opts.caption,
      alt: opts.alt?.trim() || opts.caption,
      claim: opts.claim,
    }),
  )

  const gitignore = join(workspace, ".gitignore")
  const line = "figures/*/build/"
  const current = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : ""
  if (!current.includes(line)) appendFileSync(gitignore, `${current.endsWith("\n") || current === "" ? "" : "\n"}${line}\n`)

  return { figureDir }
}
