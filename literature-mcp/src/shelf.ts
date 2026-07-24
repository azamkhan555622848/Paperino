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

  // No index row — but two paths put a PDF here without one: the institutional fetch window (it
  // lives in the desktop package and cannot import this module, so it writes the file and nothing
  // else) and a user dropping a download in by hand. The slug is derived from the ident, so the
  // file's own name identifies it. Skipping this would ask the user to re-fetch a paper already on
  // their shelf — the one thing the shelf rung exists to prevent.
  const file = `${slugFor(key)}.pdf`
  if (existsSync(join(workspace, SHELF_DIR, file))) {
    // We did not fetch it and there is no record of which rendering it is. `unknown` is the honest
    // answer; the agent is instructed not to assert a version it was never told.
    return { file, ident: key, version: "unknown", addedBy: "manual-drop" }
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
