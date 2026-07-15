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
