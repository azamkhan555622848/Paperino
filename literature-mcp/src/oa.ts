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
