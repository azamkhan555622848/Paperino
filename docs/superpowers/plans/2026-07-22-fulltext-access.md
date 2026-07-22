# Full-text Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the agent a legal path to the full text of paywalled papers — an automatic ladder (shelf → Unpaywall → preprint → publisher TDM) that falls through to an in-app institutional fetch the user drives with their own library login.

**Architecture:** Two new tools (`fulltext`, `paper_list`) inside the existing `literature-mcp` server — no fourth MCP server. Four new modules (`shelf.ts`, `oa.ts`, `tdm.ts`, `fulltext.ts`) with network calls injected so the ladder is testable offline. PDFs land in a per-project `papers/` folder with a `.index.json` sidecar. The one rung an MCP cannot do — opening a login window — is handled by the Electron main process, signalled through a `.paperino/fetch-request.json` file the workspace watcher already sees.

**Tech Stack:** TypeScript, bun (dev/test), `@modelcontextprotocol/sdk` ^1.12.0, zod ^3.24.0, node-target bundle via `scripts/build-dist.ts`, Electron 42 (`BrowserWindow`, `session`), SolidJS for the settings surface.

**Spec:** `docs/superpowers/specs/2026-07-22-fulltext-access-design.md` — read it before Task 1.

## Global Constraints

- **No pirate sources.** Not as a fallback, not behind a flag. Every rung is free/open, a sanctioned API, or the user's own interactive login. If a task seems to need Sci-Hub/LibGen, the task is wrong — stop and ask.
- **No batch fetch.** The institutional rung is one paper per user confirmation. Never loop it over a list.
- **`references.bib` is untouched by everything in this plan.** Reading a paper and citing it are separate; `cite` remains the only writer.
- **No absolute path or key from the build machine may enter the bundle.** `test/dist.test.ts` greps for this — unescape `\\` before comparing (the jq lesson).
- **TDM ships dormant.** Every publisher client activates only when its key exists in `auth.json`. With no keys the rung is skipped silently; nothing in this plan blocks on publisher registration.
- **Version tags are exactly** `version-of-record | accepted-manuscript | preprint | unknown`. `unknown` is reachable only from a manual drop, never from `fulltext`.
- **Node-compatible APIs only** in `literature-mcp/src/` — global `fetch`, `node:fs`, `node:path`. Nothing bun-specific; the packaged app runs this bundle on `electron.exe` with `ELECTRON_RUN_AS_NODE=1`.
- **Commits must have Azam Khan as sole author.** Use `git -c trailer.ifexists=doNothing commit …`; never add a Co-Authored-By or "Generated with" trailer.
- **Stage explicit paths.** Never `git add -A` or `git commit -a` — the git root is a mega-repo full of unrelated projects.
- **Run `literature-mcp` tests from `Paperino/literature-mcp`**, and desktop tests from `Paperino/opencode-dev/packages/desktop`. `bun test` at the opencode-dev root hits a `do-not-run-tests-from-root` guard.

## File Structure

| File | Responsibility |
|---|---|
| `literature-mcp/src/shelf.ts` | **NEW.** The `papers/` folder and `.index.json`: lookup, atomic save, list. No network. |
| `literature-mcp/src/oa.ts` | **NEW.** Open-access rungs: Unpaywall lookup + version mapping, arXiv PDF URL, email resolution, PDF download. |
| `literature-mcp/src/tdm.ts` | **NEW.** Publisher matching from DOI prefix, `auth.json` key reading, the three TDM fetchers. |
| `literature-mcp/src/fulltext.ts` | **NEW.** The ladder. Orchestrates the above with injected dependencies; owns `fetch-request.json`. |
| `literature-mcp/src/server.ts` | **MODIFY.** Register `fulltext` and `paper_list` beside `cite`/`bib_list`. |
| `opencode-dev/packages/desktop/src/main/paperino/core.ts:153-176` | **MODIFY.** `classifyChange` ignores `papers/`. |
| `opencode-dev/packages/desktop/src/main/paperino/institutional.ts` | **NEW.** The login `BrowserWindow` and download capture. |
| `opencode-dev/packages/app/src/components/paperino/fulltext-keys.tsx` | **NEW.** TDM key entry surface. |
| `opencode-dev/paperino-config/AGENTS.md` | **MODIFY.** New "Reading papers" section; rule 1 gains a reading clause. |
| `Paperino/CLAUDE.md` | **MODIFY.** New `## Full-text access` section. |

---

### Task 1: The paper shelf

**Files:**
- Create: `literature-mcp/src/shelf.ts`
- Test: `literature-mcp/test/shelf.test.ts`

**Interfaces:**
- Consumes: `PaperId` from `./ids`.
- Produces: `SHELF_DIR`, `Version`, `AddedBy`, `ShelfEntry`, `identOf`, `slugFor`, `readIndex`, `findOnShelf`, `saveToShelf`, `listShelf`.

- [ ] **Step 1: Write the failing test**

Create `literature-mcp/test/shelf.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd C:/Users/azamk/Documents/Paperino/literature-mcp && bun test test/shelf.test.ts`
Expected: FAIL — `Cannot find module '../src/shelf'`.

- [ ] **Step 3: Implement `shelf.ts`**

Create `literature-mcp/src/shelf.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { PaperId } from "./ids"

export const SHELF_DIR = "papers"
const INDEX_FILE = ".index.json"

/** Where a paper came from. `manual-drop` is inferred, never written by us. */
export type AddedBy = "unpaywall" | "preprint" | "tdm" | "institutional" | "manual-drop"

/**
 * Which rendering of the work this file is. Load-bearing: an accepted manuscript can differ from
 * the published version in pagination and wording, so the agent must be able to say which it read.
 * `unknown` is reachable ONLY from a manual drop — the ladder always knows what it fetched.
 */
export type Version = "version-of-record" | "accepted-manuscript" | "preprint" | "unknown"

export type ShelfEntry = {
  file: string
  ident: string
  doi?: string
  version: Version
  addedBy: AddedBy
  title?: string
}

type IndexRow = Omit<ShelfEntry, "file">
type Index = Record<string, IndexRow>

/**
 * The canonical lookup key. A DOI is lowercased (registries are case-insensitive); an arXiv id is
 * namespaced and stripped of its version suffix, so v1 and v2 of a preprint are one paper.
 */
export function identOf(id: PaperId): string {
  if (id.scheme === "doi") return id.value.toLowerCase()
  if (id.scheme === "arxiv") return `arxiv:${id.value.replace(/v\d+$/i, "").toLowerCase()}`
  return `pmid:${id.value}`
}

/** A DOI contains `/` and `:`; a filename cannot. Kept readable rather than hashed. */
export function slugFor(ident: string): string {
  return ident.replace(/[\\/:*?"<>|]/g, "_")
}

const indexPath = (workspace: string) => join(workspace, SHELF_DIR, INDEX_FILE)

export function readIndex(workspace: string): Index {
  const path = indexPath(workspace)
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Index
  } catch {
    // A corrupt index costs a re-fetch, never a lost PDF — the files are the truth.
    return {}
  }
}

/** Atomic: temp file + rename, so a crash mid-write cannot leave half an index. */
function writeIndex(workspace: string, index: Index): void {
  const path = indexPath(workspace)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(index, null, 2)}\n`)
  renameSync(tmp, path)
}

