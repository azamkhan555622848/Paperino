import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findOnShelf, identOf, listShelf, saveToShelf, slugFor } from "../src/shelf"

const ws = () => mkdtempSync(join(tmpdir(), "shelf-"))

test("identOf lowercases a DOI and namespaces an arXiv id", () => {
  expect(identOf({ scheme: "doi", value: "10.1038/S41586-021-03819-2" })).toBe("10.1038/s41586-021-03819-2")
  expect(identOf({ scheme: "arxiv", value: "2305.13245v2" })).toBe("arxiv:2305.13245")
})

test("slugFor makes an identifier filesystem-safe", () => {
  expect(slugFor("10.1038/s41586-021-03819-2")).toBe("10.1038_s41586-021-03819-2")
  expect(slugFor("arxiv:2305.13245")).toBe("arxiv_2305.13245")
})

test("saveToShelf writes the PDF and an index entry, and findOnShelf reads it back", () => {
  const dir = ws()
  const saved = saveToShelf(dir, new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
    ident: "10.1038/x",
    doi: "10.1038/x",
    version: "version-of-record",
    addedBy: "unpaywall",
    title: "A Paper",
  })
  expect(saved.file).toBe("10.1038_x.pdf")
  expect(readFileSync(join(dir, "papers", "10.1038_x.pdf"))).toEqual(Buffer.from([0x25, 0x50, 0x44, 0x46]))

  const found = findOnShelf(dir, "10.1038/x")
  expect(found?.version).toBe("version-of-record")
  expect(found?.addedBy).toBe("unpaywall")
})

test("a second save preserves the first index entry", () => {
  const dir = ws()
  saveToShelf(dir, new Uint8Array([1]), { ident: "10.1/a", version: "preprint", addedBy: "preprint" })
  saveToShelf(dir, new Uint8Array([2]), { ident: "10.1/b", version: "preprint", addedBy: "preprint" })
  expect(findOnShelf(dir, "10.1/a")).toBeDefined()
  expect(findOnShelf(dir, "10.1/b")).toBeDefined()
})

test("a manually dropped PDF lists as manual-drop / unknown", () => {
  const dir = ws()
  mkdirSync(join(dir, "papers"))
  writeFileSync(join(dir, "papers", "someones-download.pdf"), "x")
  const listed = listShelf(dir)
  expect(listed.length).toBe(1)
  expect(listed[0]!.addedBy).toBe("manual-drop")
  expect(listed[0]!.version).toBe("unknown")
})

test("listShelf on a workspace with no papers folder is empty, not an error", () => {
  expect(listShelf(ws())).toEqual([])
})
