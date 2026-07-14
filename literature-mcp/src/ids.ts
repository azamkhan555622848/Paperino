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
