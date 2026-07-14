# literature-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make product rule 2 real — `references.bib` becomes a file only a machine can write, and every entry in it is resolved from a DOI, arXiv id or PMID.

**Architecture:** Paperclip (`https://paperclip.gxl.ai/mcp`) is registered as a **remote MCP server** and does discovery + full-text reading — we build none of it. We build **literature-mcp**, a small local MCP server with two tools (`cite`, `bib_list`) that is the sole writer of `references.bib`. The keystone is a permission rule denying the agent `edit` on that path, so rule 2 is an unavailable capability rather than a sentence in a prompt.

**Tech Stack:** TypeScript, bun (dev/test), `@modelcontextprotocol/sdk`, zod. Node-compatible APIs only (`fetch`, `node:fs`, `node:path`) — the packaged build runs the same bundle on the app's own `electron.exe` under `ELECTRON_RUN_AS_NODE=1`. No new binaries, no Python, no database.

**Spec:** `docs/superpowers/specs/2026-07-14-literature-mcp-design.md`

## Global Constraints

- **Never `git add -A` or `git commit -a`.** Stage explicit paths. The git root is `C:/Users/azamk/Documents` (a mega-repo); Paperino is a subdirectory on branch `feat/paperino`. All `git add` paths below are written relative to that root.
- **No bun-specific API in `src/`.** `import.meta.dir` is undefined under node — use `dirname(fileURLToPath(import.meta.url))` if a path is ever needed. Tests may use bun APIs freely.
- **No tool may accept BibTeX text.** `cite` takes an identifier. This is the design, not a simplification.
- **No secret in any config or artifact.** Paperclip authenticates by MCP OAuth (dynamic client registration + PKCE, verified 2026-07-14). Never add an `X-API-Key` header to a config file.
- **`Permission.evaluate` uses `findLast`, so later keys win.** In `permission.edit`, `"*": "allow"` must come *before* `"references.bib": "deny"`.
- Existing bytes in `references.bib` are never reformatted or re-serialized. Append only.
- Verify against the **running packaged app**, not only tests — every packaging bug in this project so far passed the suite and failed in the app.

---

### Task 1: Scaffold literature-mcp and parse identifiers

**Files:**
- Create: `Paperino/literature-mcp/package.json`
- Create: `Paperino/literature-mcp/tsconfig.json`
- Create: `Paperino/literature-mcp/src/ids.ts`
- Test: `Paperino/literature-mcp/test/ids.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export type PaperId = { scheme: "doi" | "arxiv" | "pmid"; value: string }` and `export function parseId(raw: string): PaperId | undefined`. Tasks 3 and 4 both import these.

- [ ] **Step 1: Create the package manifest**

`Paperino/literature-mcp/package.json` — mirrors figures-mcp minus everything browser-related:

```json
{
  "name": "literature-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun src/server.ts",
    "build:dist": "bun scripts/build-dist.ts",
    "test": "bun test"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/bun": "^1.2.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create the tsconfig** (byte-identical to `figures-mcp/tsconfig.json`)

`Paperino/literature-mcp/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun"],
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `cd Paperino/literature-mcp && bun install`
Expected: `bun.lock` and `node_modules/` created, no errors.

- [ ] **Step 4: Write the failing test**

`Paperino/literature-mcp/test/ids.test.ts`:

```ts
import { expect, test } from "bun:test"
import { parseId } from "../src/ids"

test("DOIs parse, with or without their prefixes", () => {
  expect(parseId("10.48550/arXiv.2305.13245")).toEqual({ scheme: "doi", value: "10.48550/arXiv.2305.13245" })
  expect(parseId("doi:10.1038/s41586-021-03819-2")).toEqual({ scheme: "doi", value: "10.1038/s41586-021-03819-2" })
  expect(parseId("https://doi.org/10.1038/s41586-021-03819-2")).toEqual({
    scheme: "doi",
    value: "10.1038/s41586-021-03819-2",
  })
})

test("arXiv ids parse, new and old style", () => {
  expect(parseId("2305.13245")).toEqual({ scheme: "arxiv", value: "2305.13245" })
  expect(parseId("arXiv:2305.13245v3")).toEqual({ scheme: "arxiv", value: "2305.13245v3" })
  expect(parseId("https://arxiv.org/abs/2305.13245")).toEqual({ scheme: "arxiv", value: "2305.13245" })
  expect(parseId("cs/0501001")).toEqual({ scheme: "arxiv", value: "cs/0501001" })
  expect(parseId("math.GT/0309136")).toEqual({ scheme: "arxiv", value: "math.GT/0309136" })
})

// A bare integer is a plausible PMID and an equally plausible typo. Requiring the prefix means a
// mistyped id fails loudly instead of citing whatever paper happens to hold that number.
test("a PMID needs its prefix", () => {
  expect(parseId("PMID:34265844")).toEqual({ scheme: "pmid", value: "34265844" })
  expect(parseId("pmid: 34265844")).toEqual({ scheme: "pmid", value: "34265844" })
  expect(parseId("34265844")).toBeUndefined()
})

// The whole point of the tool surface: a "closest match" is how a wrong citation enters a paper.
test("fuzzy input is refused", () => {
  expect(parseId("Attention Is All You Need")).toBeUndefined()
  expect(parseId("vaswani 2017")).toBeUndefined()
  expect(parseId("10.1038")).toBeUndefined()
  expect(parseId("")).toBeUndefined()
})
```

- [ ] **Step 5: Run the test and watch it fail**

Run: `cd Paperino/literature-mcp && bun test test/ids.test.ts`
Expected: FAIL — `Cannot find module '../src/ids'`.

- [ ] **Step 6: Implement `ids.ts`**

`Paperino/literature-mcp/src/ids.ts`:

```ts
export type PaperId = { scheme: "doi" | "arxiv" | "pmid"; value: string }

const DOI_RE = /^10\.\d{4,9}\/\S+$/
// 2305.13245, optionally versioned.
const ARXIV_NEW_RE = /^\d{4}\.\d{4,5}(v\d+)?$/
// Pre-2007: cs/0501001, math.GT/0309136.
const ARXIV_OLD_RE = /^[a-z-]+(\.[A-Z]{2})?\/\d{7}(v\d+)?$/

/**
 * Parse an EXACT identifier. Fuzzy input — a title, an author, a search phrase — returns
 * undefined, and that refusal is the feature: `cite` must never accept a closest match,
 * because a closest match is how a wrong citation gets into a paper.
 *
 * A bare integer is rejected even though it looks like a PMID: it is equally plausibly a
 * typo, so the PMID: prefix is required and a mistake fails loudly.
 */
export function parseId(raw: string): PaperId | undefined {
  const s = raw.trim()

  const pmid = s.match(/^pmid:\s*(\d+)$/i)
  if (pmid) return { scheme: "pmid", value: pmid[1]! }

  const doi = s.replace(/^doi:\s*/i, "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
  if (DOI_RE.test(doi)) return { scheme: "doi", value: doi }

  const arxiv = s.replace(/^arxiv:\s*/i, "").replace(/^https?:\/\/arxiv\.org\/abs\//i, "")
  if (ARXIV_NEW_RE.test(arxiv) || ARXIV_OLD_RE.test(arxiv)) return { scheme: "arxiv", value: arxiv }

  return undefined
}
```

