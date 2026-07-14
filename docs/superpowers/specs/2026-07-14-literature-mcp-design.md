# literature-mcp — search and citation resolution

**Date:** 2026-07-14
**Status:** approved (design approved in-session; approach A of three)
**Owner:** Paperino

## What this is

The third Paperino MCP server, closing product rule 2. Today `references.bib` is
machine-owned in name only: no machine writes it, so the shipped agent marks
`% TODO-CITE <what>` comments and the file never comes into existence. literature-mcp
makes those TODO-CITEs resolvable — the agent searches the open scholarly indexes,
gets exact IDs, and resolves them into a bib file it never touches by hand.

The defining constraint, inherited from the product: **rule 2 is enforced structurally,
not by prompt.** No tool accepts BibTeX text. The agent cannot write an entry it
composed; a citation exists only if a resolver derived it from a DOI, arXiv ID, or PMID.

## Decisions locked here

- **Approach A: thin orchestrator, no local state.** `references.bib` is the only
  state and this server is its only writer. No `library.json` cache (approach B),
  no Zotero translation-server (approach C). Both can bolt on later without
  reshaping the tool surface.
- **v1 scope: search + resolve.** No Zotero import, no PDF fetching.
- **PMID is in.** Rule 2 names DOI/arXiv/PMID; Paperino targets NEJM/Lancet/JAMA.
- **`cite` refuses fuzzy input.** Only exact IDs; titles must go through `lit_search`
  first, so "closest match" can never silently become a citation.
- **Append-only bib writing.** Existing file content is never reformatted or
  re-serialized. Dedupe is a scan, not a parse-rewrite cycle.

## Repository layout

```
Paperino/
  literature-mcp/
    package.json            name "literature-mcp"; bun for dev/test
    scripts/build-dist.ts   node-target bundle -> dist/server.mjs (mirrors figures-mcp)
    src/
      server.ts             MCP wiring: 3 tools, zod schemas
      ids.ts                ID parsing/validation (DOI, arXiv, PMID regexes)
      search.ts             lit_search: Crossref + OpenAlex + arXiv fan-out, merge, rank
      resolve.ts            cite: ID -> authoritative BibTeX (per-scheme resolvers)
      bib.ts                key generation, dedupe scan, atomic append
    test/
      ids.test.ts           offline
      bib.test.ts           offline, fixture bib files
      search.test.ts        live (needs network), generous timeouts
      resolve.test.ts       live (needs network)
      dist.test.ts          bundle sanity: no dev paths, no {{tokens}}
```

The server runs on **node-compatible APIs only** (global `fetch`, `node:fs`,
`node:path`): dev runs under bun, the packaged build runs the same bundle on the
app's `electron.exe` with `ELECTRON_RUN_AS_NODE=1`. Nothing bun-specific in `src/`.

## Tool surface

All tools take `workspace` (absolute path of the paper folder), like the figures tools.

### `lit_search(workspace, query, limit?)`

Find papers. Fan-out in parallel to:

| Backend | Endpoint | Notes |
|---|---|---|
| Crossref | `api.crossref.org/works?query.bibliographic=...&rows=N` | polite pool: User-Agent carries a mailto, overridable via `PAPERINO_CONTACT` |
| OpenAlex | `api.openalex.org/works?search=...&per-page=N` | CC0, no auth |
| arXiv | `export.arxiv.org/api/query?search_query=...` | Atom XML |

- 15 s timeout per backend. A dead backend degrades the result; the response
  names which backends answered (`sources: ["crossref", "openalex"]`). All three
  dead → tool error.
- Hits normalize to `{title, authors[], year, venue, ids: {doi?, arxiv?, pmid?},
  citedBy?}`. Dedupe by lowercased DOI, then by normalized title (lowercase,
  strip punctuation/whitespace). Rank: hits whose normalized title equals the
  normalized query first, then citedBy descending (missing citedBy sorts last).
  Return top `limit` (default 10).
- Every candidate carries the literal ID string to pass to `cite`. The tool
  description tells the agent: to cite, call `cite` with one of these IDs; if
  several candidates are plausible, ask the user, do not pick silently.

### `cite(workspace, id)`

Resolve one exact ID into `references.bib`. Returns `{key, entry, action}` where
`action` is `"added" | "already-present"`.

Accepted shapes (strict regex, anything else is an error saying "use lit_search"):

- DOI: `10.\d{4,9}/\S+` (also accepts `doi:` / `https://doi.org/` prefixes, stripped)
- arXiv: `\d{4}\.\d{4,5}(v\d+)?` or `arXiv:` prefix (also old-style `cs/0501001`)
- PMID: `PMID:\s*\d+` or `pmid:` prefix

