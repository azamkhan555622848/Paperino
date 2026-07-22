import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearFetchRequest, readFetchRequest, shelfPathFor } from "./institutional"

const ws = () => mkdtempSync(join(tmpdir(), "inst-"))

const write = (dir: string, body: string) => {
  mkdirSync(join(dir, ".paperino"), { recursive: true })
  writeFileSync(join(dir, ".paperino", "fetch-request.json"), body)
}

const fresh = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    doi: "10.1038/x",
    url: "https://doi.org/10.1038/x",
    publisher: "Springer Nature",
    requestedAt: new Date().toISOString(),
    ...over,
  })

describe("readFetchRequest", () => {
  test("reads a well-formed request", () => {
    const dir = ws()
    write(dir, fresh())
    expect(readFetchRequest(dir)?.publisher).toBe("Springer Nature")
  })

  test("absent, malformed, or incomplete all yield undefined rather than throwing", () => {
    expect(readFetchRequest(ws())).toBeUndefined()

    const bad = ws()
    write(bad, "{not json")
    expect(readFetchRequest(bad)).toBeUndefined()

    const partial = ws()
    write(partial, JSON.stringify({ doi: "10.1038/x" }))
    expect(readFetchRequest(partial)).toBeUndefined()
  })

  // A stale request must not pop a login window on a workspace the user has moved on from.
  test("a request older than an hour is ignored", () => {
    const dir = ws()
    write(dir, fresh({ requestedAt: new Date(Date.now() - 7_200_000).toISOString() }))
    expect(readFetchRequest(dir)).toBeUndefined()
  })
})

test("clearFetchRequest removes the file and is safe when there is none", () => {
  const dir = ws()
  write(dir, fresh())
  clearFetchRequest(dir)
  expect(readFetchRequest(dir)).toBeUndefined()
  clearFetchRequest(dir) // second call must not throw
})

test("shelfPathFor matches the slug the MCP writes, so a saved PDF is found by the shelf rung", () => {
  expect(shelfPathFor("10.1038/s41586-021-03819-2")).toBe("papers/10.1038_s41586-021-03819-2.pdf")
})
