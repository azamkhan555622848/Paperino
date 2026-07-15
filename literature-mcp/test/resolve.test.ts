import { expect, test } from "bun:test"
import { resolveId } from "../src/resolve"

// Live network, like the Tectonic compile tests. Generous timeouts on purpose. If arXiv or NCBI
// rate-limits, wait and rerun — do NOT add retries to src/ to make a flaky test green.
const NET = 60_000

test(
  "a DOI resolves to the publisher's own BibTeX",
  async () => {
    const r = await resolveId({ scheme: "doi", value: "10.1038/s41586-021-03819-2" })
    expect(r.bibtex).toStartWith("@")
    expect(r.doi).toBe("10.1038/s41586-021-03819-2")
    expect(r.fields.year).toBe("2021")
    expect(r.fields.title.toLowerCase()).toContain("alphafold")
    expect(r.upgradedFrom).toBeUndefined()
  },
  NET,
)

// A preprint that was never published stays a preprint: @misc with an eprint, which is exactly how
// it should appear in a bibliography. Probed 2026-07-14: 2305.13245 (GQA) carries no arxiv:doi.
test(
  "an unpublished arXiv preprint becomes @misc with its eprint",
  async () => {
    const r = await resolveId({ scheme: "arxiv", value: "2305.13245" })
    expect(r.bibtex).toStartWith("@misc{")
    expect(r.bibtex).toContain("eprint = {2305.13245}")
    expect(r.bibtex).toContain("archivePrefix = {arXiv}")
    expect(r.fields.title.toLowerCase()).toContain("gqa")
    expect(r.doi).toBeUndefined()
  },
  NET,
)

// The upgrade rule. Once a preprint is published, citing the preprint misrepresents the work —
// arXiv records the DOI when that happens, so we follow it. Probed 2026-07-14: 1207.7214 (the ATLAS
// Higgs discovery) carries arxiv:doi 10.1016/j.physletb.2012.08.020. If this ever stops upgrading,
// the record LOST its DOI — investigate that, do not relax the rule.
test(
  "an arXiv record carrying a DOI upgrades to the published version",
  async () => {
    const r = await resolveId({ scheme: "arxiv", value: "1207.7214" })
    expect(r.upgradedFrom).toBe("arXiv:1207.7214")
    expect(r.doi).toBe("10.1016/j.physletb.2012.08.020")
    expect(r.bibtex).not.toStartWith("@misc{")
  },
  NET,
)

// Probed 2026-07-14: PMID 34265844 IS the AlphaFold paper and carries the same DOI — so this
// exercises the PubMed upgrade path against a record whose shape we already know.
test(
  "a PMID upgrades to its DOI",
  async () => {
    const r = await resolveId({ scheme: "pmid", value: "34265844" })
    expect(r.doi).toBe("10.1038/s41586-021-03819-2")
    expect(r.upgradedFrom).toBe("PMID:34265844")
    expect(r.fields.title.toLowerCase()).toContain("alphafold")
  },
  NET,
)

// The load-bearing failure. A resolver that invents an entry out of thin metadata is the exact
// thing product rule 2 exists to prevent: a bad id must throw, so `cite` writes nothing.
test(
  "an unresolvable id rejects",
  async () => {
    await expect(resolveId({ scheme: "doi", value: "10.9999/definitely-not-a-real-doi-xyz" })).rejects.toThrow()
  },
  NET,
)