export function findOnShelf(workspace: string, ident: string): ShelfEntry | undefined {
  const index = readIndex(workspace)
  const key = ident.toLowerCase()
  for (const [file, row] of Object.entries(index)) {
    if (row.ident.toLowerCase() !== key && row.doi?.toLowerCase() !== key) continue
    if (!existsSync(join(workspace, SHELF_DIR, file))) continue // indexed but deleted: re-fetch
    return { file, ...row }
  }
  return undefined
}

export function saveToShelf(
  workspace: string,
  bytes: Uint8Array,
  meta: { ident: string; doi?: string; version: Version; addedBy: AddedBy; title?: string },
): ShelfEntry {
  const dir = join(workspace, SHELF_DIR)
  mkdirSync(dir, { recursive: true })
  const file = `${slugFor(meta.ident)}.pdf`
  const tmp = join(dir, `${file}.tmp`)
  writeFileSync(tmp, bytes)
  renameSync(tmp, join(dir, file))

  const index = readIndex(workspace)
  index[file] = { ident: meta.ident, doi: meta.doi, version: meta.version, addedBy: meta.addedBy, title: meta.title }
  writeIndex(workspace, index)
  return { file, ...index[file]! }
}

/**
 * Everything readable on the shelf. A PDF with no index row is a file the USER put there, so it is
 * reported honestly as `manual-drop` / `unknown` rather than being ignored or guessed at.
 */
export function listShelf(workspace: string): ShelfEntry[] {
  const dir = join(workspace, SHELF_DIR)
  if (!existsSync(dir)) return []
  const index = readIndex(workspace)
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((file) => {
      const row = index[file]
      return row
        ? { file, ...row }
        : { file, ident: file, version: "unknown" as const, addedBy: "manual-drop" as const }
    })
}
```

- [ ] **Step 4: Run the tests — all six pass**

Run: `cd C:/Users/azamk/Documents/Paperino/literature-mcp && bun test test/shelf.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/azamk/Documents
git add Paperino/literature-mcp/src/shelf.ts Paperino/literature-mcp/test/shelf.test.ts
git -c trailer.ifexists=doNothing commit -m "feat(literature): the papers/ shelf and its index"
```

---

### Task 2: `classifyChange` ignores the shelf

**Files:**
- Modify: `opencode-dev/packages/desktop/src/main/paperino/core.ts:153-176`
- Test: `opencode-dev/packages/desktop/src/main/paperino/core.test.ts` (add to the existing `classifyChange` describe block)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing new — `classifyChange(filename, output?)` keeps its signature.

Why this is its own task: `SOURCE_RE` matches `.pdf` deliberately (Figure Studio emits figure PDFs). Without this rule, every paper the ladder fetches reads as a manuscript edit and retriggers the compile — the exact loop already documented for the emitted `main.pdf`.

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe("classifyChange", ...)` block in `core.test.ts`, after the "figure PDFs are still sources" test:

```ts
  // papers/ is the full-text shelf: PDFs the ladder fetches or the user drops. A .pdf is
  // otherwise a source (figures are PDFs), so without this rule every fetched paper would
  // look like a manuscript edit and retrigger the compile forever.
  test("fetched papers do not trigger a recompile", () => {
    expect(classifyChange("papers/10.1038_s41586-021-03819-2.pdf")).toBe(null)
    expect(classifyChange("papers\\someones-download.pdf")).toBe(null)
    expect(classifyChange("papers/.index.json")).toBe(null)
  })

  // The guard is anchored at the top level, so a figure that happens to live under a
  // directory named "papers" deeper in the tree is still a source.
  test("the shelf guard is anchored, not a substring match", () => {
    expect(classifyChange("figures/papers/method.pdf")).toBe("source")
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd C:/Users/azamk/Documents/Paperino/opencode-dev/packages/desktop && bun test src/main/paperino/core.test.ts -t classifyChange`
Expected: FAIL — `papers/10.1038_….pdf` returns `"source"`, expected `null`.

- [ ] **Step 3: Add the rule**

In `core.ts`, add the constant next to `SOURCE_RE` (around line 153):

```ts
// Files whose changes should trigger a recompile
const SOURCE_RE = /\.(tex|bib|yaml|png|jpe?g|pdf|svg)$/i
// The full-text shelf: papers the ladder fetched or the user dropped. Reading material, not source.
const SHELF_DIR = "papers"
```

Then in `classifyChange`, add the guard immediately after the `OUT_DIR` line (currently line 168):

```ts
export function classifyChange(filename: string, output: () => string = () => OUTPUT_PDF): ChangeKind {
  const name = filename.replaceAll("\\", "/").replace(/^\.\//, "")
  if (name === PREVIEW_PATH) return "preview"
  if (name.startsWith(`${OUT_DIR}/`) || name === OUT_DIR) return null
  // papers/ holds fetched full texts. They are PDFs, and a PDF is otherwise a source (Figure
  // Studio emits figures as PDFs) — so without this the shelf would retrigger the compile on
  // every fetch. Anchored at the top level: figures/papers/x.pdf is still a figure.
  if (name.startsWith(`${SHELF_DIR}/`)) return null
  if (!SOURCE_RE.test(name)) return null
  // The paper's own PDF is compile OUTPUT, not source. Every other .pdf still is a source —
  // Figure Studio emits figures as PDFs — so without this line the copy compile() drops
  // beside the manuscript would look like an edit and the compile would retrigger itself
  // forever. It follows the root's name, so a paper.tex workspace must ignore paper.pdf.
  if (/\.pdf$/i.test(name) && name === output()) return null
  return "source"
}
```

- [ ] **Step 4: Run the tests**

Run: `cd C:/Users/azamk/Documents/Paperino/opencode-dev/packages/desktop && bun test src/main/paperino/core.test.ts`
Expected: PASS — the whole `core.test.ts` suite green, including the two new tests.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/azamk/Documents
git add Paperino/opencode-dev/packages/desktop/src/main/paperino/core.ts Paperino/opencode-dev/packages/desktop/src/main/paperino/core.test.ts
git -c trailer.ifexists=doNothing commit -m "fix(preview): the papers/ shelf must not retrigger the compile"
```

---

### Task 3: The open-access rungs

**Files:**
- Create: `literature-mcp/src/oa.ts`
- Test: `literature-mcp/test/oa.test.ts`

**Interfaces:**
- Consumes: `Version` from `./shelf`.
- Produces: `OaHit` (`{ url: string; version: Version }`), `unpaywallEmail(workspace, env)`, `oaVersion(raw)`, `pickOaLocation(record)`, `unpaywallLookup(doi, email)`, `arxivPdfUrl(id)`, `downloadPdf(url)`.

- [ ] **Step 1: Write the failing test**

Create `literature-mcp/test/oa.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd C:/Users/azamk/Documents/Paperino/literature-mcp && bun test test/oa.test.ts`
Expected: FAIL — `Cannot find module '../src/oa'`.

- [ ] **Step 3: Implement `oa.ts`**

Create `literature-mcp/src/oa.ts`:

```ts
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Version } from "./shelf"

export type OaHit = { url: string; version: Version }

const UA = "Paperino/0.1 (research paper assistant; +https://github.com/azamkhan555622848/Paperino)"
const TIMEOUT_MS = 30_000

/**
 * Unpaywall wants an identifying email on every call. It is a politeness header, not a credential —
 * no signup, no key. Resolution: env, then the workspace's paperino.yaml, then a generic constant.
 * Never a personal address baked into the source: that is the jq-path failure, a value true on
 * exactly one machine shipped to every machine.
 */
