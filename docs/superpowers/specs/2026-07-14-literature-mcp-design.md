# Citations — Paperclip for discovery, literature-mcp for the bib

**Date:** 2026-07-14
**Status:** approved (supersedes the first draft of this file, which specced a self-built
search layer; see "Why this changed")
**Owner:** Paperino

## What this is

Closing product rule 2: *"`references.bib` is machine-owned. Citations only come from a
resolved DOI/arXiv/PMID."* Today that rule is a sentence in AGENTS.md and nothing more —
no machine writes the file, and nothing stops the agent from hand-writing an invented
entry into it.

Two pieces, only one of which we build:

1. **Paperclip** (`https://paperclip.gxl.ai/mcp`) — registered as a **remote MCP server**.
   Literature discovery and full-text reading. Not built, not vendored, not forked.
2. **literature-mcp** — a small local MCP server we build. **Two tools**, `cite` and
   `bib_list`. It is the *only* writer of `references.bib`.

And one line of config that makes the rule structural rather than aspirational:
the agent is **denied write permission on `references.bib`**.

## Why this changed

The first draft of this spec specced `lit_search` — a Crossref + OpenAlex + arXiv metadata
fan-out. Paperclip already does that and far more: `search`, `lookup`, `grep`, `scan`,
`sql`, `cat`, `ls`, `tree`, `map`, `reduce`, `ask-image` over an agent-native virtual
filesystem of PMC (7.5M), arXiv (3.0M), bioRxiv/medRxiv, OpenAlex (150M abstracts), FDA,
ClinicalTrials.gov, UniProt, PDB and ChEMBL. It greps *inside* full texts. Our fan-out
would have been a strictly worse version of one of its ten tools. It is dropped.

What Paperclip does **not** do is own our bib file. Its `export` tool emits BibTeX *as a
string* — and an agent that can paste a BibTeX string into `references.bib` can equally
paste a hallucinated one. So the half we keep is the half that enforces the rule.

## Verified facts this design rests on

Probed 2026-07-14; re-probe before trusting any of it.

- **Paperclip's MCP speaks OAuth 2.1, not just API keys.** An unauthenticated `initialize`
  returns `401` with
  `www-authenticate: Bearer resource_metadata="https://paperclip.gxl.ai/.well-known/oauth-protected-resource"`.
  Both `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`
  serve 200. The AS advertises `registration_endpoint: /api/oauth/register` (**dynamic client
  registration**), `authorization_code` grant, and `S256` PKCE.
  **Therefore no API key is stored anywhere** — not in a config, not in the installer, not
  in git. The `X-API-Key` header the docs describe is for the Python SDK; we do not use it.
- **opencode implements the client side natively.** `mcp/index.ts` connects `type: "remote"`
  servers, treats `oauth !== false` as OAuth-enabled (`:952`), and exposes
  `/mcp/{name}/auth`, `/auth/callback`, `/auth/authenticate` (confirmed live on the packaged
  app).
- **The permission system can scope a deny to a path.** `tool/edit.ts:102-105` asks with
  `permission: "edit"` and `patterns: [path.relative(worktree, filePath)]`;
  `permission/index.ts:193-195` builds rules from config globs against exactly that pattern;
  `:205` folds `edit`, `write` and `apply_patch` into the one `"edit"` permission.
  `Permission.evaluate` uses `findLast`, so **later keys win** — allow-all first, denies after.

## Architecture

```
agent
 ├─ paperclip (remote MCP, OAuth)   search / grep / cat full texts  -> yields a DOI or arXiv id
 ├─ literature (local MCP, ours)    cite(id) -> resolves + WRITES references.bib
 │                                  bib_list() -> read-only view
 └─ edit/write tools                DENIED on references.bib
```

The agent's only path from "a paper I found" to "a citation in the manuscript" runs through
`cite`, and `cite` accepts an **ID**, never BibTeX. Paperclip supplies leads; the resolver
supplies truth.

## literature-mcp

Sits beside `figures-mcp/` and clones its shape: TypeScript, bun in dev, `scripts/build-dist.ts`
producing a node-target `server.mjs` the packaged app runs on its own `electron.exe`
(`ELECTRON_RUN_AS_NODE=1`). Node-compatible APIs only (global `fetch`, `node:fs`, `node:path`) —
nothing bun-specific in `src/`. No new binaries, no Python, no local database. `references.bib`
is the only state.

