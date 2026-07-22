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
