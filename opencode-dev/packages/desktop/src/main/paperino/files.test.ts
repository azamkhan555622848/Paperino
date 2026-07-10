import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listWorkspaceFiles, readWorkspaceFile, resolveWithin } from "./files"

const root = mkdtempSync(join(tmpdir(), "paperino-files-"))
mkdirSync(join(root, "figures"), { recursive: true })
mkdirSync(join(root, ".git"), { recursive: true })
mkdirSync(join(root, "node_modules", "pkg"), { recursive: true })
writeFileSync(join(root, "main.tex"), "\\documentclass{article}")
writeFileSync(join(root, "figures", "plot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
writeFileSync(join(root, ".git", "config"), "[core]")
writeFileSync(join(root, "node_modules", "pkg", "index.js"), "module.exports = {}")

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe("listWorkspaceFiles", () => {
  test("recursive, relative, forward slashes, skips .git and node_modules", async () => {
    const result = await listWorkspaceFiles(root)
    expect(result.files).toEqual(["figures/plot.png", "main.tex"])
    expect(result.truncated).toBe(false)
  })

  test("stops at the cap and reports truncation", async () => {
    const result = await listWorkspaceFiles(root, 1)
    expect(result.files.length).toBe(1)
    expect(result.truncated).toBe(true)
  })
})

describe("resolveWithin", () => {
  test("accepts nested relative paths", () => {
    expect(resolveWithin(root, "figures/plot.png")).toBe(join(root, "figures", "plot.png"))
  })
  test("rejects traversal, absolute paths, empty and the dir itself", () => {
    expect(resolveWithin(root, "../evil.txt")).toBeUndefined()
    expect(resolveWithin(root, "figures/../../evil.txt")).toBeUndefined()
    expect(resolveWithin(root, "C:/Windows/system.ini")).toBeUndefined()
    expect(resolveWithin(root, "")).toBeUndefined()
    expect(resolveWithin(root, ".")).toBeUndefined()
  })
})

describe("readWorkspaceFile", () => {
  test("returns bytes for a real file", async () => {
    const result = await readWorkspaceFile(root, "main.tex")
    if (!result.ok) throw new Error("expected ok")
    expect(new TextDecoder().decode(result.bytes)).toBe("\\documentclass{article}")
  })
  test("not-found for missing files and directories", async () => {
    expect(await readWorkspaceFile(root, "nope.txt")).toEqual({ ok: false, error: "not-found" })
    expect(await readWorkspaceFile(root, "figures")).toEqual({ ok: false, error: "not-found" })
  })
  test("invalid-path for traversal", async () => {
    expect(await readWorkspaceFile(root, "../evil.txt")).toEqual({ ok: false, error: "invalid-path" })
  })
  test("too-large above the cap", async () => {
    expect(await readWorkspaceFile(root, "main.tex", 4)).toEqual({ ok: false, error: "too-large" })
  })
})