export function unpaywallEmail(workspace: string, env: Record<string, string | undefined>): string {
  const fromEnv = env.PAPERINO_UNPAYWALL_EMAIL?.trim()
  if (fromEnv) return fromEnv

  const yaml = join(workspace, "paperino.yaml")
  if (existsSync(yaml)) {
    const found = readFileSync(yaml, "utf8").match(/^\s*unpaywall_email\s*:\s*(\S+)\s*$/m)?.[1]
    if (found) return found
  }
  return "paperino@users.noreply.github.com"
}

/**
 * Unpaywall's `version` vocabulary onto ours. Silence maps to accepted-manuscript, NOT to
 * version-of-record: the agent repeats this tag to the user as a claim about what it read, and an
 * unearned "version of record" is exactly the kind of confident wrongness rule 1 forbids.
 */
export function oaVersion(raw: string | undefined | null): Version {
  if (raw === "publishedVersion") return "version-of-record"
  if (raw === "submittedVersion") return "preprint"
  return "accepted-manuscript"
}

type UnpaywallRecord = {
  is_oa?: boolean
  best_oa_location?: { url_for_pdf?: string | null; url?: string | null; version?: string | null } | null
}

export function pickOaLocation(record: UnpaywallRecord): OaHit | undefined {
  if (!record.is_oa) return undefined
  const loc = record.best_oa_location
  if (!loc) return undefined
  const url = loc.url_for_pdf || loc.url
  if (!url) return undefined
  return { url, version: oaVersion(loc.version) }
}

/** Ask Unpaywall where the best LEGALLY FREE copy of a DOI lives. 404 means "not indexed", not an error. */
export async function unpaywallLookup(doi: string, email: string): Promise<OaHit | undefined> {
  const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (res.status === 404) return undefined
  if (!res.ok) throw new Error(`Unpaywall returned ${res.status} for ${doi}`)
  return pickOaLocation((await res.json()) as UnpaywallRecord)
}

/** arXiv serves the PDF at a stable path. The version suffix is dropped: we want the current one. */
export function arxivPdfUrl(id: string): string {
  return `https://arxiv.org/pdf/${id.replace(/v\d+$/i, "")}`
}

/**
 * Fetch bytes and insist they are a PDF. A repository that answers a PDF request with an HTML
 * interstitial ("click here to download") must NOT be saved as a paper — the agent would then
 * extract navigation chrome and treat it as the method section.
 */
export async function downloadPdf(url: string): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: { Accept: "application/pdf", "User-Agent": UA },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${new URL(url).host}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (!new TextDecoder().decode(bytes.slice(0, 5)).startsWith("%PDF"))
    throw new Error(`${new URL(url).host} returned ${bytes.length} bytes that are not a PDF`)
  return bytes
}
```

- [ ] **Step 4: Run the tests — all five pass**

Run: `cd C:/Users/azamk/Documents/Paperino/literature-mcp && bun test test/oa.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the live test**

Append to `literature-mcp/test/oa.test.ts`:

```ts
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
```

- [ ] **Step 6: Run the live test**

Run: `cd C:/Users/azamk/Documents/Paperino/literature-mcp && bun test test/oa.test.ts`
Expected: PASS, 6 tests. If the live one fails with `hit` undefined, Unpaywall lost that record — check `https://api.unpaywall.org/v2/10.1038/s41586-021-03819-2?email=…` in a browser before changing any code.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/azamk/Documents
git add Paperino/literature-mcp/src/oa.ts Paperino/literature-mcp/test/oa.test.ts
git -c trailer.ifexists=doNothing commit -m "feat(literature): Unpaywall and arXiv open-access rungs"
```

---

### Task 4: Publisher TDM clients

**Files:**
- Create: `literature-mcp/src/tdm.ts`
- Test: `literature-mcp/test/tdm.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Publisher` (`"springer" | "elsevier" | "wiley"`), `PUBLISHER_LABEL`, `publisherFor(doi)`, `AuthStore`, `readAuthStore(env)`, `tdmKey(publisher, env, auth)`, `tdmFetch(publisher, doi, key)`.

- [ ] **Step 1: Write the failing test**

Create `literature-mcp/test/tdm.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd C:/Users/azamk/Documents/Paperino/literature-mcp && bun test test/tdm.test.ts`
Expected: FAIL — `Cannot find module '../src/tdm'`.

- [ ] **Step 3: Implement `tdm.ts`**

Create `literature-mcp/src/tdm.ts`:

```ts
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type Publisher = "springer" | "elsevier" | "wiley"

export const PUBLISHER_LABEL: Record<Publisher, string> = {
  springer: "Springer Nature",
  elsevier: "Elsevier",
  wiley: "Wiley",
}

/**
 * DOI prefix -> TDM provider. Prefix matching (not a Crossref round-trip) keeps this rung free and
 * offline-testable; an unknown prefix simply means "no TDM client", and the ladder falls through to
 * the institutional fetch. Adding a prefix is safe; guessing one is not.
 */
const PREFIXES: Record<string, Publisher> = {
  "10.1038": "springer", // Nature Portfolio
  "10.1007": "springer", // Springer
  "10.1186": "springer", // BMC
  "10.1057": "springer", // Palgrave Macmillan
  "10.1016": "elsevier", // ScienceDirect
  "10.1053": "elsevier",
  "10.1067": "elsevier",
  "10.1002": "wiley",
  "10.1111": "wiley",
  "10.1113": "wiley", // Physiological Society, Wiley-hosted
}

export function publisherFor(doi: string): Publisher | undefined {
  const prefix = doi.match(/^(10\.\d{4,9})\//)?.[1]
  return prefix ? PREFIXES[prefix] : undefined
}

export type AuthStore = Record<string, { key?: string } | undefined>

/**
 * The same auth.json the figure key lives in. XDG_DATA_HOME is honoured because a packaged build
 * isolates its store inside userData — reading the standard path there would hand Paperino
 * InteJer's credentials. Mirrors paperbanana-mcp's _auth_store().
 */
export function readAuthStore(env: Record<string, string | undefined>): AuthStore {
  const base = env.XDG_DATA_HOME ? env.XDG_DATA_HOME : join(homedir(), ".local", "share")
  const path = join(base, "opencode", "auth.json")
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AuthStore
  } catch {
    return {}
  }
}

const ENV_VAR: Record<Publisher, string> = {
  springer: "PAPERINO_TDM_SPRINGER",
  elsevier: "PAPERINO_TDM_ELSEVIER",
  wiley: "PAPERINO_TDM_WILEY",
}

/** An empty string is not a key: it would send an unauthenticated request that 401s confusingly. */
export function tdmKey(
  publisher: Publisher,
  env: Record<string, string | undefined>,
  auth: AuthStore,
): string | undefined {
  return env[ENV_VAR[publisher]]?.trim() || auth[`tdm-${publisher}`]?.key?.trim() || undefined
}

const TIMEOUT_MS = 60_000

/**
 * Fetch the version of record through the publisher's SANCTIONED text-and-data-mining endpoint.
 * Returns undefined when the entitlement does not cover this article (403/404) — that is a normal
 * outcome, not an error, and the ladder falls through to the institutional fetch.
 */
