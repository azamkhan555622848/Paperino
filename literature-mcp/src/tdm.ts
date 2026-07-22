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
