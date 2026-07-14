import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BIB_FILE, BIB_HEADER, appendEntry, citeKey, field, findExisting, scanBib, withKey } from "../src/bib"

const scratch = () => mkdtempSync(join(tmpdir(), "lit-bib-"))

const ENTRY = `@article{Khan_2026,
  title = {Sensitivity-Adaptive {KV} Cache Compression},
  author = {Khan, Azam and Honda, Karen},
  year = {2026},
  doi = {10.1000/Abc.123},
}`

// Nested braces are ordinary in BibTeX — publishers brace acronyms to stop BibTeX lowercasing
// them. A naive match to the first } truncates the title.
test("field honors nested braces", () => {
  expect(field(ENTRY, "title")).toBe("Sensitivity-Adaptive {KV} Cache Compression")
  expect(field(ENTRY, "author")).toBe("Khan, Azam and Honda, Karen")
  expect(field(ENTRY, "year")).toBe("2026")
  expect(field(ENTRY, "missing")).toBe("")
})

test("withKey swaps whatever key the publisher used for ours", () => {
  expect(withKey(ENTRY, "khan2026sensitivity")).toStartWith("@article{khan2026sensitivity,")
  expect(withKey(ENTRY, "khan2026sensitivity")).toContain("doi = {10.1000/Abc.123}")
})

test("scanBib reads keys and ids back out, lowercasing the DOI", () => {
  const entries = scanBib(`${BIB_HEADER}\n${ENTRY}\n`)
  expect(entries).toHaveLength(1)
  expect(entries[0]!.key).toBe("Khan_2026")
  expect(entries[0]!.doi).toBe("10.1000/abc.123")
})

// What doi.org ACTUALLY returns: the entire entry on one line, closing with " }". An
// entry-terminating regex anchored on a newline (\n\s*\}) never matches it — so every real
// resolved entry was invisible to the dedupe scan, and citing the same DOI twice appended it
// twice. The multi-line fixture above hid that completely. Brace-count instead.
test("scanBib reads the single-line entries doi.org really returns", () => {
  const real =
    ` @article{Jumper_2021, title={Highly accurate protein structure prediction with AlphaFold},` +
    ` volume={596}, ISSN={1476-4687}, DOI={10.1038/s41586-021-03819-2}, number={7873},` +
    ` journal={Nature}, author={Jumper, John and Evans, Richard}, year={2021}, month=July,` +
    ` pages={583–589} }\n`
  const entries = scanBib(real)
  expect(entries).toHaveLength(1)
  expect(entries[0]!.key).toBe("Jumper_2021")
  expect(entries[0]!.doi).toBe("10.1038/s41586-021-03819-2")
  expect(entries[0]!.title).toBe("Highly accurate protein structure prediction with AlphaFold")
})

test("citeKey is family+year+first significant title word", () => {
  const key = citeKey(
    { author: "Khan, Azam and Honda, Karen", year: "2026", title: "The Sensitivity of KV Caches" },
    new Set(),
  )
  expect(key).toBe("khan2026sensitivity")
})

test("citeKey folds accents — a BibTeX key must be ASCII", () => {
  expect(citeKey({ author: "Müller, Anja", year: "2024", title: "Deep Nets" }, new Set())).toBe("muller2024deep")
})

test("citeKey handles first-last author order too", () => {
  expect(citeKey({ author: "Azam Khan and Karen Honda", year: "2026", title: "Quantization" }, new Set())).toBe(
    "khan2026quantization",
  )
})

// Two different works sharing a key makes one of them uncitable — LaTeX resolves \cite{k} to one.
test("citeKey suffixes on collision rather than overwriting", () => {
  const taken = new Set(["khan2026deep"])
  expect(citeKey({ author: "Khan, A", year: "2026", title: "Deep Nets" }, taken)).toBe("khan2026deepb")
})

// Idempotency must survive the agent reaching the same paper by a different route: arXiv id one
// day, the published DOI the next. Matching on the resolved DOI is what makes that work.
test("findExisting matches on the resolved DOI whatever id was passed", () => {
  const entries = scanBib(ENTRY)
  expect(findExisting(entries, { scheme: "arxiv", value: "2305.13245" }, "10.1000/abc.123")).toBe("Khan_2026")
  expect(findExisting(entries, { scheme: "doi", value: "10.1000/ABC.123" })).toBe("Khan_2026")
  expect(findExisting(entries, { scheme: "doi", value: "10.9999/other" })).toBeUndefined()
})

test("findExisting matches an arXiv eprint ignoring its version", () => {
  const entries = scanBib(`@misc{a2023b,
  title = {A Preprint},
  author = {Ada, Lovelace},
  year = {2023},
  eprint = {2305.13245},
  archivePrefix = {arXiv},
}`)
  expect(findExisting(entries, { scheme: "arxiv", value: "2305.13245v3" })).toBe("a2023b")
})

test("appendEntry creates the file with the machine-owned header", () => {
  const dir = scratch()
  appendEntry(dir, ENTRY)
  const text = readFileSync(join(dir, BIB_FILE), "utf8")
  expect(text).toStartWith(BIB_HEADER)
  expect(text).toContain("@article{Khan_2026,")
  expect(existsSync(join(dir, `${BIB_FILE}.tmp`))).toBe(false) // atomic write leaves no litter
  rmSync(dir, { recursive: true, force: true })
})

// The file is machine-owned, not machine-rewritten: whatever is already in it survives byte for
// byte. Reformatting someone's file is how a "citation manager" earns distrust.
test("appendEntry preserves existing bytes exactly", () => {
  const dir = scratch()
  const before = `${BIB_HEADER}\n@book{old2001thing,\n  title = {Old Thing},\n}\n`
  writeFileSync(join(dir, BIB_FILE), before)
  appendEntry(dir, ENTRY)
  const after = readFileSync(join(dir, BIB_FILE), "utf8")
  expect(after).toStartWith(before)
  expect(after).toContain("@article{Khan_2026,")
  rmSync(dir, { recursive: true, force: true })
})
