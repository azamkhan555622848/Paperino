import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { arxivPdfUrl, oaVersion, pickOaLocation, unpaywallEmail } from "../src/oa"

test("oaVersion maps Unpaywall's vocabulary onto ours", () => {
  expect(oaVersion("publishedVersion")).toBe("version-of-record")
  expect(oaVersion("acceptedVersion")).toBe("accepted-manuscript")
  expect(oaVersion("submittedVersion")).toBe("preprint")
  // An OA location with no stated version is an accepted manuscript at best — never claim
  // version-of-record on silence, because the agent repeats that claim to the user.
  expect(oaVersion(undefined)).toBe("accepted-manuscript")
})

test("pickOaLocation prefers a direct PDF url, falls back to the landing page", () => {
  expect(
    pickOaLocation({
      is_oa: true,
      best_oa_location: { url_for_pdf: "https://x/p.pdf", url: "https://x/land", version: "publishedVersion" },
    }),
  ).toEqual({ url: "https://x/p.pdf", version: "version-of-record" })

  expect(
    pickOaLocation({
      is_oa: true,
      best_oa_location: { url_for_pdf: null, url: "https://x/land", version: "acceptedVersion" },
    }),
  ).toEqual({ url: "https://x/land", version: "accepted-manuscript" })
})

test("pickOaLocation returns undefined when the record is not open access", () => {
  expect(pickOaLocation({ is_oa: false, best_oa_location: null })).toBeUndefined()
  expect(pickOaLocation({ is_oa: true, best_oa_location: null })).toBeUndefined()
})

test("unpaywallEmail: env beats paperino.yaml beats the generic constant", () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-"))
  expect(unpaywallEmail(dir, {})).toBe("paperino@users.noreply.github.com")

  writeFileSync(join(dir, "paperino.yaml"), "unpaywall_email: me@uni.edu\n")
  expect(unpaywallEmail(dir, {})).toBe("me@uni.edu")

  expect(unpaywallEmail(dir, { PAPERINO_UNPAYWALL_EMAIL: "env@uni.edu" })).toBe("env@uni.edu")
})

test("arxivPdfUrl drops the version suffix", () => {
  expect(arxivPdfUrl("2305.13245v2")).toBe("https://arxiv.org/pdf/2305.13245")
  expect(arxivPdfUrl("cs/0501001")).toBe("https://arxiv.org/pdf/cs/0501001")
})

// Live. Marked with a generous timeout, following resolve.test.ts's precedent.
test(
  "live: a known green-OA DOI resolves to a downloadable PDF",
  async () => {
    const { downloadPdf, unpaywallLookup } = await import("../src/oa")
    // AlphaFold (Nature 2021) — paywalled at the publisher, deposited open in PMC.
    const hit = await unpaywallLookup("10.1038/s41586-021-03819-2", "paperino@users.noreply.github.com")
    expect(hit).toBeDefined()
    const bytes = await downloadPdf(hit!.url)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toStartWith("%PDF")
  },
  120_000,
)
