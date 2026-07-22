import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PUBLISHER_LABEL, publisherFor, readAuthStore, tdmKey } from "../src/tdm"

test("publisherFor maps DOI prefixes to the three TDM providers", () => {
  expect(publisherFor("10.1038/s41586-021-03819-2")).toBe("springer") // Nature
  expect(publisherFor("10.1007/s00429-020-02073-y")).toBe("springer") // Springer
  expect(publisherFor("10.1186/s13059-021-02411-1")).toBe("springer") // BMC
  expect(publisherFor("10.1016/j.cell.2021.01.001")).toBe("elsevier")
  expect(publisherFor("10.1002/anie.202100000")).toBe("wiley")
  expect(publisherFor("10.1111/j.1365-2958.2010.07118.x")).toBe("wiley")
})

test("publisherFor returns undefined for a publisher we have no TDM client for", () => {
  expect(publisherFor("10.1126/science.abc1234")).toBeUndefined() // AAAS
  expect(publisherFor("10.48550/arXiv.2305.13245")).toBeUndefined()
  expect(publisherFor("not-a-doi")).toBeUndefined()
})

test("PUBLISHER_LABEL names each provider for the user", () => {
  expect(PUBLISHER_LABEL.springer).toBe("Springer Nature")
  expect(PUBLISHER_LABEL.elsevier).toBe("Elsevier")
  expect(PUBLISHER_LABEL.wiley).toBe("Wiley")
})

test("readAuthStore honours XDG_DATA_HOME so a packaged build reads its own isolated store", () => {
  const home = mkdtempSync(join(tmpdir(), "xdg-"))
  mkdirSync(join(home, "opencode"), { recursive: true })
  writeFileSync(join(home, "opencode", "auth.json"), JSON.stringify({ "tdm-springer": { key: "abc" } }))
  expect(readAuthStore({ XDG_DATA_HOME: home })["tdm-springer"]?.key).toBe("abc")
})

test("readAuthStore on a missing store is empty, not a throw", () => {
  expect(readAuthStore({ XDG_DATA_HOME: mkdtempSync(join(tmpdir(), "xdg-")) })).toEqual({})
})

test("tdmKey: env beats the auth store, and absence is undefined not empty string", () => {
  const auth = { "tdm-elsevier": { key: "from-store" } }
  expect(tdmKey("elsevier", {}, auth)).toBe("from-store")
  expect(tdmKey("elsevier", { PAPERINO_TDM_ELSEVIER: "from-env" }, auth)).toBe("from-env")
  expect(tdmKey("wiley", {}, auth)).toBeUndefined()
  expect(tdmKey("wiley", {}, { "tdm-wiley": { key: "" } })).toBeUndefined()
})