export async function tdmFetch(publisher: Publisher, doi: string, key: string): Promise<Uint8Array | undefined> {
  const request: Record<Publisher, { url: string; headers: Record<string, string> }> = {
    springer: {
      url: `https://api.springernature.com/meta/v2/pdf/${encodeURIComponent(doi)}?api_key=${encodeURIComponent(key)}`,
      headers: { Accept: "application/pdf" },
    },
    elsevier: {
      url: `https://api.elsevier.com/content/article/doi/${encodeURIComponent(doi)}`,
      headers: { Accept: "application/pdf", "X-ELS-APIKey": key },
    },
    wiley: {
      url: `https://api.wiley.com/onlinelibrary/tdm/v1/articles/${encodeURIComponent(doi)}`,
      headers: { Accept: "application/pdf", "Wiley-TDM-Client-Token": key },
    },
  }

  const { url, headers } = request[publisher]
  const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (res.status === 401) throw new Error(`${PUBLISHER_LABEL[publisher]} rejected the TDM key (401)`)
  if (!res.ok) return undefined // 403/404: not entitled to this article. Fall through, do not fail.

  const bytes = new Uint8Array(await res.arrayBuffer())
  if (!new TextDecoder().decode(bytes.slice(0, 5)).startsWith("%PDF")) return undefined
  return bytes
}
```

- [ ] **Step 4: Run the tests — all six pass**

Run: `cd C:/Users/azamk/Documents/Paperino/literature-mcp && bun test test/tdm.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/azamk/Documents
git add Paperino/literature-mcp/src/tdm.ts Paperino/literature-mcp/test/tdm.test.ts
git -c trailer.ifexists=doNothing commit -m "feat(literature): publisher TDM clients, dormant until keyed"
```

---

### Task 5: The ladder

**Files:**
- Create: `literature-mcp/src/fulltext.ts`
- Test: `literature-mcp/test/fulltext.test.ts`

**Interfaces:**
- Consumes: `PaperId` from `./ids`; `resolveId` from `./resolve`; `findOnShelf`, `saveToShelf`, `identOf`, `SHELF_DIR`, `Version` from `./shelf`; `unpaywallLookup`, `arxivPdfUrl`, `downloadPdf`, `unpaywallEmail`, `OaHit` from `./oa`; `publisherFor`, `readAuthStore`, `tdmKey`, `tdmFetch`, `PUBLISHER_LABEL` from `./tdm`.
- Produces: `FulltextResult`, `Deps`, `liveDeps(env)`, `FetchRequest`, `writeFetchRequest(workspace, req)`, `FETCH_REQUEST_PATH`, `runLadder(workspace, id, deps)`.

Dependencies are injected as a `Deps` object so every ordering rule is provable without a network.

- [ ] **Step 1: Write the failing test**

Create `literature-mcp/test/fulltext.test.ts`:

```ts
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
    deps({ unpaywall: async () => { touched = true; return undefined } }),
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
      tdm: async () => { tdmCalled = true; return PDF },
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
      unpaywall: async () => { throw new Error("Unpaywall is down") },
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
      resolve: async () => { throw new Error("doi.org is down") },
      unpaywall: async (doi) => {
        askedFor = doi
        return { url: "https://x/p.pdf", version: "version-of-record" }
      },
    }),
  )
  expect(askedFor).toBe("10.1038/x")
  expect(result.status === "have" && result.source).toBe("unpaywall")
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd C:/Users/azamk/Documents/Paperino/literature-mcp && bun test test/fulltext.test.ts`
Expected: FAIL — `Cannot find module '../src/fulltext'`.

- [ ] **Step 3: Implement `fulltext.ts`**

Create `literature-mcp/src/fulltext.ts`:

```ts
import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { PaperId } from "./ids"
import { arxivPdfUrl, downloadPdf, type OaHit, unpaywallEmail, unpaywallLookup } from "./oa"
import { resolveId } from "./resolve"
import { findOnShelf, identOf, saveToShelf, SHELF_DIR, type Version } from "./shelf"
import { PUBLISHER_LABEL, publisherFor, readAuthStore, tdmFetch, tdmKey } from "./tdm"

export const FETCH_REQUEST_PATH = join(".paperino", "fetch-request.json")

export type FulltextResult =
  | {
      status: "have"
      path: string
      version: Version
      source: "shelf" | "unpaywall" | "preprint" | "tdm"
      title?: string
    }
  | { status: "needs-institutional-fetch"; doi: string; publisher: string; url: string }

/** Every side effect the ladder performs, injected so the ordering rules are testable offline. */
export type Deps = {
  resolve: (id: PaperId) => Promise<{ doi?: string; title?: string }>
  unpaywall: (doi: string, email: string) => Promise<OaHit | undefined>
  tdm: (doi: string) => Promise<Uint8Array | undefined>
  download: (url: string) => Promise<Uint8Array>
  email: (workspace: string) => string
}

export function liveDeps(env: Record<string, string | undefined>): Deps {
  return {
    resolve: async (id) => {
      const r = await resolveId(id)
      return { doi: r.doi, title: r.fields.title || undefined }
    },
    unpaywall: unpaywallLookup,
    tdm: async (doi) => {
      const publisher = publisherFor(doi)
      if (!publisher) return undefined
      const key = tdmKey(publisher, env, readAuthStore(env))
      if (!key) return undefined // dormant until the user supplies a key
      return tdmFetch(publisher, doi, key)
    },
    download: downloadPdf,
    email: (workspace) => unpaywallEmail(workspace, env),
  }
}

export type FetchRequest = { doi: string; url: string; publisher: string; requestedAt: string }

/**
 * The handshake with the Electron main process. An MCP call must not block on a human, so the
 * ladder does not open the login window itself — it leaves this file, which the workspace watcher
 * already sees, and the app prompts the user. Atomic, so the watcher never reads half a request.
 */