```
literature-mcp/
  package.json            name "literature-mcp"; bun for dev/test
  tsconfig.json           copy of figures-mcp's
  scripts/build-dist.ts   node-target bundle -> dist/server.mjs
  src/
    server.ts             MCP wiring: 2 tools, zod schemas
    ids.ts                ID parsing/validation (DOI, arXiv, PMID)
    resolve.ts            id -> authoritative BibTeX (per-scheme resolvers)
    bib.ts                key generation, dedupe scan, atomic append
  test/
    ids.test.ts           offline
    bib.test.ts           offline, fixture bib files
    resolve.test.ts       live (needs network)
    dist.test.ts          bundle sanity: no dev paths, speaks MCP under plain node
```

### `cite(workspace, id)`

Resolve one exact ID into `references.bib`. Returns `{key, entry, action}` where `action` is
`"added" | "already-present"`.

Accepted shapes (strict regex; anything else errors with "search with paperclip first, then
cite the DOI or arXiv id it gives you"):

- **DOI** — `10.\d{4,9}/\S+`, also accepting `doi:` and `https://doi.org/` prefixes (stripped)
- **arXiv** — `\d{4}\.\d{4,5}(v\d+)?`, `arXiv:` prefix, and old-style `cs/0501001`
- **PMID** — `\d+` with a required `PMID:`/`pmid:` prefix (a bare integer is ambiguous and is
  rejected)

Resolution per scheme:

- **DOI** → `GET https://doi.org/<doi>` with `Accept: application/x-bibtex`, following
  redirects. Publisher-authoritative; covers Crossref and DataCite.
- **arXiv** → arXiv Atom API. **If the record carries a DOI, resolve that DOI instead** and
  say so in the result, so preprints upgrade to their published version. Otherwise build
  `@misc{..., eprint=..., archivePrefix={arXiv}, primaryClass=...}` from the Atom fields —
  arXiv *is* the authority for an unpublished preprint.
- **PMID** → NCBI E-utilities `efetch`; same DOI-upgrade rule; otherwise build `@article`.

Post-processing:

- **Key** — `<first-author family, lowercased, ASCII-folded><year><first significant title
  word>`, e.g. `khan2026sensitivity`. Stopwords (a/an/the/on/of/for/with/…) skipped.
  Collision with a *different* work → suffix `b`, `c`, …
- **Dedupe** — scan the existing file for the resolved DOI (case-insensitive) and for
  arXiv/PMID ids. Present → return the existing key, `action: "already-present"`, write
  nothing.
- **Write** — create the file with the header
  `% MACHINE-OWNED (literature-mcp). Do not hand-edit — entries are resolved from DOI/arXiv/PMID.`
  if absent, append the entry, atomically (temp file + rename). **Existing bytes are never
  reformatted or re-serialized.**

### `bib_list(workspace)`

Read-only. Tolerant regex scan returning `[{key, title?, doi?, arxiv?, pmid?}]`, so the agent
knows what is already citable before searching. Missing file → empty list, not an error.

### Failure behavior

Resolution failure (malformed id, 404 at doi.org, backend down) → structured error, **nothing
written**. There is no fallback that constructs an entry from search metadata. Errors are
phrased for the agent to surface verbatim: *"Could not resolve 10.1234/nope — citation NOT
added."* Network is required; a clear error beats a stale cache.

## Registration

**Paperclip — identical in both configs, no secret, no tokens to render:**

```jsonc
"paperclip": {
  "type": "remote",
  "url": "https://paperclip.gxl.ai/mcp",
  "enabled": true
}
```

OAuth is on by default (`oauth !== false`). The user connects once; opencode stores and
refreshes the tokens.

**literature-mcp — dev (`paperino-config/opencode.jsonc`):**

```jsonc
"literature": {
  "type": "local",
  "command": ["bun", "C:/Users/azamk/Documents/Paperino/literature-mcp/src/server.ts"],
  "enabled": true
}
```

**literature-mcp — packaged (`opencode.packaged.jsonc`):**

```jsonc
"literature": {
  "type": "local",
  "command": ["{{ELECTRON}}", "{{RESOURCES}}/literature-mcp/server.mjs"],
  "enabled": true,
  "environment": { "ELECTRON_RUN_AS_NODE": "1" }
}
```

Default MCP timeout suffices (calls are seconds, not minutes — unlike paperbanana).

**The permission deny — both configs.** `findLast` semantics mean the deny must come *after*
the allow:

```jsonc
"permission": {
  "edit": { "*": "allow", "references.bib": "deny" }
}
```

Defense in depth: also deny `bash` patterns that redirect into the file
(`"*references.bib*": "ask"`), since a shell append would bypass the edit tool. `ask`, not
`deny` — a legitimate `cat references.bib` should not be blocked, and the prompt makes an
attempted write visible.

## Packaging

`stage-paperino.ts` gains one step, mirroring figures-mcp:

```ts
await $`bun ${join(paperino, "literature-mcp", "scripts", "build-dist.ts")}`.cwd(join(paperino, "literature-mcp"))
cpSync(join(paperino, "literature-mcp", "dist"), join(out, "literature-mcp"), { recursive: true })
```

Paperclip needs no staging at all — it is a URL.

## Onboarding

The wizard (`components/paperino/onboarding-wizard.tsx`) gains a **Connect Paperclip** step
between "sign in with ChatGPT" and the figure key. It does not reimplement OAuth: it calls
the sidecar's `/mcp/paperclip/auth` flow (the same one the MCP UI uses), opening the browser
and awaiting the callback. It is **skippable** — the app is fully usable without it, minus
literature discovery.

Constraint inherited from the wizard's existing bug (see CLAUDE.md): any step calling into
provider/server context must be mounted inside a `ServerSync`/`ServerSDK` subtree, or Solid's
owner-chain resolution throws and the whole app drops into the root ErrorBoundary while the
dialog keeps its last painted frame.

## AGENTS.md changes (shipped agent behavior)

- Rule 2 loses its "until the literature tools are installed" clause.
- New **Citations** section, stating the workflow and the wall:
  - Find papers with **paperclip** (`search`, `lookup`, `grep` — it holds full texts, so read
    the method rather than guessing at it).
  - To cite one, take its **DOI or arXiv id** and call **`cite`**. Never pass BibTeX; there is
    no tool that accepts it, and `references.bib` is not writable by you — a permission denial
    on that path is expected behavior, not a bug to work around.
  - Ambiguous candidates → **ask the user**, do not pick silently.
  - `cite` returning `already-present` → reuse the key it returns.
  - A citation you *remember* is not a citation. Mark `% TODO-CITE <what>` and search.

## Testing

1. **Offline unit** (`ids`, `bib`) — regex accepts/rejects (incl. bare-integer PMID rejected,
   old-style arXiv accepted); key generation with ASCII folding and collision suffixes; dedupe
   scan against fixture bib files; append preserves preceding bytes exactly; header written
   only when absent.
2. **Live integration** (`resolve`, marked "needs network", generous timeouts — the Tectonic
   compile tests are the precedent): a known DOI; an arXiv preprint with no DOI (stays
   `@misc`); an arXiv record that has a published DOI (**must upgrade**); a PMID; a nonsense id
   (**must error and must not write**).
3. **Bundle sanity** (`dist`) — packed `server.mjs` contains no absolute path from the build
   machine (unescape JS-source backslashes before grepping — the jq lesson) and answers MCP
   `initialize` under plain node.

Final verification is against the **running packaged app**, never the suite — every packaging
bug so far passed the tests and failed in the app. The checks: `/mcp` reports `paperclip:
connected` after the OAuth connect and `literature: connected`; an agent turn resolves a real
`% TODO-CITE` end to end; `references.bib` appears with the machine-owned header; citing the
same DOI twice yields `already-present`; **and the agent's own attempt to edit
`references.bib` is denied.**

## Non-goals

- Zotero import (later, if asked: read the local library, re-resolve every entry through its
  DOI before writing — Zotero supplies candidates, the pipeline supplies truth).
- Editing or removing bib entries. Append-only until a real need appears.
- Citation *style*: the `.bib` is style-agnostic; venue templates own style.
- Any fallback search when Paperclip is not connected. If it is not connected, the agent says
  so and asks the user to connect it. A second, worse search path is not worth owning.
