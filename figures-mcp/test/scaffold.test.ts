import { beforeEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { scaffold } from "../src/scaffold"

const WS = join(import.meta.dir, "tmp-ws")

beforeEach(() => {
  rmSync(WS, { recursive: true, force: true })
  mkdirSync(WS, { recursive: true })
})

test("engine=mpl scaffolds figure.py, not figure.html, and vendors the style module", async () => {
  await scaffold(WS, { name: "c1", archetype: "chart", engine: "mpl", claim: "c", caption: "c", width: "full" })
  const dir = join(WS, "figures", "c1")
  expect(existsSync(join(dir, "figure.py"))).toBe(true)
  expect(existsSync(join(dir, "figure.html"))).toBe(false)
  expect(parse(readFileSync(join(dir, "meta.yaml"), "utf8")).engine).toBe("mpl")
  // Vendored per workspace like tokens.css, so figure.py can import it by bare name.
  expect(existsSync(join(WS, "figures", "paperino_mpl.py"))).toBe(true)
})

test("the default engine stays html, so existing behaviour is unchanged", async () => {
  await scaffold(WS, { name: "s1", archetype: "schematic", claim: "c", caption: "c", width: "full" })
  expect(existsSync(join(WS, "figures", "s1", "figure.html"))).toBe(true)
  expect(existsSync(join(WS, "figures", "s1", "figure.py"))).toBe(false)
  expect(parse(readFileSync(join(WS, "figures", "s1", "meta.yaml"), "utf8")).engine).toBe("html")
})

test("the vendored style module refreshes when its version marker moves", async () => {
  await scaffold(WS, { name: "c1", archetype: "chart", engine: "mpl", claim: "c", caption: "c", width: "full" })
  const vendored = join(WS, "figures", "paperino_mpl.py")
  writeFileSync(vendored, "# paperino-mpl v0.1\nSTALE = True\n")
  await scaffold(WS, { name: "c2", archetype: "chart", engine: "mpl", claim: "c", caption: "c", width: "full" })
  const refreshed = readFileSync(vendored, "utf8")
  expect(refreshed).not.toContain("STALE")
  expect(refreshed.split("\n", 1)[0]).toBe("# paperino-mpl v3.0")
})

test("tokens.css is stamped with the workspace's venue face", async () => {
  writeFileSync(join(WS, "paperino.yaml"), "venue: ieee\n")
  await scaffold(WS, { name: "f1", archetype: "chart", claim: "c", caption: "c", width: "full" })
  const css = readFileSync(join(WS, "figures", "tokens.css"), "utf8")
  expect(css.split("\n", 1)[0]).toContain("venue=ieee")
  // The spaces matter: matplotlib emits 'TeX Gyre Termes', so the @font-face must declare
  // that exact spelling or Chromium quietly renders a system serif instead.
  expect(css).toContain('--font-text: "TeX Gyre Termes"')
  expect(css).not.toContain("PLACEHOLDER")
  expect(existsSync(join(WS, "figures", "fonts", "TeXGyreTermes-Regular.woff2"))).toBe(true)
})

test("changing the venue re-vendors tokens.css through the version marker", async () => {
  await scaffold(WS, { name: "f1", archetype: "chart", claim: "c", caption: "c", width: "full" })
  expect(readFileSync(join(WS, "figures", "tokens.css"), "utf8")).toContain("venue=neurips")
  writeFileSync(join(WS, "paperino.yaml"), "venue: article\n")
  await scaffold(WS, { name: "f2", archetype: "chart", claim: "c", caption: "c", width: "full" })
  const css = readFileSync(join(WS, "figures", "tokens.css"), "utf8")
  expect(css).toContain("venue=article")
  expect(css).toContain('--font-text: "KaTeX_Main"')
})

test("scaffold creates figure dir, meta.yaml, data.json and vendors the lib once", async () => {
  await scaffold(WS, { name: "fig01-demo", archetype: "schematic", claim: "A precedes B", caption: "Demo.", width: "narrow" })
  expect(existsSync(join(WS, "figures", "fig01-demo", "figure.html"))).toBe(true)
  expect(existsSync(join(WS, "figures", "fig01-demo", "data.json"))).toBe(true)
  expect(existsSync(join(WS, "figures", "tokens.css"))).toBe(true)
  expect(existsSync(join(WS, "figures", "lib", "annot.js"))).toBe(true)
  const meta = parse(readFileSync(join(WS, "figures", "fig01-demo", "meta.yaml"), "utf8"))
  expect(meta).toEqual({
    id: "fig01-demo",
    archetype: "schematic",
    engine: "html", // the default; render/lint/review all dispatch on this
    width: "narrow",
    caption: "Demo.",
    alt: "Demo.", // defaults to the caption so a fresh figure passes meta-complete
    claim: "A precedes B",
  })
})

test("scaffold keeps an explicit alt", async () => {
  await scaffold(WS, {
    name: "fig02",
    archetype: "schematic",
    claim: "c",
    caption: "cap",
    width: "narrow",
    alt: "A described for screen readers",
  })
  const meta = parse(readFileSync(join(WS, "figures", "fig02", "meta.yaml"), "utf8"))
  expect(meta.alt).toBe("A described for screen readers")
})

// A template is a starting point the author may ASK for, not a mould they must fill.
// Defaulting to one is what made every schematic a two-column plate of .card boxes with a
// panel label, whatever the figure actually needed.
test("scaffold emits a blank canvas by default and a template only on request", async () => {
  await scaffold(WS, { name: "plain", archetype: "schematic", claim: "k", caption: "c", width: "narrow" })
  const html = readFileSync(join(WS, "figures", "plain", "figure.html"), "utf8")
  expect(html).toContain('id="fig-root"')
  expect(html).toContain("tokens.css")
  expect(html).toContain("annot.js")
  // No pre-built structure: the model composes. These are the schematic template's mould.
  expect(html).not.toContain("panel-label")
  expect(html).not.toContain('class="card"')

  await scaffold(WS, { name: "tpl", archetype: "schematic", from: "schematic", claim: "k", caption: "c", width: "narrow" })
  expect(readFileSync(join(WS, "figures", "tpl", "figure.html"), "utf8")).toContain("panel-label")
})

// data-legend appeared NOWHERE an author could read it — only in the worker line that reads
// it and a type comment in lint.ts — so rule 17, which can fire only on a legend the author
// marked, was dead in practice. The canvas is the first thing an author reads.
test("the canvas names the three attributes the rules key off", async () => {
  await scaffold(WS, { name: "attrs", archetype: "schematic", claim: "k", caption: "c", width: "narrow" })
  const html = readFileSync(join(WS, "figures", "attrs", "figure.html"), "utf8")
  for (const attr of ["data-node", "data-legend", "data-intent"]) expect(html).toContain(attr)
})

test("from: canvas is the default spelled out", async () => {
  await scaffold(WS, { name: "explicit", archetype: "chart", from: "canvas", claim: "k", caption: "c", width: "narrow" })
  await scaffold(WS, { name: "implicit", archetype: "chart", claim: "k", caption: "c", width: "narrow" })
  expect(readFileSync(join(WS, "figures", "explicit", "figure.html"), "utf8")).toBe(
    readFileSync(join(WS, "figures", "implicit", "figure.html"), "utf8"),
  )
})

test("scaffold refuses to overwrite an existing figure", async () => {
  await scaffold(WS, { name: "fig01-demo", archetype: "gallery", claim: "c", caption: "c", width: "full" })
  expect(scaffold(WS, { name: "fig01-demo", archetype: "gallery", claim: "c", caption: "c", width: "full" })).rejects.toThrow(/exists/)
})

test("scaffold appends build ignore to workspace .gitignore", async () => {
  await scaffold(WS, { name: "fig01-demo", archetype: "table", claim: "c", caption: "c", width: "full" })
  expect(readFileSync(join(WS, ".gitignore"), "utf8")).toContain("figures/*/build/")
})

test("scaffold refreshes vendored tokens.css + lib when the version marker differs", async () => {
  // A workspace stranded on the v1 design system: stale tokens, stale lib.
  mkdirSync(join(WS, "figures", "lib"), { recursive: true })
  writeFileSync(join(WS, "figures", "tokens.css"), "/* paperino-tokens v1 */\n:root { --bg: #fff; }\n")
  writeFileSync(join(WS, "figures", "lib", "stale.js"), "// stale")

  await scaffold(WS, { name: "fig-refresh", archetype: "schematic", claim: "c", caption: "cap", width: "full" })

  // tokens.css and lib/ are machine-owned: the upgrade is deliberate, not drift.
  expect(readFileSync(join(WS, "figures", "tokens.css"), "utf8").split("\n")[0]).toBe(
    "/* paperino-tokens v3.0 venue=neurips */",
  )
  expect(existsSync(join(WS, "figures", "lib", "math.js"))).toBe(true)
  expect(existsSync(join(WS, "figures", "lib", "katex", "katex.mjs"))).toBe(true)
  expect(existsSync(join(WS, "figures", "lib", "stale.js"))).toBe(false)
})

test("scaffold leaves a current tokens.css alone", async () => {
  await scaffold(WS, { name: "fig-a", archetype: "schematic", claim: "c", caption: "cap", width: "full" })
  const tokens = join(WS, "figures", "tokens.css")
  writeFileSync(tokens, readFileSync(tokens, "utf8") + "\n/* local tweak */\n")
  await scaffold(WS, { name: "fig-b", archetype: "schematic", claim: "c", caption: "cap", width: "full" })
  // same version -> not clobbered
  expect(readFileSync(tokens, "utf8")).toContain("/* local tweak */")
})