- [ ] **Step 7: Run the test and watch it pass**

Run: `cd Paperino/literature-mcp && bun test test/ids.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 8: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/literature-mcp/package.json Paperino/literature-mcp/tsconfig.json \
        Paperino/literature-mcp/bun.lock Paperino/literature-mcp/src/ids.ts \
        Paperino/literature-mcp/test/ids.test.ts
git commit -m "feat(literature): parse exact DOI/arXiv/PMID ids, refuse fuzzy input"
```

---

### Task 2: BibTeX text primitives and the machine-owned file writer

**Files:**
- Create: `Paperino/literature-mcp/src/bib.ts`
- Test: `Paperino/literature-mcp/test/bib.test.ts`

**Interfaces:**
- Consumes: `PaperId` from `./ids` (Task 1).
- Produces, all imported by Tasks 3 and 4:
  - `export const BIB_FILE = "references.bib"`
  - `export const BIB_HEADER: string`
  - `export type BibEntry = { key: string; title?: string; doi?: string; arxiv?: string; pmid?: string }`
  - `export function field(bibtex: string, name: string): string`
  - `export function withKey(bibtex: string, key: string): string`
  - `export function scanBib(text: string): BibEntry[]`
  - `export function citeKey(input: { author: string; year: string; title: string }, taken: Set<string>): string`
  - `export function findExisting(entries: BibEntry[], id: PaperId, resolvedDoi?: string): string | undefined`
  - `export function appendEntry(workspace: string, entry: string): string`

- [ ] **Step 1: Write the failing test**

`Paperino/literature-mcp/test/bib.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd Paperino/literature-mcp && bun test test/bib.test.ts`
Expected: FAIL — `Cannot find module '../src/bib'`.

- [ ] **Step 3: Implement `bib.ts`**

`Paperino/literature-mcp/src/bib.ts`:

```ts
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { PaperId } from "./ids"

export const BIB_FILE = "references.bib"
export const BIB_HEADER =
  "% MACHINE-OWNED (literature-mcp). Do not hand-edit — entries are resolved from DOI/arXiv/PMID.\n"

export type BibEntry = { key: string; title?: string; doi?: string; arxiv?: string; pmid?: string }

const clean = (s: string) => s.replace(/\s+/g, " ").trim()

const STOPWORDS = new Set([
  "a", "an", "the", "on", "of", "for", "with", "and", "or", "to", "in", "is", "are", "from", "by",
  "at", "as", "via", "using", "towards", "toward", "into",
])

/** Accents stripped, non-alphanumerics dropped: a BibTeX key must be ASCII. Müller -> muller. */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase()

/**
 * Pull one field out of a BibTeX entry, honoring NESTED braces: publishers brace acronyms
 * ({KV}, {BERT}) to stop BibTeX lowercasing them, and a naive match to the first `}` would
 * truncate the title at the acronym.
 */
export function field(bibtex: string, name: string): string {
  const braced = bibtex.match(new RegExp(`\\b${name}\\s*=\\s*\\{`, "i"))
  if (!braced || braced.index === undefined) {
    const quoted = bibtex.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"))
    return quoted ? clean(quoted[1]!) : ""
  }
  let depth = 1
  let out = ""
  for (let i = braced.index + braced[0].length; i < bibtex.length; i++) {
    const c = bibtex[i]!
    if (c === "{") depth++
    else if (c === "}" && --depth === 0) break
    out += c
  }
  return clean(out)
}

/** Swap the publisher's key for ours. */
export function withKey(bibtex: string, key: string): string {
  return bibtex.replace(/^(\s*@\w+\s*\{)[^,]*/, `$1${key}`)
}

/**
 * A tolerant SCAN, deliberately not a parse. Its only job is dedupe and listing; if it misses a
 * malformed entry the worst outcome is a duplicate append, never a corrupted file.
 */
export function scanBib(text: string): BibEntry[] {
  const out: BibEntry[] = []
  for (const m of text.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,[\s\S]*?\n\s*\}/g)) {
    const entry = m[0]
    out.push({
      key: m[1]!,
      title: field(entry, "title") || undefined,
      doi: field(entry, "doi").toLowerCase() || undefined,
      arxiv: field(entry, "eprint") || undefined,
      pmid: field(entry, "pmid") || undefined,
    })
  }
  return out
}

/**
 * Better BibTeX's convention: <family><year><first significant title word> -> khan2026sensitivity.
 * A collision with a DIFFERENT work gets a b/c/d suffix; it is never silently reused, because two
 * works sharing a key makes one of them uncitable.
 */
export function citeKey(input: { author: string; year: string; title: string }, taken: Set<string>): string {
  const first = input.author.split(/\s+and\s+/)[0]!.trim()
  // "Khan, Azam" -> Khan ; "Azam Khan" -> Khan
  const family = fold(first.includes(",") ? first.split(",")[0]! : (first.split(/\s+/).at(-1) ?? "")) || "anon"
  const year = input.year.replace(/\D/g, "") || "0000"
  const word =
    input.title
      .split(/\s+/)
      .map(fold)
      .find((w) => w.length > 2 && !STOPWORDS.has(w)) ?? "untitled"

  const base = `${family}${year}${word}`
  if (!taken.has(base)) return base
  for (let i = 1; i < 25; i++) {
    const candidate = `${base}${String.fromCharCode(97 + i)}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error(`too many cite-key collisions on ${base}`)
}

/**
 * The dedupe check. It matches on the RESOLVED DOI first, not on the id the caller passed, so
 * citing one paper by its arXiv id today and its published DOI tomorrow is idempotent.
 */
export function findExisting(entries: BibEntry[], id: PaperId, resolvedDoi?: string): string | undefined {
  const doi = resolvedDoi?.toLowerCase()
  const bare = (v: string) => v.replace(/v\d+$/i, "").toLowerCase()
  return entries.find((e) => {
    if (doi && e.doi === doi) return true
    if (id.scheme === "doi" && e.doi === id.value.toLowerCase()) return true
    if (id.scheme === "arxiv" && e.arxiv && bare(e.arxiv) === bare(id.value)) return true
    if (id.scheme === "pmid" && e.pmid === id.value) return true
    return false
  })?.key
}

/**
 * Append atomically — the whole new text goes to a temp file which is then renamed over the
 * original, so a crash mid-write cannot leave half an entry behind. Existing bytes are copied
 * verbatim: this server owns the file, but it does not reformat it.
 */
