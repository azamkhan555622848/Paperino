import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type Deps, FETCH_REQUEST_PATH, runLadder } from "../src/fulltext"
import { saveToShelf } from "../src/shelf"

const ws = () => mkdtempSync(join(tmpdir(), "ft-"))
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])

/** Every rung off by default; each test switches on only the rung it is about. */
const deps = (over: Partial<Deps> = {}): Deps => ({
  resolve: async () => ({ doi: "10.1038/x", title: "A Paper" }),
  unpaywall: async () => undefined,
  tdm: async () => undefined,
  download: async () => PDF,
  email: () => "test@example.org",
  ...over,
})

test("the shelf short-circuits the ladder — no network rung is consulted", async () => {
  const dir = ws()
  saveToShelf(dir, PDF, { ident: "10.1038/x", doi: "10.1038/x", version: "version-of-record", addedBy: "unpaywall" })

  let touched = false
  const result = await runLadder(
    dir,
    { scheme: "doi", value: "10.1038/X" },
    deps({
      unpaywall: async () => {
        touched = true
        return undefined
      },
    }),
  )

  expect(result.status).toBe("have")
  expect(result.status === "have" && result.source).toBe("shelf")
  expect(touched).toBe(false)
})

test("Unpaywall wins when the shelf is empty, and its version tag is carried through", async () => {
  const dir = ws()
  const result = await runLadder(
    dir,
    { scheme: "doi", value: "10.1038/x" },
    deps({ unpaywall: async () => ({ url: "https://x/p.pdf", version: "accepted-manuscript" }) }),
  )

  expect(result.status === "have" && result.source).toBe("unpaywall")
  expect(result.status === "have" && result.version).toBe("accepted-manuscript")
  expect(existsSync(join(dir, "papers", "10.1038_x.pdf"))).toBe(true)
})

test("an arXiv id with no published DOI takes the preprint rung and is tagged preprint", async () => {
  const dir = ws()
  const result = await runLadder(
    dir,
    { scheme: "arxiv", value: "2305.13245" },
    deps({ resolve: async () => ({ doi: undefined, title: "A Preprint" }) }),
  )

  expect(result.status === "have" && result.source).toBe("preprint")
  expect(result.status === "have" && result.version).toBe("preprint")
})

test("TDM runs only below Unpaywall — a free copy is never traded for a metered call", async () => {
  const dir = ws()
  let tdmCalled = false
  await runLadder(
    dir,
    { scheme: "doi", value: "10.1038/x" },
    deps({
      unpaywall: async () => ({ url: "https://x/p.pdf", version: "version-of-record" }),
      tdm: async () => {
        tdmCalled = true
        return PDF
      },
    }),
  )
  expect(tdmCalled).toBe(false)
})

test("TDM catches what Unpaywall misses, tagged version-of-record", async () => {
  const dir = ws()
  const result = await runLadder(dir, { scheme: "doi", value: "10.1038/x" }, deps({ tdm: async () => PDF }))
  expect(result.status === "have" && result.source).toBe("tdm")
  expect(result.status === "have" && result.version).toBe("version-of-record")
})

test("every rung dry: needs-institutional-fetch, nothing written but the request", async () => {
  const dir = ws()
  const result = await runLadder(dir, { scheme: "doi", value: "10.1038/x" }, deps())

  expect(result.status).toBe("needs-institutional-fetch")
  expect(result.status === "needs-institutional-fetch" && result.publisher).toBe("Springer Nature")
  expect(result.status === "needs-institutional-fetch" && result.url).toBe("https://doi.org/10.1038/x")
  expect(existsSync(join(dir, "papers", "10.1038_x.pdf"))).toBe(false)

  const request = JSON.parse(readFileSync(join(dir, FETCH_REQUEST_PATH), "utf8"))
  expect(request.doi).toBe("10.1038/x")
  expect(request.requestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
})

test("a rung that throws does not sink the ladder — the next one still runs", async () => {
  const dir = ws()
  const result = await runLadder(
    dir,
    { scheme: "doi", value: "10.1038/x" },
    deps({
      unpaywall: async () => {
        throw new Error("Unpaywall is down")
      },
      tdm: async () => PDF,
    }),
  )
  expect(result.status === "have" && result.source).toBe("tdm")
})

// A doi.org outage must not make a free paper look paywalled: the caller already gave us the DOI.
test("when resolution fails, a caller-supplied DOI is still used for the later rungs", async () => {
  const dir = ws()
  let askedFor: string | undefined
  const result = await runLadder(
    dir,
    { scheme: "doi", value: "10.1038/X" },
    deps({
      resolve: async () => {
        throw new Error("doi.org is down")
      },
      unpaywall: async (doi) => {
        askedFor = doi
        return { url: "https://x/p.pdf", version: "version-of-record" }
      },
    }),
  )
  expect(askedFor).toBe("10.1038/x")
  expect(result.status === "have" && result.source).toBe("unpaywall")
})
