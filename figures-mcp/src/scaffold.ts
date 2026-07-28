import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { stringify } from "yaml"
import { resolveVenue } from "./venue"

// import.meta.dir is BUN-ONLY: under node (which is what the packaged bundle runs on via
// ELECTRON_RUN_AS_NODE) it is undefined, and every asset path silently became undefined.
// import.meta.url works in both, and in the bundle it points at dist/, where assets and
// templates are copied to sit beside server.mjs.
const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(HERE, "assets")
const TEMPLATES = join(HERE, "templates")

export type Archetype = "schematic" | "gallery" | "chart" | "table"
export type ScaffoldOpts = {
  name: string
  archetype: Archetype
  /**
   * Which renderer authors this figure. Defaults to html, the historical behaviour.
   *
   * mpl authors figure.py against matplotlib; html authors figure.html against the CSS
   * design system. They converge on an SVG measured in Chromium, so both are linted by
   * the same 13 rules.
   */
  engine?: "html" | "mpl"
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
  // The venue is stamped INTO the version marker, so switching venue re-vendors by exactly
  // the same rule a version bump does — one mechanism, not two.
  const venue = resolveVenue(workspace)
  const stamp = (css: string) =>
    css
      .replace(/^\/\* paperino-tokens (\S+)[^\n]*\*\//, `/* paperino-tokens $1 venue=${venue.id} */`)
      .replace(/"PLACEHOLDER_FACE"/, `"${venue.textFace}"`)
  const versionOf = (css: string) => css.split("\n", 1)[0].trim()
  const shippedCss = stamp(readFileSync(join(ASSETS, "tokens.css"), "utf8"))
  const vendoredTokens = join(figuresDir, "tokens.css")
  const vendored = existsSync(vendoredTokens) ? versionOf(readFileSync(vendoredTokens, "utf8")) : null
  if (vendored !== versionOf(shippedCss)) {
    writeFileSync(vendoredTokens, shippedCss)
    rmSync(join(figuresDir, "lib"), { recursive: true, force: true })
    cpSync(join(ASSETS, "lib"), join(figuresDir, "lib"), { recursive: true })
    rmSync(join(figuresDir, "fonts"), { recursive: true, force: true })
    cpSync(join(ASSETS, "fonts"), join(figuresDir, "fonts"), { recursive: true })
  } else if (!existsSync(join(figuresDir, "lib"))) {
    cpSync(join(ASSETS, "lib"), join(figuresDir, "lib"), { recursive: true })
    cpSync(join(ASSETS, "fonts"), join(figuresDir, "fonts"), { recursive: true })
  }

  mkdirSync(figureDir)
  const engine = opts.engine ?? "html"
  if (engine === "mpl") {
    cpSync(join(TEMPLATES, "chart-mpl", "figure.py"), join(figureDir, "figure.py"))
    // Vendored beside tokens.css and refreshed on the same version-marker rule, so an
    // existing workspace is not stranded on the style module it was born with.
    const markerOf = (py: string) => py.split("\n", 1)[0].trim()
    const shippedPy = readFileSync(join(ASSETS, "paperino_mpl.py"), "utf8")
    const target = join(figuresDir, "paperino_mpl.py")
    if (!existsSync(target) || markerOf(readFileSync(target, "utf8")) !== markerOf(shippedPy))
      writeFileSync(target, shippedPy)
  } else {
    cpSync(join(TEMPLATES, opts.archetype, "figure.html"), join(figureDir, "figure.html"))
  }
  writeFileSync(join(figureDir, "data.json"), "{}\n")
  writeFileSync(
    join(figureDir, "meta.yaml"),
    stringify({
      id: opts.name,
      archetype: opts.archetype,
      engine,
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
