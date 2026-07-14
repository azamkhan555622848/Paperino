import { expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const KATEX = join(import.meta.dir, "..", "src", "assets", "lib", "katex")

test("katex dist is vendored (css, esm, woff2 fonts)", () => {
  expect(existsSync(join(KATEX, "katex.min.css"))).toBe(true)
  expect(existsSync(join(KATEX, "katex.mjs"))).toBe(true)
  const fonts = readdirSync(join(KATEX, "fonts")).filter((f) => f.endsWith(".woff2"))
  // Main (4 weights/styles), Math, Size1-4, Typewriter, AMS, Caligraphic, Fraktur, SansSerif, Script
  expect(fonts.length).toBeGreaterThanOrEqual(15)
  expect(fonts).toContain("KaTeX_Main-Regular.woff2")
  expect(fonts).toContain("KaTeX_Typewriter-Regular.woff2")
})

test("math.js exists and renders .math spans via the vendored katex", () => {
  const src = readFileSync(join(import.meta.dir, "..", "src", "assets", "lib", "math.js"), "utf8")
  expect(src).toContain("katex/katex.mjs")
  expect(src).toContain("throwOnError: true")
  expect(src).toContain("document.fonts.ready")
})

test("tokens.css is v2 publication style", () => {
  const css = readFileSync(join(import.meta.dir, "..", "src", "assets", "tokens.css"), "utf8")
  expect(css.split("\n")[0]).toBe("/* paperino-tokens v2.1 */")
  expect(css).toContain('font-family: "KaTeX_Main"')
  expect(css).toContain(".panel-label")
  expect(css).not.toContain("Segoe UI")
  expect(css).not.toContain("border-radius: 8px")
})