export function writeFetchRequest(workspace: string, request: FetchRequest): void {
  const path = join(workspace, FETCH_REQUEST_PATH)
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(request, null, 2)}\n`)
  renameSync(tmp, path)
}

/** A rung that throws must not sink the ladder: a flaky API is not a reason to give up on a paper. */
async function attempt<T>(run: () => Promise<T | undefined>): Promise<T | undefined> {
  try {
    return await run()
  } catch {
    return undefined
  }
}

/**
 * The ladder, first hit wins: shelf -> Unpaywall -> preprint -> TDM -> needs-institutional-fetch.
 *
 * TDM sits BELOW the free rungs on purpose — a metered, entitlement-limited call is not worth
 * spending when a legal free copy exists. Nothing here ever reaches a pirate source; the terminal
 * state is a request for the user to fetch the paper themselves with their own login.
 */
export async function runLadder(workspace: string, id: PaperId, deps: Deps): Promise<FulltextResult> {
  const ident = identOf(id)

  // 1. Shelf — by the id as given, before any network call.
  const onShelf = findOnShelf(workspace, ident)
  if (onShelf)
    return {
      status: "have",
      path: join(SHELF_DIR, onShelf.file),
      version: onShelf.version,
      source: "shelf",
      title: onShelf.title,
    }

  // Resolve to learn the DOI (arXiv/PMID records upgrade to their published DOI) and the title.
  // If resolution fails but the caller GAVE us a DOI, use it: a doi.org outage must not silently
  // skip Unpaywall and TDM and report the paper as paywalled when it is merely unresolved.
  const resolved = (await attempt(() => deps.resolve(id))) ?? {}
  const doi = resolved.doi?.toLowerCase() ?? (id.scheme === "doi" ? id.value.toLowerCase() : undefined)

  // The DOI may name a paper the shelf already holds under a different identifier.
  if (doi) {
    const byDoi = findOnShelf(workspace, doi)
    if (byDoi)
      return {
        status: "have",
        path: join(SHELF_DIR, byDoi.file),
        version: byDoi.version,
        source: "shelf",
        title: byDoi.title,
      }
  }

  const canonical = doi ?? ident
  const save = (bytes: Uint8Array, version: Version, addedBy: "unpaywall" | "preprint" | "tdm"): FulltextResult => {
    const entry = saveToShelf(workspace, bytes, { ident: canonical, doi, version, addedBy, title: resolved.title })
    return { status: "have", path: join(SHELF_DIR, entry.file), version, source: addedBy, title: resolved.title }
  }

  // 2. Unpaywall — the best legally free copy, if one exists.
  if (doi) {
    const hit = await attempt(() => deps.unpaywall(doi, deps.email(workspace)))
    if (hit) {
      const bytes = await attempt(() => deps.download(hit.url))
      if (bytes) return save(bytes, hit.version, "unpaywall")
    }
  }

  // 3. Preprint — an arXiv id that never became a published DOI is served by arXiv itself.
  if (id.scheme === "arxiv" && !doi) {
    const bytes = await attempt(() => deps.download(arxivPdfUrl(id.value)))
    if (bytes) return save(bytes, "preprint", "preprint")
  }

  // 4. TDM — sanctioned publisher access, only where a key exists.
  if (doi) {
    const bytes = await attempt(() => deps.tdm(doi))
    if (bytes) return save(bytes, "version-of-record", "tdm")
  }

  // 5. Paywalled. Nothing is written to the shelf; the user is asked to fetch it themselves.
  const publisher = doi ? publisherFor(doi) : undefined
  const request: FetchRequest = {
    doi: canonical,
    url: `https://doi.org/${canonical}`,
    publisher: publisher ? PUBLISHER_LABEL[publisher] : "the publisher",
    requestedAt: new Date().toISOString(),
  }
  writeFetchRequest(workspace, request)
  return { status: "needs-institutional-fetch", doi: request.doi, publisher: request.publisher, url: request.url }
}
```

- [ ] **Step 4: Run the tests — all eight pass**

Run: `cd C:/Users/azamk/Documents/Paperino/literature-mcp && bun test test/fulltext.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the whole suite — nothing regressed**

Run: `cd C:/Users/azamk/Documents/Paperino/literature-mcp && bun test`
Expected: PASS — the 24 pre-existing tests plus the new ones.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/azamk/Documents
git add Paperino/literature-mcp/src/fulltext.ts Paperino/literature-mcp/test/fulltext.test.ts
git -c trailer.ifexists=doNothing commit -m "feat(literature): the full-text ladder"
```

---

### Task 6: The `fulltext` and `paper_list` MCP tools

**Files:**
- Modify: `literature-mcp/src/server.ts` (append after the `bib_list` registration, before `server.connect`)
- Modify: `literature-mcp/test/dist.test.ts` (add the leaked-key assertion)

**Interfaces:**
- Consumes: `runLadder`, `liveDeps` from `./fulltext`; `listShelf`, `SHELF_DIR` from `./shelf`; `parseId` from `./ids` (already imported).
- Produces: the MCP tool surface — nothing importable.

- [ ] **Step 1: Add the two tools**

In `literature-mcp/src/server.ts`, add these imports beside the existing ones:

```ts
import { liveDeps, runLadder } from "./fulltext"
import { listShelf, SHELF_DIR } from "./shelf"
```

Then insert both registrations after the `bib_list` block and **before** `await server.connect(...)`:

```ts
server.registerTool(
  "fulltext",
  {
    description:
      "Get the full text of a paper so you can read its actual method instead of guessing at it. Takes a DOI, arXiv id or PMID and tries, in order: papers already on the shelf, the best legally free copy (Unpaywall), the arXiv preprint, and the publisher's text-and-data-mining API. Returns a PDF path plus a VERSION tag you must repeat to the user — version-of-record, accepted-manuscript and preprint are different renderings of the work. If every route is closed it returns needs-institutional-fetch: tell the user the paper is paywalled and offer the in-app institutional fetch, or ask them to drop the PDF into papers/. Read the PDF with the pdf skill.",
    inputSchema: {
      workspace: ws,
      id: z.string().describe("An exact DOI (10.…/…), arXiv id (2305.13245) or PMID (PMID:34265844). Never a title."),
    },
  },
  async (a) => {
    const id = parseId(a.id)
    if (!id)
      return text(
        `"${a.id}" is not a DOI, arXiv id or PMID. Find the paper with the paperclip tools first, then pass the identifier they return. Nothing was fetched.`,
      )

    const result = await runLadder(a.workspace, id, liveDeps(process.env))
    if (result.status === "have")
      return text(
        `have: ${result.path} (${result.version}, via ${result.source})${result.title ? ` — ${result.title}` : ""}\n` +
          "Read it with the pdf skill. When you use it, say which version you read.",
      )

    return text(
      `needs-institutional-fetch: ${result.doi} is paywalled at ${result.publisher} and has no legally free copy.\n` +
        `Tell the user, and offer either the in-app institutional fetch (they sign in with their university login and the app saves the PDF) or dropping the PDF into ${SHELF_DIR}/ themselves. ${result.url}\n` +
        "Do NOT summarise the abstract as though you read the paper.",
    )
  },
)

server.registerTool(
  "paper_list",
  {
    description:
      "List the full texts already on this project's shelf, with the version of each. Check here before fetching — a paper you already have costs nothing to read again.",
    inputSchema: { workspace: ws },
  },
  async (a) => {
    const shelf = listShelf(a.workspace)
    if (!shelf.length) return text(`${SHELF_DIR}/ is empty — no full texts fetched yet.`)
    return text(
      shelf
        .map(
          (e) =>
            `${SHELF_DIR}/${e.file} — ${e.title ?? e.ident} [${e.version}${e.addedBy === "manual-drop" ? ", dropped by the user" : ""}]`,
        )
        .join("\n"),
    )
  },
)
```

- [ ] **Step 2: Verify the server starts and lists four tools**

Run:

```bash
cd /c/Users/azamk/Documents/Paperino/literature-mcp
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | bun src/server.ts
```

Expected: JSON containing all four tool names — `cite`, `bib_list`, `fulltext`, `paper_list`.

- [ ] **Step 3: Extend the bundle-safety test**

Add to `literature-mcp/test/dist.test.ts`, after the "bakes in no path" test:

```ts
test("dist bakes in no TDM key", () => {
  // A key in the bundle is one institution's entitlement shipped to every machine — the same
  // failure class as the old X-API-Key in a config. Keys are read from auth.json at call time;
  // only the ENV VAR NAMES and the auth-store key names may appear here.
  const bundle = readFileSync(join(DIST, "server.mjs"), "utf8")
  const auth = join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode", "auth.json")
  if (!existsSync(auth)) return
  const store = JSON.parse(readFileSync(auth, "utf8")) as Record<string, { key?: string } | undefined>
  for (const name of ["tdm-springer", "tdm-elsevier", "tdm-wiley"]) {
    const key = store[name]?.key
    if (key && key.length > 8) expect(bundle).not.toInclude(key)
  }
})
```

- [ ] **Step 4: Run the full suite**

Run: `cd C:/Users/azamk/Documents/Paperino/literature-mcp && bun test`
Expected: PASS — everything green, including the rebuilt `dist` smoke test.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/azamk/Documents
git add Paperino/literature-mcp/src/server.ts Paperino/literature-mcp/test/dist.test.ts
git -c trailer.ifexists=doNothing commit -m "feat(literature): expose fulltext and paper_list as MCP tools"
```