export function appendEntry(workspace: string, entry: string): string {
  const path = join(workspace, BIB_FILE)
  const existing = existsSync(path) ? readFileSync(path, "utf8") : BIB_HEADER
  const gap = existing.endsWith("\n") ? "" : "\n"
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${existing}${gap}\n${entry.trim()}\n`)
  renameSync(tmp, path)
  return path
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd Paperino/literature-mcp && bun test test/bib.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/literature-mcp/src/bib.ts Paperino/literature-mcp/test/bib.test.ts
git commit -m "feat(literature): machine-owned references.bib — atomic append, DOI dedupe, BBT cite keys"
```

---

### Task 3: Resolve an identifier to authoritative BibTeX

**Files:**
- Create: `Paperino/literature-mcp/src/resolve.ts`
- Test: `Paperino/literature-mcp/test/resolve.test.ts`

**Interfaces:**
- Consumes: `PaperId` from `./ids` (Task 1); `field` from `./bib` (Task 2).
- Produces, imported by Task 4:
  - `export type Resolved = { bibtex: string; doi?: string; upgradedFrom?: string; fields: { author: string; year: string; title: string } }`
  - `export function resolveId(id: PaperId): Promise<Resolved>` — rejects on failure; never returns a partial entry.

- [ ] **Step 1: Write the failing test**

These hit the live network, like the Tectonic compile tests in `packages/desktop/src/main/paperino/core.test.ts`. Timeouts are generous on purpose.

`Paperino/literature-mcp/test/resolve.test.ts`:

```ts
import { expect, test } from "bun:test"
import { resolveId } from "../src/resolve"

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
// it should appear in a bibliography.
test(
  "an unpublished arXiv preprint becomes @misc with its eprint",
  async () => {
    const r = await resolveId({ scheme: "arxiv", value: "2305.13245" })
    expect(r.bibtex).toStartWith("@misc{")
    expect(r.bibtex).toContain("eprint = {2305.13245}")
    expect(r.bibtex).toContain("archivePrefix = {arXiv}")
    expect(r.fields.title.length).toBeGreaterThan(0)
    expect(r.doi).toBeUndefined()
  },
  NET,
)

// The upgrade rule: once a preprint is published, citing the preprint misrepresents the work.
// arXiv records the DOI when that happens, so we follow it. 10.1038/s41586-021-03819-2 (AlphaFold)
// has arXiv id 2107.06192 — if this ever stops upgrading, the arXiv record LOST its DOI, which is
// a real regression worth investigating, not a test to relax.
test(
  "an arXiv record carrying a DOI upgrades to the published version",
  async () => {
    const r = await resolveId({ scheme: "arxiv", value: "1911.03588" })
    if (r.upgradedFrom) {
      expect(r.upgradedFrom).toBe("arXiv:1911.03588")
      expect(r.doi).toBeDefined()
      expect(r.bibtex).not.toStartWith("@misc{")
    } else {
      // Not yet published: it must still be a well-formed preprint entry, never a half-record.
      expect(r.bibtex).toStartWith("@misc{")
    }
  },
  NET,
)

test(
  "a PMID resolves, upgrading to its DOI when it has one",
  async () => {
    const r = await resolveId({ scheme: "pmid", value: "34265844" })
    expect(r.fields.title.length).toBeGreaterThan(0)
    if (r.doi) expect(r.upgradedFrom).toBe("PMID:34265844")
  },
  NET,
)

// The load-bearing failure. A resolver that invents an entry out of thin metadata is the exact
// thing product rule 2 exists to prevent: a bad id must throw so `cite` writes nothing.
test(
  "an unresolvable id rejects",
  async () => {
    await expect(resolveId({ scheme: "doi", value: "10.9999/definitely-not-a-real-doi-xyz" })).rejects.toThrow()
  },
  NET,
)
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd Paperino/literature-mcp && bun test test/resolve.test.ts`
Expected: FAIL — `Cannot find module '../src/resolve'`.

- [ ] **Step 3: Implement `resolve.ts`**

`Paperino/literature-mcp/src/resolve.ts`:

```ts
import { field } from "./bib"
import type { PaperId } from "./ids"

export type Resolved = {
  /** A complete BibTeX entry. Its key is the source's; bib.ts swaps in ours. */
  bibtex: string
  doi?: string
  /** Set when an arXiv/PMID record turned out to have a published DOI and we followed it. */
  upgradedFrom?: string
  fields: { author: string; year: string; title: string }
}

const UA = "Paperino/0.1 (research paper assistant; +https://github.com/azamkhan555622848/Paperino)"
const TIMEOUT_MS = 20_000

async function get(url: string, accept: string): Promise<string> {
  const res = await fetch(url, {
    headers: { Accept: accept, "User-Agent": UA },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`)
  return res.text()
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim()

const fieldsOf = (bibtex: string) => ({
  author: field(bibtex, "author"),
  year: field(bibtex, "year"),
  title: field(bibtex, "title"),
})

/**
 * doi.org content negotiation: the registrant's own BibTeX, straight from the agency that minted
 * the DOI. Authoritative by construction — there is nothing to second-guess and nothing to invent.
 */
async function fromDoi(doi: string): Promise<Resolved> {
  const bibtex = (await get(`https://doi.org/${encodeURI(doi)}`, "application/x-bibtex")).trim()
  if (!bibtex.startsWith("@")) throw new Error(`doi.org returned no BibTeX for ${doi}`)
  return { bibtex, doi: doi.toLowerCase(), fields: fieldsOf(bibtex) }
}

/**
 * arXiv's Atom API. If the record carries a DOI the preprint has since been PUBLISHED, and citing
 * the preprint would misrepresent the work — so we resolve that DOI instead and say so.
 */
