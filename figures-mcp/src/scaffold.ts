import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

  // Vendor the design system per workspace — papers stay self-contained.
  //
  // tokens.css and lib/ are MACHINE-OWNED, like references.bib: vendored on the first
  // scaffold and refreshed whenever the version marker on line 1 differs from the
  // server's. Vendoring only-if-absent would strand every existing workspace on the
  // design system it was born with, so an upgrade would silently never arrive.
  mkdirSync(figuresDir, { recursive: true })
  const versionOf = (css: string) => css.split("\n", 1)[0].trim()
  const shipped = versionOf(readFileSync(join(ASSETS, "tokens.css"), "utf8"))
  const vendoredTokens = join(figuresDir, "tokens.css")
  const vendored = existsSync(vendoredTokens) ? versionOf(readFileSync(vendoredTokens, "utf8")) : null
  if (vendored !== shipped) {
    cpSync(join(ASSETS, "tokens.css"), vendoredTokens)
    rmSync(join(figuresDir, "lib"), { recursive: true, force: true })
    cpSync(join(ASSETS, "lib"), join(figuresDir, "lib"), { recursive: true })
  } else if (!existsSync(join(figuresDir, "lib"))) {
    cpSync(join(ASSETS, "lib"), join(figuresDir, "lib"), { recursive: true })
  }

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