Resolution per scheme:

- **DOI** → `GET https://doi.org/<doi>` with `Accept: application/x-bibtex`,
  following redirects. Publisher-authoritative; covers Crossref and DataCite DOIs.
- **arXiv** → arXiv Atom API for metadata. **If the record carries a DOI (a
  published version exists), resolve that DOI instead** and note the upgrade in the
  result. Otherwise emit `@misc{..., eprint={...}, archivePrefix={arXiv}, ...}`
  built from the Atom fields — arXiv's API *is* the authoritative source here.
- **PMID** → NCBI E-utilities `efetch` for metadata; same DOI-upgrade rule;
  otherwise build `@article` from the returned record.

Post-processing:

- **Key**: `<first-author-family, lowercased, ASCII-folded><year><first significant
  title word>` — e.g. `khan2026sensitivity`. Stopwords (a/an/the/on/of/for/with...)
  skipped. Collision with a different work → suffix `b`, `c`, ...
- **Dedupe**: scan the existing file for the DOI (case-insensitive) and for
  arXiv/PMID ids. Present → return the existing key with `action:
  "already-present"`, write nothing.
- **Write**: create the file with a `% MACHINE-OWNED (literature-mcp) — do not
  hand-edit. Entries are resolved from DOI/arXiv/PMID.` header if absent; append
  the entry; atomic (write temp, rename). Existing bytes are never reformatted.

### `bib_list(workspace)`

Read-only. Tolerant regex scan of `references.bib` returning
`[{key, title?, doi?, arxiv?, pmid?}]` so the agent knows what is already citable
before searching. Missing file → empty list (not an error).

## Failure behavior

- Resolution failure (bad ID, 404 on doi.org, backend down) → structured error,
  nothing written. **There is no fallback that constructs an entry from
  lit_search metadata** — search hits are leads, not sources.
- `cite` result and errors are phrased for the agent to surface verbatim
  ("Could not resolve 10.1234/nope — citation NOT added").
- Network is required; there is no offline mode. That is acceptable: search and
  resolution are inherently online, and a clear error beats a stale cache.

## Registration and packaging

- **Dev** — `paperino-config/opencode.jsonc`:
  `"literature": { "type": "local", "command": ["bun", "<paperino>/literature-mcp/src/server.ts"], "enabled": true }`
- **Packaged** — `opencode.packaged.jsonc` template:
  `"command": ["{{ELECTRON}}", "{{RESOURCES}}/literature-mcp/server.mjs"]` with
  `"environment": { "ELECTRON_RUN_AS_NODE": "1" }`. No extra binaries, no Python.
- **Staging** — `stage-paperino.ts` gains: run `literature-mcp/scripts/build-dist.ts`,
  copy `dist/` to `resources-paperino/literature-mcp/`.
- Default MCP timeout suffices (calls are seconds, not minutes — unlike paperbanana).

## AGENTS.md changes (shipped agent behavior)

- Rule 2 loses its "until the literature tools are installed" clause. New workflow:
  `% TODO-CITE` → `lit_search` → **ask the user when candidates are ambiguous** →
  `cite` → `\cite{key}` in prose.
- New "Citations" section: never type a remembered reference; `references.bib` is
  written only by `cite`; a `% TODO-CITE` is resolved by searching, not recalling;
  when `cite` reports `already-present`, reuse the returned key.

## Testing

Three tiers, matching house precedent:

1. **Offline unit** (`ids`, `bib`): ID regex accepts/rejects, key generation incl.
   ASCII folding and collisions, dedupe scan against fixture bib files, append
   preserves existing bytes, atomic write, header creation.
2. **Live integration** (`search`, `resolve`): marked "needs network", generous
   timeouts (the Tectonic compile tests are the precedent). One known DOI, one
   arXiv preprint without DOI, one arXiv record with a published DOI (upgrade
   path), one PMID, one nonsense ID (must error, must not write).
3. **Bundle sanity** (`dist`): the packed `server.mjs` contains no absolute dev
   paths (unescape JS-source backslashes before grepping — the jq lesson) and no
   `{{TOKEN}}` residue.

Final verification is against the **running packaged app**, not the suite: agent
session resolves a real TODO-CITE end to end; `references.bib` appears with the
machine-owned header; citing the same DOI twice yields `already-present`.

## Non-goals (v1)

- Zotero import (later: local API on port 23119, re-resolve every entry via DOI
  before writing — Zotero supplies candidates, the pipeline supplies truth).
- PDF fetching (Unpaywall/arXiv), translation-server URL scraping, GROBID PDF
  reference extraction.
- Citation-style handling: the `.bib` is style-agnostic; venue templates own style.
- Editing/removing entries. The file is append-only until a real need appears.