async function fromArxiv(id: string): Promise<Resolved> {
  const xml = await get(
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`,
    "application/atom+xml",
  )
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1]
  if (!entry) throw new Error(`arXiv has no record for ${id}`)

  const doi = entry.match(/<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/)?.[1]?.trim()
  if (doi) return { ...(await fromDoi(doi)), upgradedFrom: `arXiv:${id}` }

  const title = clean(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "")
  const author = [...entry.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => clean(m[1]!)).join(" and ")
  const year = entry.match(/<published>(\d{4})/)?.[1] ?? "0000"
  const primary = entry.match(/<arxiv:primary_category[^>]*term="([^"]+)"/)?.[1] ?? ""
  if (!title) throw new Error(`arXiv record for ${id} has no title`)

  const bibtex = [
    "@misc{KEY,",
    `  title = {${title}},`,
    `  author = {${author}},`,
    `  year = {${year}},`,
    `  eprint = {${id.replace(/v\d+$/i, "")}},`,
    "  archivePrefix = {arXiv},",
    ...(primary ? [`  primaryClass = {${primary}},`] : []),
    "}",
  ].join("\n")
  return { bibtex, fields: { author, year, title } }
}

/** NCBI E-utilities. Same upgrade rule: a PubMed record with a DOI is cited by its DOI. */
async function fromPmid(pmid: string): Promise<Resolved> {
  const xml = await get(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml`,
    "application/xml",
  )
  if (!xml.includes("<PubmedArticle>")) throw new Error(`PubMed has no record for PMID:${pmid}`)

  const doi = xml.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/)?.[1]?.trim()
  if (doi) return { ...(await fromDoi(doi)), upgradedFrom: `PMID:${pmid}` }

  const title = clean(xml.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/)?.[1] ?? "")
  const year = xml.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/)?.[1] ?? "0000"
  const journal = clean(xml.match(/<Journal>[\s\S]*?<Title>([\s\S]*?)<\/Title>/)?.[1] ?? "")
  const author = [...xml.matchAll(/<LastName>([^<]+)<\/LastName>\s*<ForeName>([^<]+)<\/ForeName>/g)]
    .map((m) => `${clean(m[1]!)}, ${clean(m[2]!)}`)
    .join(" and ")
  if (!title) throw new Error(`PubMed record for PMID:${pmid} has no title`)

  const bibtex = [
    "@article{KEY,",
    `  title = {${title}},`,
    `  author = {${author}},`,
    `  journal = {${journal}},`,
    `  year = {${year}},`,
    `  pmid = {${pmid}},`,
    "}",
  ].join("\n")
  return { bibtex, fields: { author, year, title } }
}

/**
 * Resolve an identifier, or REJECT. There is deliberately no fallback that assembles an entry out
 * of search metadata: a citation exists because a registry says so, or it does not exist.
 */
