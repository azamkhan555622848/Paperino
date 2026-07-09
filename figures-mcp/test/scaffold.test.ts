import { beforeEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { scaffold } from "../src/scaffold"

const WS = join(import.meta.dir, "tmp-ws")

beforeEach(() => {
  rmSync(WS, { recursive: true, force: true })
  mkdirSync(WS, { recursive: true })
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

test("scaffold refuses to overwrite an existing figure", async () => {
  await scaffold(WS, { name: "fig01-demo", archetype: "gallery", claim: "c", caption: "c", width: "full" })
  expect(scaffold(WS, { name: "fig01-demo", archetype: "gallery", claim: "c", caption: "c", width: "full" })).rejects.toThrow(/exists/)
})

test("scaffold appends build ignore to workspace .gitignore", async () => {
  await scaffold(WS, { name: "fig01-demo", archetype: "table", claim: "c", caption: "c", width: "full" })
  expect(readFileSync(join(WS, ".gitignore"), "utf8")).toContain("figures/*/build/")
})
