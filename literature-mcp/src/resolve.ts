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