export function resolveId(id: PaperId): Promise<Resolved> {
  if (id.scheme === "doi") return fromDoi(id.value)
  if (id.scheme === "arxiv") return fromArxiv(id.value)
  return fromPmid(id.value)
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd Paperino/literature-mcp && bun test test/resolve.test.ts`
Expected: PASS — 5 tests. (Needs network. If arXiv or NCBI rate-limits, wait a minute and rerun; do **not** add retries to `src/` to make a flaky test green.)

- [ ] **Step 5: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/literature-mcp/src/resolve.ts Paperino/literature-mcp/test/resolve.test.ts
git commit -m "feat(literature): resolve DOI/arXiv/PMID to authoritative BibTeX, upgrading published preprints"
```

---

### Task 4: The MCP server, its bundle, and the bundle's smoke test

**Files:**
- Create: `Paperino/literature-mcp/src/server.ts`
- Create: `Paperino/literature-mcp/scripts/build-dist.ts`
- Test: `Paperino/literature-mcp/test/dist.test.ts`

**Interfaces:**
- Consumes: `parseId` (Task 1); `BIB_FILE, appendEntry, citeKey, findExisting, scanBib, withKey` (Task 2); `resolveId` (Task 3).
- Produces: an MCP server exposing `cite(workspace, id)` and `bib_list(workspace)`, and `dist/server.mjs` — the node-target bundle Task 5 registers and stages.

- [ ] **Step 1: Implement the server**

`Paperino/literature-mcp/src/server.ts`:

```ts
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { BIB_FILE, appendEntry, citeKey, findExisting, scanBib, withKey } from "./bib"
import { parseId } from "./ids"
import { resolveId } from "./resolve"

const server = new McpServer({ name: "literature-mcp", version: "0.1.0" })
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] })
const ws = z.string().describe("Absolute path to the paper workspace (the project root)")

const readBib = (workspace: string) => {
  const path = join(workspace, BIB_FILE)
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}

server.registerTool(
  "cite",
  {
    description:
      "Resolve a DOI, arXiv id or PMID into references.bib and return its cite key. This is the ONLY way an entry enters that file: you cannot write references.bib yourself, and no tool accepts BibTeX text. Find the paper with the paperclip tools first, then pass the identifier they give you. Idempotent — citing the same work twice returns the key it already has.",
    inputSchema: {
      workspace: ws,
      id: z
        .string()
        .describe("An exact DOI (10.…/…), arXiv id (2305.13245) or PMID (PMID:34265844). Never a title."),
    },
  },
  async (a) => {
    const id = parseId(a.id)
    if (!id)
      return text(
        `"${a.id}" is not a DOI, arXiv id or PMID. Search with the paperclip tools and cite the identifier they return. Nothing was written.`,
      )

    let resolved
    try {
      resolved = await resolveId(id)
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      return text(`Could not resolve ${a.id} — citation NOT added. ${why}`)
    }

    const entries = scanBib(readBib(a.workspace))
    const existing = findExisting(entries, id, resolved.doi)
    if (existing) return text(`already-present: \\cite{${existing}} — references.bib was not changed.`)

    const key = citeKey(resolved.fields, new Set(entries.map((e) => e.key)))
    appendEntry(a.workspace, withKey(resolved.bibtex, key))
    const upgrade = resolved.upgradedFrom
      ? ` (${resolved.upgradedFrom} has since been published — cited by its DOI, ${resolved.doi})`
      : ""
    return text(`added: \\cite{${key}}${upgrade}`)
  },
)

server.registerTool(
  "bib_list",
  {
    description: "List what is already citable in references.bib: cite keys with their titles and identifiers.",
    inputSchema: { workspace: ws },
  },
  async (a) => {
    const entries = scanBib(readBib(a.workspace))
    if (!entries.length) return text("references.bib is empty — nothing is citable yet.")
    return text(
      entries
        .map((e) => `\\cite{${e.key}} — ${e.title ?? "(no title)"}${e.doi ? ` [doi:${e.doi}]` : ""}`)
        .join("\n"),
    )
  },
)

await server.connect(new StdioServerTransport())
```

- [ ] **Step 2: Implement the bundle script**

`Paperino/literature-mcp/scripts/build-dist.ts`:

```ts
#!/usr/bin/env bun
// The packaged form: a node-target bundle run under ELECTRON_RUN_AS_NODE on the app's own
// electron.exe, so an installed Paperino needs neither bun nor node.
//
// Unlike figures-mcp there is nothing to vendor alongside it — no worker process, no browser, no
// assets. literature-mcp is fetch plus fs.
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const dist = join(root, "dist")

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

const result = await Bun.build({
  entrypoints: [join(root, "src", "server.ts")],
  outdir: dist,
  target: "node",
  format: "esm",
  naming: "server.mjs",
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
console.log("dist ready:", dist)
```

- [ ] **Step 3: Write the bundle's failing test**

`Paperino/literature-mcp/test/dist.test.ts`:

```ts
import { beforeAll, expect, test } from "bun:test"
import { execFileSync, execSync, spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// The packaged app has no bun and no node — literature-mcp runs as a node-target bundle under
// ELECTRON_RUN_AS_NODE. This suite proves the bundle is self-contained and actually speaks MCP on a
// plain node runtime, which is the part that cannot be checked from source.
const ROOT = join(import.meta.dir, "..")
const DIST = join(ROOT, "dist")

beforeAll(() => {
  execFileSync("bun", [join(ROOT, "scripts", "build-dist.ts")], { stdio: "inherit" })
})

test("dist layout is complete", () => {
  expect(existsSync(join(DIST, "server.mjs"))).toBe(true)
})

test("dist bakes in no path from the machine that built it", () => {
  // figures-mcp once shipped C:\Users\<me>\...\jq.exe as a default, which exists on exactly one
  // machine. The bundle stores such a path as JS SOURCE, so its separators are escaped: grepping
  // for homedir() ("C:\Users\me") misses "C:\\Users\\me" and the test passes over a real bug.
  // Unescape first, and check the forward-slash spelling too.
  const bundle = readFileSync(join(DIST, "server.mjs"), "utf8")
  const unescaped = bundle.split("\\\\").join("\\")
  const forward = (p: string) => p.split("\\").join("/")

  for (const machinePath of [homedir(), ROOT]) {
    expect(unescaped).not.toInclude(machinePath)
    expect(bundle).not.toInclude(forward(machinePath))
  }
})

test(
  "dist server answers MCP initialize under plain node",
  async () => {
    const nodeExe = execSync("where node", { encoding: "utf8" }).split(/\r?\n/)[0]!.trim()
    const child = spawn(nodeExe, [join(DIST, "server.mjs")], { stdio: ["pipe", "pipe", "pipe"] })
    const request =
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "dist-smoke", version: "0" },
        },
      }) + "\n"
    let errbuf = ""
    const reply = await new Promise<string>((resolve, reject) => {
      let buffer = ""
      const timer = setTimeout(() => reject(new Error(`no reply; stderr: ${errbuf}`)), 20_000)
      child.stderr.on("data", (d) => (errbuf += d))
      child.stdout.on("data", (d) => {
        buffer += d
        if (buffer.includes('"result"')) {
          clearTimeout(timer)
          resolve(buffer)
        }
      })
      child.stdin.write(request)
    }).finally(() => child.kill())
    expect(reply).toContain('"serverInfo"')
  },
  60_000,
)
```

- [ ] **Step 4: Run the whole suite**

Run: `cd Paperino/literature-mcp && bun test`
Expected: PASS — ids 4, bib 10, resolve 5, dist 3.

- [ ] **Step 5: Typecheck**

Run: `cd Paperino/literature-mcp && bunx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/literature-mcp/src/server.ts Paperino/literature-mcp/scripts/build-dist.ts \
        Paperino/literature-mcp/test/dist.test.ts
git commit -m "feat(literature): MCP server with cite + bib_list, and its node-target bundle"
```

---

### Task 5: Register both servers, deny the agent write access to references.bib, and stage the bundle

This is the task that turns rule 2 from a prompt into a wall. Paperclip is registered here too — it needs no build, only a URL.

**Files:**
- Modify: `Paperino/opencode-dev/paperino-config/opencode.jsonc` (add to `"mcp"`; extend `"permission"`)
- Modify: `Paperino/opencode-dev/paperino-config/opencode.packaged.jsonc` (same, with tokens)
- Modify: `Paperino/opencode-dev/packages/desktop/scripts/stage-paperino.ts` (after the figures-mcp block, ~line 39)
- Test: `Paperino/opencode-dev/packages/desktop/src/main/paperino/packaged.test.ts` (append)

**Interfaces:**
- Consumes: `dist/server.mjs` from Task 4; `renderTemplate` (packaged.ts:10) and `packagedTokens` (packaged.ts:22), both already exported.
- Produces: a rendered packaged config containing `mcp.literature`, `mcp.paperclip` and `permission.edit["references.bib"]`.

- [ ] **Step 1: Write the failing test**

Append to `Paperino/opencode-dev/packages/desktop/src/main/paperino/packaged.test.ts`. Ensure these imports exist at the top of the file (merge into the existing import lines — do not duplicate):

```ts
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { packagedTokens, renderTemplate } from "./packaged"
```

Then append:

```ts
describe("the packaged config registers the citation stack", () => {
  const rendered = () => {
    // packaged.test.ts lives at packages/desktop/src/main/paperino/
    const template = readFileSync(
      join(import.meta.dir, "..", "..", "..", "..", "..", "paperino-config", "opencode.packaged.jsonc"),
      "utf8",
    )
    return renderTemplate(
      template,
      packagedTokens({
        resources: "C:/app/resources/paperino",
        userData: "C:/ud",
        electronExe: "C:/app/Paperino.exe",
      }),
    )
  }

  test("literature-mcp runs on the app's own executable", () => {
    const config = rendered()
    expect(config).toContain("C:/app/resources/paperino/literature-mcp/server.mjs")
    expect(config).toContain('"ELECTRON_RUN_AS_NODE": "1"')
  })

  // Paperclip authenticates by MCP OAuth (dynamic client registration + PKCE). An X-API-Key here
  // would bake a secret into the installer — and ship one user's key to everyone who downloads it.
  test("paperclip is a bare URL with no credential in it", () => {
    const config = rendered()
    expect(config).toContain('"url": "https://paperclip.gxl.ai/mcp"')
    expect(config).not.toContain("X-API-Key")
    expect(config).not.toContain("gxl_")
  })

  // The keystone of product rule 2. Without this the agent can hand-write references.bib — or paste
  // in the BibTeX that paperclip's own `export` tool hands it — and "machine-owned" means nothing.
  // findLast semantics: the allow must come FIRST, or the deny is shadowed and silently useless.
  test("the agent is denied write access to references.bib", () => {
    const config = rendered()
    const edit = config.indexOf('"edit"')
    expect(edit).toBeGreaterThan(-1)
    const allow = config.indexOf('"*": "allow"', edit)
    const deny = config.indexOf('"references.bib": "deny"', edit)
    expect(allow).toBeGreaterThan(-1)
    expect(deny).toBeGreaterThan(allow)
  })

  test("no token survives rendering", () => {
    expect(rendered()).not.toContain("{{")
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd Paperino/opencode-dev && bun test packages/desktop/src/main/paperino/packaged.test.ts`
Expected: FAIL — the rendered config contains no `literature-mcp`, no `paperclip`, no `"edit"` block.

- [ ] **Step 3: Register both servers in the packaged template**

In `Paperino/opencode-dev/paperino-config/opencode.packaged.jsonc`, inside `"mcp"`, after the `"paperbanana"` entry (add a comma after its closing brace):

```jsonc
    // Literature: resolves a DOI/arXiv/PMID into references.bib. Same runtime trick as figures — a
    // node-target bundle on the app's own executable. Calls are seconds, so the default timeout is
    // fine (unlike paperbanana, which needs 10 minutes).
    "literature": {
      "type": "local",
      "command": ["{{ELECTRON}}", "{{RESOURCES}}/literature-mcp/server.mjs"],
      "enabled": true,
      "environment": {
        "ELECTRON_RUN_AS_NODE": "1"
      }
    },
    // Paperclip: literature discovery and full-text reading, as a hosted remote MCP.
    //
    // No credential appears here, and none should. Its endpoint answers an unauthenticated
    // initialize with a WWW-Authenticate challenge and serves both OAuth discovery documents,
    // advertising dynamic client registration and PKCE — the MCP OAuth 2.1 flow, which opencode
    // implements client-side. The user clicks Connect once and the sidecar holds the tokens. The
    // X-API-Key header in Paperclip's docs is for their Python SDK; using it here would bake one
    // machine's secret into an installer that ships to everybody.
    "paperclip": {
      "type": "remote",
      "url": "https://paperclip.gxl.ai/mcp",
      "enabled": true
    }
```

- [ ] **Step 4: Add the permission block to the packaged template**

Still in `opencode.packaged.jsonc`: after the closing `}` of `"mcp"`, add a comma and this block (before the trailing comment):

```jsonc
  ,
  // Product rule 2, made structural. references.bib is machine-owned: only literature-mcp's `cite`
  // writes it, and `cite` accepts an identifier — never BibTeX text. Without this deny the rule is
  // just a sentence in AGENTS.md, and an agent that can hand-write an entry can hand-write an
  // invented one. It matters more now that paperclip's `export` tool hands the agent real BibTeX as
  // a string: pasting it is one edit away.
  //
  // Permission.evaluate uses findLast, so LATER keys win — the allow-all must come first.
  // edit/write/apply_patch all fold into the "edit" permission (permission/index.ts:205), and the
  // pattern matched is the path relative to the worktree (tool/edit.ts:104).
  "permission": {
    "edit": {
      "*": "allow",
      "references.bib": "deny"
    },
    // A shell redirect would go around the edit tool entirely. `ask`, not `deny`: reading the file
    // is legitimate, and a prompt makes an attempted write visible instead of silently failing.
    "bash": {
      "*": "allow",
      "*references.bib*": "ask"
    }
  }
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd Paperino/opencode-dev && bun test packages/desktop/src/main/paperino/packaged.test.ts`
Expected: PASS, including the four new tests.

- [ ] **Step 6: Mirror it all into the dev config**

In `Paperino/opencode-dev/paperino-config/opencode.jsonc`, inside `"mcp"`, after the `"paperbanana"` entry:

```jsonc
    // Literature: DOI/arXiv/PMID -> references.bib. The ONLY writer of that file.
    "literature": {
      "type": "local",
      "command": ["bun", "C:/Users/azamk/Documents/Paperino/literature-mcp/src/server.ts"],
      "enabled": true
    },
    // Paperclip: hosted literature index. OAuth (dynamic client registration + PKCE) — no key here.
    "paperclip": {
      "type": "remote",
      "url": "https://paperclip.gxl.ai/mcp",
      "enabled": true
    },
```

Then extend the existing `"permission"` block (which today holds only `"skill"`) with the **same** `"edit"` and `"bash"` rules written in Step 4. Dev and packaged must not drift — the wall has to exist in both, or it gets developed against a config that does not have it.

- [ ] **Step 7: Stage the bundle into the installer**

In `Paperino/opencode-dev/packages/desktop/scripts/stage-paperino.ts`, immediately after the figures-mcp block (which ends `cpSync(join(paperino, "figures-mcp", "dist"), join(out, "figures-mcp"), { recursive: true })`):

```ts
// 3b. literature-mcp, same node-target trick. Paperclip needs no staging at all — it is a URL.
await $`bun ${join(paperino, "literature-mcp", "scripts", "build-dist.ts")}`.cwd(join(paperino, "literature-mcp"))
cpSync(join(paperino, "literature-mcp", "dist"), join(out, "literature-mcp"), { recursive: true })
```

- [ ] **Step 8: Prove the staging works**

Run: `cd Paperino/opencode-dev/packages/desktop && OPENCODE_CHANNEL=prod bun run prebuild`
Expected: ends with `staged: …\resources-paperino`.

Then check the bundle landed. **Do not `cd` into `resources-paperino`** — on Windows a shell's working directory locks the folder, and the next `prebuild` dies with `EBUSY` on its `rmSync`:

Run: `ls Paperino/opencode-dev/packages/desktop/resources-paperino/literature-mcp/`
Expected: `server.mjs`.

- [ ] **Step 9: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/opencode-dev/paperino-config/opencode.jsonc \
        Paperino/opencode-dev/paperino-config/opencode.packaged.jsonc \
        Paperino/opencode-dev/packages/desktop/scripts/stage-paperino.ts \
        Paperino/opencode-dev/packages/desktop/src/main/paperino/packaged.test.ts
git commit -m "feat(literature): register literature + paperclip, and deny the agent write access to references.bib"
```

---

### Task 6: Teach the shipped agent the citation workflow

`paperino-config/AGENTS.md` **is** the shipped agent's system prompt. Editing it changes what the end user's agent does; it has no effect on the agent implementing this plan.

**Files:**
- Modify: `Paperino/opencode-dev/paperino-config/AGENTS.md` (line 16; lines 217-219; a new section before `## Non-negotiable rules`)

**Interfaces:**
- Consumes: the tool names `cite` and `bib_list` (Task 4), and paperclip's (`search`, `lookup`, `grep`, `cat`).
- Produces: nothing code-facing.

- [ ] **Step 1: Replace rule 2**

Replace lines 217-219, currently:

```markdown
2. **Never fabricate citations.** Until the literature tools are installed, mark
   citation spots with `% TODO-CITE <what should be cited>` comments instead of
   inventing references. Never write entries into `references.bib` by hand.
```

with:

```markdown
2. **Never fabricate citations.** A citation you *remember* is not a citation. Find the paper
   (`paperclip`), then resolve it (`cite`). If you cannot find it, leave
   `% TODO-CITE <what should be cited>` and say so — do not fill the gap with a plausible
   reference. See "Citations": `references.bib` is not writable by you, and that is deliberate.
```

- [ ] **Step 2: Add the Citations section**

Insert immediately before `## Non-negotiable rules`:

```markdown
## Citations

`references.bib` is **machine-owned**. You cannot write it — an attempt to edit that path is
denied, and that denial is expected behavior, not a bug to work around. The only way an entry
gets in is `cite`, and `cite` takes an *identifier*, never BibTeX text.

The workflow:

1. **Find the paper with `paperclip`.** It holds full texts, not just abstracts — `search` and
   `lookup` to find work, `grep` and `cat` to read the actual method rather than guessing at it.
   Reading the paper you are about to cite is the point of having it.
2. **Take the DOI or arXiv id** from what paperclip returns.
3. **Call `cite(workspace, id)`.** It resolves the identifier against the registry that minted it,
   writes the entry, and returns the key. Use that key: `\cite{khan2026sensitivity}`.
4. **`bib_list`** tells you what is already citable, so you do not re-search for something you
   already have.

Rules that follow:

- **Never pass BibTeX to anything.** paperclip's `export` tool can hand you a BibTeX string. Do not
  paste it into `references.bib` — you cannot, and you should not want to. Pass the *identifier* to
  `cite` and let the resolver fetch the authoritative record.
- **Ambiguous candidates → ask the user.** If two papers plausibly match what they meant, show both
  and let them choose. Never pick silently; a confidently wrong citation is worse than a question.
- **`already-present` is success.** Reuse the key it returns.
- If paperclip is not connected, say so and ask the user to connect it (the first-run wizard, or
  Settings → MCP). Do not fall back to writing a reference from memory. There is no fallback.
```

- [ ] **Step 3: Update the workspace bullet (line 16)**

Replace:

```markdown
- `references.bib` — machine-owned; never hand-edit it (the literature tools own it)
```

with:

```markdown
- `references.bib` — machine-owned, and not writable by you: `cite` is the only thing that writes
  it (see "Citations")
```

- [ ] **Step 4: Confirm the config dir still loads**

Run: `cd Paperino/opencode-dev && bun packages/opencode/src/index.ts debug skill`
Expected: lists `docx`, `pdf`, `visual-design`, `xlsx` and built-ins. (This does not read AGENTS.md, but a broken config dir fails here first.)

- [ ] **Step 5: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/opencode-dev/paperino-config/AGENTS.md
git commit -m "docs(agent): citation workflow — paperclip finds, cite resolves, the bib is not yours to write"
```

---

### Task 7: A Connect Paperclip step in the first-run wizard

**Files:**
- Modify: `Paperino/opencode-dev/packages/app/src/components/paperino/onboarding-steps.ts`
- Modify: `Paperino/opencode-dev/packages/app/src/components/paperino/onboarding-wizard.tsx`
- Test: `Paperino/opencode-dev/packages/app/src/components/paperino/onboarding-steps.test.ts`

**Interfaces:**
- Consumes: `useServerSDK()` (already imported by the wizard). The SDK calls are exactly the ones `packages/app/src/context/server-sync.tsx:497-503` already makes: `sdk.mcp.status()` → `Record<string, { status: "connected" | "needs_auth" | "disabled" | "failed" | "needs_client_registration" }>`, `sdk.mcp.connect({ name })`, `sdk.mcp.auth.authenticate({ name })`.
- Produces: `WizardStep` gains `"paperclip"`, between `"chatgpt"` and `"figure-key"`.

- [ ] **Step 1: Write the failing test**

In `onboarding-steps.test.ts`, replace the `wizardSteps` and `nextStep` describes:

```ts
describe("wizardSteps", () => {
  test("a packaged install is offered the runtime downloads", () => {
    expect(wizardSteps(true)).toEqual(["welcome", "runtime", "chatgpt", "paperclip", "figure-key"])
  })

  test("a dev run is not — Chromium and Python already come from the repo", () => {
    expect(wizardSteps(false)).toEqual(["welcome", "chatgpt", "paperclip", "figure-key"])
  })
})

describe("nextStep", () => {
  test("walks the packaged order", () => {
    expect(nextStep("welcome", true)).toBe("runtime")
    expect(nextStep("runtime", true)).toBe("chatgpt")
    expect(nextStep("chatgpt", true)).toBe("paperclip")
    expect(nextStep("paperclip", true)).toBe("figure-key")
  })

  test("skips runtime in dev rather than dead-ending on it", () => {
    expect(nextStep("welcome", false)).toBe("chatgpt")
  })

  test("the last step ends the wizard", () => {
    expect(nextStep("figure-key", true)).toBeUndefined()
    expect(nextStep("figure-key", false)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd Paperino/opencode-dev && bun test packages/app/src/components/paperino/onboarding-steps.test.ts`
Expected: FAIL — `wizardSteps(true)` still returns the four-step order.

- [ ] **Step 3: Add the step to the order**

In `onboarding-steps.ts`:

```ts
export type WizardStep = "welcome" | "runtime" | "chatgpt" | "paperclip" | "figure-key"

/**
 * Runtime setup exists only in a packaged install: a dev run takes Chromium and Python from the
 * repo, so offering to download them there would be theatre.
 */
export function wizardSteps(packaged: boolean): WizardStep[] {
  return packaged
    ? ["welcome", "runtime", "chatgpt", "paperclip", "figure-key"]
    : ["welcome", "chatgpt", "paperclip", "figure-key"]
}
```

`nextStep` needs no change — it indexes into `wizardSteps`.

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd Paperino/opencode-dev && bun test packages/app/src/components/paperino/onboarding-steps.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the step component to the wizard**

In `onboarding-wizard.tsx`, add a `Match` inside the existing `<Switch>`, between the `chatgpt` and `figure-key` arms:

```tsx
          <Match when={step() === "paperclip"}>
            <PaperclipStep />
          </Match>
```

Then add the component after `ChatGPTStep`:

```tsx
/**
 * Connect Paperclip — the literature index the agent searches. Like the ChatGPT step, this does not
 * reimplement OAuth: Paperclip's MCP endpoint advertises dynamic client registration and PKCE, and
 * the sidecar already speaks that flow, so we drive exactly the calls the MCP settings UI makes
 * (server-sync.tsx:497-503). No API key is involved, and none should be — a key in the config would
 * ship one machine's secret inside everybody's installer.
 *
 * `needs_client_registration` is the first-run state, and registration happens on CONNECT — so that
 * status wants connect(), not authenticate().
 */
function PaperclipStep() {
  const serverSDK = useServerSDK()
  const [status, setStatus] = createSignal<string>("unknown")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()

  const refresh = async () => {
    const all = (await serverSDK.client.mcp.status().then((r) => r.data ?? {})) as Record<
      string,
      { status?: string }
    >
    setStatus(all["paperclip"]?.status ?? "unknown")
  }

  onMount(() => void refresh().catch(() => setStatus("unknown")))

  async function connect() {
    setBusy(true)
    setError(undefined)
    try {
      if (status() === "needs_auth") await serverSDK.client.mcp.auth.authenticate({ name: "paperclip" })
      else await serverSDK.client.mcp.connect({ name: "paperclip" })
      await refresh()
    } catch {
      setError("Could not reach Paperclip. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="flex flex-col gap-4">
      <div class="text-14-regular text-text-base">
        Connect Paperclip to search the literature — millions of full-text papers from PMC, arXiv,
        bioRxiv and OpenAlex, plus clinical trials and regulatory filings.
      </div>
      <div class="text-14-regular text-text-weak">
        It signs you in through your browser; there is no API key to paste. Papers you cite from it
        are written into <span class="text-text-base">references.bib</span> from the publisher's own
        record.
      </div>
      <Show
        when={status() !== "connected"}
        fallback={
          <div class="flex items-center gap-2 text-14-regular text-text-base">
            <Icon name="check" /> Paperclip is connected.
          </div>
        }
      >
        <div>
          <Button variant="secondary" disabled={busy()} onClick={() => void connect()}>
            <Show when={busy()} fallback="Connect Paperclip">
              <Spinner />
            </Show>
          </Button>
        </div>
      </Show>
      <Show when={error()}>
        <div class="text-14-regular text-text-danger">{error()}</div>
      </Show>
    </div>
  )
}
```

- [ ] **Step 6: Typecheck**

Run: `cd Paperino/opencode-dev && bun run typecheck`
Expected: clean. If `serverSDK.client.mcp` types differ from what is written above, match `server-sync.tsx:497-503` — that file is the working reference, not this plan.

- [ ] **Step 7: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/opencode-dev/packages/app/src/components/paperino/onboarding-steps.ts \
        Paperino/opencode-dev/packages/app/src/components/paperino/onboarding-steps.test.ts \
        Paperino/opencode-dev/packages/app/src/components/paperino/onboarding-wizard.tsx
git commit -m "feat(onboarding): connect Paperclip via MCP OAuth — no API key to paste"
```

---

### Task 8: Verify against the running packaged app

Every packaging bug this project has hit passed the test suite and failed in the app: the unmounted Preview panel, the Tectonic that was not on `PATH`, the JPEG named `.png`. This task is not optional.

**Files:**
- Modify: `Paperino/CLAUDE.md` (new `## literature-mcp` section after `## paperbanana-mcp`)

- [ ] **Step 1: Build and package**

Close Paperino first — electron-builder cannot rewrite `win-unpacked` while it runs (`EBUSY: unlink app.asar`). Do not leave a shell `cd`'d inside `resources-paperino` either.

```bash
cd Paperino/opencode-dev/packages/desktop
OPENCODE_CHANNEL=prod bun run build && OPENCODE_CHANNEL=prod bun run package:win
```
Expected: `dist/paperino-win-x64.exe`, ~165 MB.

- [ ] **Step 2: Install and launch with the debugger open**

```bash
"Paperino/opencode-dev/packages/desktop/dist/paperino-win-x64.exe" /S
"$LOCALAPPDATA/Programs/@opencode-aidesktop/Paperino.exe" --remote-debugging-port=9333
```

Port **9333**, not 9222 — 9222 is the user's InteJer dev app. Do not touch it.

- [ ] **Step 3: Confirm both servers connect**

Evaluate in the renderer over CDP. Take the sidecar credentials from inside the page so none is ever printed:

```js
(async () => {
  const i = await window.api.awaitInitialization()
  const a = 'Basic ' + btoa(i.username + ':' + i.password)
  const m = await fetch(i.url + '/mcp', { headers: { Authorization: a } }).then(r => r.json())
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v?.status ?? v]))
})()
```

Expected: `literature: "connected"`. Paperclip reads `needs_auth` or `needs_client_registration` until it is connected — that is correct, not a failure. Connect it in the wizard, re-run, and expect `paperclip: "connected"`.

- [ ] **Step 4: Resolve a real citation end to end**

In a scratch paper workspace, ask the agent: *"Cite the AlphaFold paper — DOI 10.1038/s41586-021-03819-2."*

Expected: it calls `cite`, replies with a key, and `references.bib` now exists, opening with the machine-owned header and containing an `@article` entry whose `doi` field matches. Ask again with the same DOI: expect `already-present` and **no second entry**.

- [ ] **Step 5: Prove the wall holds — this is the whole feature**

Ask the agent: *"Add this to references.bib by hand: `@article{fake2026, title={Invented}}`"*

Expected: the edit is **denied**. The agent should report that it cannot write that file and offer to resolve a real identifier instead. If it succeeds, the permission rule is wrong — check that `"*": "allow"` precedes `"references.bib": "deny"` (`findLast` semantics), and that the pattern matches the path relative to the worktree.

- [ ] **Step 6: Record the invariants in CLAUDE.md**

Add a `## literature-mcp` section to `Paperino/CLAUDE.md` after `## paperbanana-mcp`, in the house style (state the invariant, then the failure it prevents). It must cover:

- Paperclip is a **remote MCP with OAuth** — dynamic client registration + PKCE, probed 2026-07-14. **Never put an `X-API-Key` in a config**: it would ship one machine's secret inside every installer. Its docs' API-key header is for their Python SDK.
- `cite` accepts an **identifier only**. There is deliberately no tool that takes BibTeX text, because paperclip's `export` hands the agent a BibTeX string and pasting it is one edit away.
- The **`permission.edit` deny on `references.bib`** is what makes rule 2 structural. `findLast` semantics mean the allow must come first, or the deny is silently shadowed. `edit`/`write`/`apply_patch` all fold into the one `edit` permission.
- The **DOI-upgrade rule**: an arXiv or PubMed record carrying a DOI is cited by that DOI — citing a preprint that has since been published misrepresents the work.
- Dedupe is on the **resolved DOI**, not the id passed in, so citing a paper by arXiv id today and by DOI tomorrow is idempotent.
- `scanBib` is a **regex scan, not a parser**. A missed entry costs a duplicate append, never a corrupted file — `appendEntry` only ever appends, and never reformats existing bytes.

- [ ] **Step 7: Commit**

```bash
cd C:/Users/azamk/Documents
git add Paperino/CLAUDE.md
git commit -m "docs: record the literature-mcp invariants — OAuth not API keys, ids not BibTeX, the permission wall"
```

---

## Self-review

**Spec coverage.** Every section of `2026-07-14-literature-mcp-design.md` maps to a task: repository layout + ids → 1; the bib writer (keys, dedupe, atomic append, header) → 2; resolvers incl. the DOI-upgrade rule → 3; tool surface + bundle → 4; registration, the permission deny, staging → 5; AGENTS.md → 6; onboarding → 7; packaged verification, and the invariants recorded → 8. The spec's "no fallback search when Paperclip is unconnected" is enforced in Task 6's AGENTS.md text (*"There is no fallback"*).

**Type consistency.** `PaperId` (Task 1) is consumed unchanged by `findExisting` (Task 2) and `resolveId` (Task 3). `Resolved.fields` (Task 3) is exactly the first argument of `citeKey` (Task 2). `withKey` then `appendEntry` (Task 2) are called in that order by `server.ts` (Task 4). `dist/server.mjs` (Task 4) is the path registered and staged in Task 5.

**Known fragility, stated rather than hidden.** `scanBib` is a regex scan, not a BibTeX parser. If it misses a malformed entry the worst case is a duplicate append — never a corrupted file, because `appendEntry` only ever appends. That trade is deliberate: a parser that rewrote the file would violate "existing bytes are never reformatted."
