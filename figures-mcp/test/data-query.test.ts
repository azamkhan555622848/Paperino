import { beforeEach, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { dataQuery } from "../src/data-query"

const WS = join(import.meta.dir, "tmp-dq-ws")

beforeEach(() => {
  rmSync(WS, { recursive: true, force: true })
  mkdirSync(join(WS, "artifacts"), { recursive: true })
  writeFileSync(
    join(WS, "artifacts", "results.json"),
    JSON.stringify({ runs: [{ id: "a", speedup: 14617 }, { id: "b", speedup: 639 }] }),
  )
})

test("evaluates a jq expression against a workspace file", async () => {
  const out = await dataQuery(WS, "artifacts/results.json", "[.runs[].speedup]")
  expect(JSON.parse(out)).toEqual([14617, 639])
})

test("rejects paths escaping the workspace", async () => {
  expect(dataQuery(WS, "../outside.json", ".")).rejects.toThrow(/inside the workspace/)
})

test("names the file on jq errors", async () => {
  expect(dataQuery(WS, "artifacts/results.json", ".runs[")).rejects.toThrow(/results\.json/)
})
