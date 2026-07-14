import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { PaperId } from "./ids"

export const BIB_FILE = "references.bib"
export const BIB_HEADER =
  "% MACHINE-OWNED (literature-mcp). Do not hand-edit — entries are resolved from DOI/arXiv/PMID.\n"

export type BibEntry = { key: string; title?: string; doi?: string; arxiv?: string; pmid?: string }

const clean = (s: string) => s.replace(/\s+/g, " ").trim()

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "on",
  "of",
  "for",
  "with",
  "and",
  "or",
  "to",
  "in",
  "is",
  "are",
  "from",
  "by",
  "at",
  "as",
  "via",
  "using",
  "towards",
  "toward",
  "into",
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