---

### Task 7: The institutional fetch window

**Files:**
- Create: `opencode-dev/packages/desktop/src/main/paperino/institutional.ts`
- Test: `opencode-dev/packages/desktop/src/main/paperino/institutional.test.ts`

**Interfaces:**
- Consumes: the `FetchRequest` shape from Task 5 (`{doi, url, publisher, requestedAt}`) — re-declared here, since the desktop package cannot import from `literature-mcp`.
- Produces: `FETCH_REQUEST_PATH`, `FetchRequest`, `shelfPathFor(doi)`, `readFetchRequest(workspace)`, `clearFetchRequest(workspace)`, `openInstitutionalFetch(workspace, request)`.

The pure parts (request parsing, filename derivation) are unit-tested; the `BrowserWindow` is verified by running the app, per the project's standing rule that window and packaging bugs pass tests and fail in the app.

- [ ] **Step 1: Write the failing test**

Create `opencode-dev/packages/desktop/src/main/paperino/institutional.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd C:/Users/azamk/Documents/Paperino/opencode-dev/packages/desktop && bun test src/main/paperino/institutional.test.ts`
Expected: FAIL — `Cannot find module './institutional'`.

- [ ] **Step 3: Implement `institutional.ts`**

Create `opencode-dev/packages/desktop/src/main/paperino/institutional.ts`:

```ts
import { BrowserWindow, session } from "electron"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs"
import { join } from "node:path"

/**
 * The institutional-fetch rung: the one step of the full-text ladder an MCP server cannot perform,
 * because only the main process can open a window the user logs into.
 *
 * What this is: the user opening the publisher's page and downloading a paper their institution
 * subscribes to — inside the app instead of a separate browser tab. Their credentials go to their
 * university's SSO and the publisher; we keep nothing but the session cookies, in an isolated
 * persistent partition.
 *
 * What this is deliberately NOT: a crawler. One window, one paper, one explicit save. Automating it
 * over a list is what gets a university's whole IP range blocked, so the confirmation stays.
 */
export const FETCH_REQUEST_PATH = join(".paperino", "fetch-request.json")
const SHELF_DIR = "papers"
const PARTITION = "persist:institution"
const STALE_MS = 3_600_000

export type FetchRequest = { doi: string; url: string; publisher: string; requestedAt: string }

/** Mirrors literature-mcp's slugFor() — the two must agree, or a saved PDF is invisible to the shelf. */
export function shelfPathFor(doi: string): string {
  return `${SHELF_DIR}/${doi.toLowerCase().replace(/[\\/:*?"<>|]/g, "_")}.pdf`
}

/**
 * Read the request the MCP left, or undefined. Undefined covers absent, malformed, incomplete and
 * stale — a request from an hour ago must not pop a login window the user has no context for.
 */
export function readFetchRequest(workspace: string): FetchRequest | undefined {
  const path = join(workspace, FETCH_REQUEST_PATH)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<FetchRequest>
    if (!parsed.doi || !parsed.url || !parsed.requestedAt) return undefined
    if (Date.now() - Date.parse(parsed.requestedAt) > STALE_MS) return undefined
    return {
      doi: parsed.doi,
      url: parsed.url,
      publisher: parsed.publisher ?? "the publisher",
      requestedAt: parsed.requestedAt,
    }
  } catch {
    return undefined
  }
}

export function clearFetchRequest(workspace: string): void {
  rmSync(join(workspace, FETCH_REQUEST_PATH), { force: true })
}

/**
 * Open the publisher's page in a window with a PERSISTENT partition, so the user signs in through
 * their library's SSO once and subsequent papers are a click. Any PDF downloaded in that window
 * lands on the shelf under the requested DOI's slug, where `fulltext`'s first rung will find it.
 *
 * Resolves true if a PDF was saved, false if the user closed the window without one.
 */
export function openInstitutionalFetch(workspace: string, request: FetchRequest): Promise<boolean> {
  return new Promise((resolve) => {
    const partition = session.fromPartition(PARTITION)
    const target = join(workspace, shelfPathFor(request.doi))
    mkdirSync(join(workspace, SHELF_DIR), { recursive: true })

    let saved = false
    const onDownload = (_e: Electron.Event, item: Electron.DownloadItem) => {
      // Save through a temp name and rename, so the workspace watcher never sees a partial PDF.
      const tmp = `${target}.part`
      item.setSavePath(tmp)
      item.once("done", (_evt, state) => {
        if (state !== "completed") return
        try {
          renameSync(tmp, target)
          saved = true
          clearFetchRequest(workspace)
          win.close()
        } catch {
          rmSync(tmp, { force: true })
        }
      })
    }
    partition.on("will-download", onDownload)

    const win = new BrowserWindow({
      width: 1100,
      height: 850,
      title: `Sign in to ${request.publisher} — Paperino`,
      webPreferences: { partition: PARTITION, nodeIntegration: false, contextIsolation: true },
    })

    win.once("closed", () => {
      partition.off("will-download", onDownload)
      resolve(saved)
    })
    void win.loadURL(request.url)
  })
}
```

- [ ] **Step 4: Run the tests — all five pass**

Run: `cd C:/Users/azamk/Documents/Paperino/opencode-dev/packages/desktop && bun test src/main/paperino/institutional.test.ts`
Expected: PASS, 5 tests. (The `electron` import resolves under bun because no test calls `openInstitutionalFetch` — it is the only function that touches it. If bun cannot resolve `electron` at import time, move `import { BrowserWindow, session } from "electron"` inside `openInstitutionalFetch` as a dynamic `await import("electron")` and make that function `async`.)

- [ ] **Step 5: Commit**

```bash
cd /c/Users/azamk/Documents
git add Paperino/opencode-dev/packages/desktop/src/main/paperino/institutional.ts Paperino/opencode-dev/packages/desktop/src/main/paperino/institutional.test.ts
git -c trailer.ifexists=doNothing commit -m "feat(fulltext): the institutional-fetch window"
```

---

### Task 8: Wire the fetch prompt into the running app

**Files:**
- Modify: `opencode-dev/packages/desktop/src/main/paperino/ipc.ts`
- Modify: `opencode-dev/packages/desktop/src/preload/index.ts`

**Interfaces:**
- Consumes: `readFetchRequest`, `clearFetchRequest`, `openInstitutionalFetch` from `./institutional`.
- Produces: IPC channels `paperino:fetch-request` (returns `FetchRequest | null`) and `paperino:institutional-fetch` (returns `boolean`); preload methods `window.api.paperinoFetchRequest(workspace)` and `window.api.paperinoInstitutionalFetch(workspace)`.

- [ ] **Step 1: Read the existing IPC file to match its registration style**

Run: `cat C:/Users/azamk/Documents/Paperino/opencode-dev/packages/desktop/src/main/paperino/ipc.ts`
Expected: a series of `ipcMain.handle("paperino:…", …)` registrations. Match that shape exactly — same naming convention, same error handling — rather than inventing a new one.

- [ ] **Step 2: Add the two handlers**

Add to `ipc.ts`, alongside the existing `paperino:` handlers:

```ts
import { clearFetchRequest, openInstitutionalFetch, readFetchRequest } from "./institutional"

// Is there a paper the agent could not reach, waiting on the user's library login?
ipcMain.handle("paperino:fetch-request", (_e, workspace: string) => readFetchRequest(workspace) ?? null)

// Open the publisher's page for the user to sign in and save the PDF. Explicitly user-initiated:
// the renderer calls this from a click, never on a timer, because an automated loop over paywalled
// DOIs is precisely what publishers ban and what gets an institution blocked.
ipcMain.handle("paperino:institutional-fetch", async (_e, workspace: string) => {
  const request = readFetchRequest(workspace)
  if (!request) return false
  const saved = await openInstitutionalFetch(workspace, request)
  if (!saved) clearFetchRequest(workspace)
  return saved
})
```

- [ ] **Step 3: Expose them in the preload**

In `opencode-dev/packages/desktop/src/preload/index.ts`, add beside the existing `paperino*` methods:

```ts
  paperinoFetchRequest: (workspace: string) => ipcRenderer.invoke("paperino:fetch-request", workspace),
  paperinoInstitutionalFetch: (workspace: string) => ipcRenderer.invoke("paperino:institutional-fetch", workspace),
```

- [ ] **Step 4: Typecheck**

Run: `cd C:/Users/azamk/Documents/Paperino/opencode-dev/packages/desktop && bun run typecheck`
Expected: PASS, no errors. If `typecheck` is not a script in this package, run `bunx tsc --noEmit -p tsconfig.json`.

- [ ] **Step 5: Verify in the running app**

Launch: `C:/Users/azamk/Documents/Paperino/opencode-dev/paperino-dev.cmd`

Drive it over CDP on port 9222 — **first confirm the target is Paperino and not InteJer**, which shares that port. If InteJer's dev app is holding 9222, stop and ask the user rather than driving their other app:

```bash
node -e "fetch('http://127.0.0.1:9222/json/list').then(r=>r.json()).then(l=>console.log(l.map(t=>t.title).join('\n')))"
```

With a paper workspace open, evaluate in the renderer:

```js
await window.api.paperinoFetchRequest("<workspace path>")
```

Expected: `null` (no request pending). Then hand-write `.paperino/fetch-request.json` with a fresh `requestedAt` and a real DOI URL, re-run, and expect the parsed object back. Finally call `window.api.paperinoInstitutionalFetch("<workspace path>")` and confirm a window opens at the publisher.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/azamk/Documents
git add Paperino/opencode-dev/packages/desktop/src/main/paperino/ipc.ts Paperino/opencode-dev/packages/desktop/src/preload/index.ts
git -c trailer.ifexists=doNothing commit -m "feat(fulltext): IPC for the institutional fetch prompt"
```

---

### Task 9: TDM key entry

**Files:**
- Create: `opencode-dev/packages/app/src/components/paperino/fulltext-keys.tsx`

**Interfaces:**
- Consumes: the same auth-write call the wizard's figure-key step uses. **`useServerSDK()` returns an accessor** — it is `serverSDK().client`, never `serverSDK.client`.
- Produces: `<FulltextKeys writeKey={…} />`, a panel with three optional key fields writing provider ids `tdm-springer`, `tdm-elsevier`, `tdm-wiley`.

Not a wizard step — the wizard is already nine steps, and these keys are optional and institution-specific. This is a settings panel.

- [ ] **Step 1: Find the figure-key step's auth-write call**

Run: `grep -n "openrouter\|google\|auth" C:/Users/azamk/Documents/Paperino/opencode-dev/packages/app/src/components/paperino/onboarding-wizard.tsx`
Expected: the call that writes a key under a provider id. Reuse it verbatim as the `writeKey` prop's implementation at the call site — do not invent a second way to write `auth.json`.

- [ ] **Step 2: Write the component**

Create `opencode-dev/packages/app/src/components/paperino/fulltext-keys.tsx`:

```tsx
import { createSignal, For } from "solid-js"

/**
 * Optional publisher text-and-data-mining keys. Each is issued by a publisher to a SUBSCRIBING
 * institution — the sanctioned way to read closed full text, and the user's own entitlement. They
 * live in auth.json beside the figure key, never in a config file and never in the installer: a key
 * in a shipped artifact is one institution's entitlement handed to everyone who downloads it.
 *
 * Every field is optional. With none set, the full-text ladder skips the TDM rung and falls through
 * to the institutional fetch — which is why this ships as settings, not as a wizard step.
 */
const PROVIDERS = [
  { id: "tdm-springer", label: "Springer Nature", hint: "Nature, Springer, BMC — dev.springernature.com" },
  { id: "tdm-elsevier", label: "Elsevier", hint: "ScienceDirect, Cell — dev.elsevier.com" },
  { id: "tdm-wiley", label: "Wiley", hint: "Wiley Online Library — onlinelibrary.wiley.com text-and-data-mining" },
] as const

export function FulltextKeys(props: { writeKey: (provider: string, key: string) => Promise<void> }) {
  const [saved, setSaved] = createSignal<Record<string, boolean>>({})
  const [values, setValues] = createSignal<Record<string, string>>({})

  const save = async (id: string) => {
    const key = values()[id]?.trim()
    if (!key) return
    await props.writeKey(id, key)
    setSaved((s) => ({ ...s, [id]: true }))
    setValues((v) => ({ ...v, [id]: "" }))
  }

  return (
    <div class="flex flex-col gap-4">
      <div class="text-14-regular text-text-weak">
        Optional. If your institution subscribes, a text-and-data-mining key lets Paperino fetch the
        published version of a closed paper directly. Without one it will ask you to sign in and save
        the PDF yourself.
      </div>
      <For each={PROVIDERS}>
        {(p) => (
          <div class="flex flex-col gap-1">
            <label class="text-14-regular text-text-base">{p.label}</label>
            <div class="flex gap-2">
              <input
                type="password"
                class="flex-1"
                placeholder={saved()[p.id] ? "saved" : "paste key"}
                value={values()[p.id] ?? ""}
                onInput={(e) => setValues((v) => ({ ...v, [p.id]: e.currentTarget.value }))}
              />
              <button onClick={() => void save(p.id)}>Save</button>
            </div>
            <div class="text-12-regular text-text-weak">{p.hint}</div>
          </div>
        )}
      </For>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `cd C:/Users/azamk/Documents/Paperino/opencode-dev/packages/app && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/azamk/Documents
git add Paperino/opencode-dev/packages/app/src/components/paperino/fulltext-keys.tsx
git -c trailer.ifexists=doNothing commit -m "feat(fulltext): optional publisher TDM key entry"
```

---

### Task 10: Teach the agent, and write down what was learned

**Files:**
- Modify: `opencode-dev/paperino-config/AGENTS.md`
- Modify: `Paperino/CLAUDE.md`

**Interfaces:**
- Consumes: the tool names and result vocabulary from Tasks 5–6 — `fulltext`, `paper_list`, `have`, `needs-institutional-fetch`, `version-of-record | accepted-manuscript | preprint | unknown`.
- Produces: nothing importable.

- [ ] **Step 1: Add the "Reading papers" section to AGENTS.md**

Insert immediately after the Citations section's last bullet:

```markdown
## Reading papers

Citing a paper and reading it are separate. `cite` puts an entry in the bib; **`fulltext`** puts the
paper itself on disk so you can read its method instead of guessing at it.

1. **`fulltext(workspace, id)`** — same identifiers `cite` takes. It tries the shelf, then the best
   legally free copy, then the arXiv preprint, then the publisher's TDM API.
2. It returns a path and a **version tag**. **Always say which version you read**: a
   `version-of-record` is the published paper; an `accepted-manuscript` can differ from it in
   wording and pagination; a `preprint` may differ from both. Presenting one as another is the same
   class of error as inventing a number.
3. **Read the PDF with the pdf skill.** `fulltext` fetches; it does not extract.
4. **`paper_list`** shows what is already on the shelf. Check it before fetching again.
5. **`needs-institutional-fetch`** means every legal route is closed. Tell the user the paper is
   paywalled, name the publisher, and offer either the in-app institutional fetch — they sign in
   with their university login and the app saves the PDF — or dropping the PDF into `papers/`
   themselves. **Do not summarise the abstract as though you read the paper**, and do not go looking
   for the text anywhere else.
6. A PDF listed as `manual-drop` / `unknown` is one the user placed there. Read it, but do not
   assert which version it is unless they tell you.

`fulltext` never touches `references.bib`.
```

- [ ] **Step 2: Extend rule 1**

In the "Non-negotiable rules" list, replace rule 1's final sentence (`…do not fill the gap with plausible fiction.`) with:

```markdown
   missing and ask — do not fill the gap with plausible fiction. This covers *reading* too: a claim
   about what a paper did comes from its text (`fulltext`, or paperclip's full-text tools), never
   from its abstract or from memory.
```

- [ ] **Step 3: Add the CLAUDE.md section**

Insert after the `## literature-mcp` section:

```markdown
## Full-text access

The rung Paperclip cannot reach: *closed* publisher text. `fulltext(id)` walks a ladder — shelf →
Unpaywall → arXiv preprint → publisher TDM → `needs-institutional-fetch` — and drops PDFs into a
per-project `papers/` with a `.index.json` sidecar. Spec:
`2026-07-22-fulltext-access-design.md`.

- **No pirate sources, ever.** The terminal state of the ladder is asking the user to fetch the
  paper with their own login, not finding it elsewhere. This is not a tunable.
- **TDM sits below the free rungs** — a metered, entitlement-limited call is not worth spending when
  a legal free copy exists. It is also **dormant until keyed**: `tdmKey` returns undefined and the
  rung is skipped, so the feature ships complete without anyone having registered with a publisher.
- **The version tag is the point.** `oaVersion(undefined)` maps to `accepted-manuscript`, never
  `version-of-record` — the agent repeats this tag to the user as a claim about what it read, and an
  unearned "version of record" is the reading equivalent of an invented number.
- **`classifyChange` must ignore `papers/`.** `SOURCE_RE` matches `.pdf` on purpose (Figure Studio
  emits figure PDFs), so without that rule every fetched paper reads as a manuscript edit and
  retriggers the compile forever — the same trap the emitted `main.pdf` set.
- **`shelfPathFor` in `institutional.ts` duplicates `slugFor` in `shelf.ts`**, and the two must
  agree or a PDF the fetch window saves is invisible to the shelf rung and gets fetched again. They
  live in different packages (desktop cannot import from `literature-mcp`), so this is a deliberate
  copy — change one, change both.
- **The MCP never opens the login window.** An MCP call must not block on a human, so the ladder
  leaves `.paperino/fetch-request.json` and the Electron main process — which already watches the
  workspace — prompts. A request older than an hour is ignored, so a stale file cannot pop a window
  the user has no context for.
- **The institutional window is interactive by design.** One window, one paper, one explicit save, on
  a `persist:institution` partition. Automating it over a list is what gets a university's IP range
  blocked; the confirmation is a feature, not friction to optimise away.
```

- [ ] **Step 4: Verify the agent actually sees the new tools**

Launch `paperino-dev.cmd`, then ask in the app: *"What tools do you have for reading a paper's full text?"*
Expected: it names `fulltext` and `paper_list` and describes the version tag. If it does not, the MCP failed to start — check the sidecar log rather than editing AGENTS.md again.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/azamk/Documents
git add Paperino/opencode-dev/paperino-config/AGENTS.md Paperino/CLAUDE.md
git -c trailer.ifexists=doNothing commit -m "docs(fulltext): teach the agent to read papers and record the traps"
```

---

## Final verification — in the running app, not the suite

Every packaging and window bug in this project so far passed the tests and failed in the app. After Task 10:

1. **Rebuild the bundle:** `cd C:/Users/azamk/Documents/Paperino/literature-mcp && bun run build:dist`
2. **Launch** `paperino-dev.cmd` with a paper workspace open.
3. **Green-OA path:** ask the agent to fetch the full text of `10.1038/s41586-021-03819-2`. Expect a PDF in `papers/`, an `.index.json` entry, and the agent stating which version it got.
4. **No recompile:** confirm the Preview panel does **not** rebuild when that PDF lands. (If the panel churns, Task 2 regressed.)
5. **Paywalled path:** ask for a DOI with no free copy — e.g. a recent subscription-only *Science* article (prefix `10.1126`, which has no TDM client). Expect `needs-institutional-fetch`, the agent offering the fetch or a manual drop, **no** invented summary, and `.paperino/fetch-request.json` present.
6. **Institutional fetch:** trigger it, sign in through your library, save the PDF. Expect it in `papers/` under the DOI slug, and a follow-up `fulltext` call returning `source: shelf`.
7. **Manual drop:** copy any PDF into `papers/` by hand and run `paper_list`. Expect it listed as `manual-drop` / `unknown`.
8. **The wall still holds:** ask the agent to add an entry to `references.bib` directly. Expect a permission denial — this feature must not have loosened it.

## Spec coverage

| Spec section | Task |
|---|---|
| Ladder rungs 1–5, version tags, failure behaviour | 5 |
| `fulltext` / `paper_list` tool surface | 6 |
| `papers/` shelf, `.index.json`, manual-drop handling | 1 |
| Extraction stays in the pdf skill | 10 (AGENTS.md instructs it) |
| `classifyChange` ignores `papers/**` | 2 |
| Unpaywall + email resolution | 3 |
| Preprint rung | 3 (URL) + 5 (ordering) |
| TDM clients, publisher matching, key storage | 4 |
| TDM key entry surface | 9 |
| Institutional fetch window, partition, capture, handshake | 7 + 8 |
| AGENTS.md "Reading papers", rule 1 reading clause | 10 |
| Registration & packaging (no new server) | 6 — the tools ride the existing bundle |
| Testing: offline, live, bundle sanity | 1, 3, 4, 5, 6 |
| Non-goals (no pirate sources, no batch, no OCR, no new server) | Global Constraints |

**One deliberate deviation from the spec:** the spec called for fixture-based tests of the TDM
clients. Task 4 tests the parts that carry the logic — publisher matching, key resolution, the
empty-string guard — but not `tdmFetch` itself, which is a thin request builder whose only untested
surface is three URL templates. Fixture-testing it would mean stubbing global `fetch` to assert the
shape of a request no one can currently send. Verify those three templates against the publishers'
docs the day the first key arrives; that is the real check, and it is in the final-verification list
below by implication (rung 4 cannot be exercised until then).
