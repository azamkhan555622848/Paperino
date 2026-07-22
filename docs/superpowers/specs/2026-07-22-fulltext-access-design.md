# Full-text access — the OA ladder, institutional fetch, and the paper shelf

**Date:** 2026-07-22
**Status:** approved
**Owner:** Paperino

## What this is

Paperclip finds papers and greps *open* full texts (PMC 7.5M, arXiv 3.0M,
bioRxiv/medRxiv, plus 150M OpenAlex abstracts). What it cannot hand the agent is the
text of a **closed** paper — subscription Nature, Science, Cell, Elsevier/Wiley journals,
IEEE/ACM DL, NEJM/Lancet/JAMA. Today the agent, asked to lean on such a paper's method,
either guesses from the abstract or from memory — both of which product rule 1 forbids.

This feature closes that gap the only ways that are legal, in a ladder from
zero-effort/free to your-credentials-required:

1. **Green OA** — Unpaywall resolves a DOI to the best legally free copy (publisher OA,
   author accepted manuscript in a repository, or a PMC deposit). ~Half of nominally
   paywalled DOIs have one. This is the rung Paperclip does *not* cover.
2. **Preprint** — arXiv / bioRxiv / medRxiv. Most Nature and Science papers have one.
3. **Publisher TDM APIs** — Springer Nature / Elsevier / Wiley text-and-data-mining
   endpoints, keyed to a subscribing institution. Sanctioned bulk full text. Each rung
   lights up only when its key exists; dormant otherwise.
4. **In-app institutional fetch** — an Electron `BrowserWindow` opens the publisher's
   page; you sign in through your university's own SSO once; the app saves the PDF from
   *your* authenticated session. This is you downloading a paper you are entitled to,
   inside the app instead of a separate browser tab. Interactive, one paper at a time.
5. **Manual drop** — you put a PDF into `papers/` however you got it. Total coverage,
   zero legal surface, fully manual.

**What we will not build:** any Sci-Hub / LibGen bridge, or any automated replay of
credentials to scrape behind a paywall. That is infringement, and at scale it gets a
university's IP range blocked by publishers. Every rung here is either free/open, a
sanctioned API, or an interactive action the user takes with their own login.

## Design decisions (from brainstorming)

- **Extend `literature-mcp`, do not add a fourth server.** Citations and full texts are
  one subject — discover, resolve, read. `fulltext`/`paper_list` reuse `ids.ts`, the same
  node-target bundle, the same staging step, the same test harness. A separate
  `fulltext-mcp` would duplicate the id parsers and add a fourth thing to register,
  stage and isolate, for tools that are always used beside `cite`.
- **Per-project `papers/` folder.** PDFs live in the paper workspace, visible in the file
  tree and Preview panel, greppable with existing tools; extracted-text cache in
  `.paperino/`. Travels with the project. (Rejected: a global cross-project store — needs
  an index/dedupe/migration layer and is less transparent. Revisit only if re-fetching the
  same paper across manuscripts becomes a real cost.)
- **TDM is in this build, gated on key presence.** The user chose to include it. Each
  publisher client activates only when its key is in `auth.json`; with no keys the rung is
  skipped silently and the ladder falls through to the institutional fetch. So the build
  does not stall on publisher registration paperwork — the code ships dormant and lights up
  when a key arrives.
- **Institutional fetch is interactive, per paper.** A confirmation each time is exactly
  what keeps this "you downloading a paper you're entitled to" rather than "a bot with your
  cookies" — the latter is what publishers ban and universities get blocked for. Not
  automated, not batched.

## Architecture

```
agent
 ├─ paperclip (remote MCP)     search / grep OPEN full texts        -> a DOI or arXiv id
 ├─ literature (local MCP, ours)
 │    cite(id)          -> resolves + writes references.bib     (unchanged)
 │    bib_list()        -> read-only bib view                   (unchanged)
 │    fulltext(id)      -> runs the ladder, returns a path + version tag   (NEW)
 │    paper_list()      -> what PDFs are on the shelf                       (NEW)
 └─ pdf skill                  extracts text from papers/*.pdf     (already shipped)

Electron main process
 └─ watches .paperino/fetch-request.json  -> opens the institutional-fetch window,
                                             saves PDF into papers/
```

The agent's path from "I need this paper's method" to "I have read it" runs through
`fulltext`. The ladder either returns a file it can read, or a structured
`needs-institutional-fetch` that tells it to offer the in-app fetch or ask for a drop.
It never returns fabricated content, and it never returns abstract text dressed as full
text.

## `fulltext(workspace, id)`

Given a DOI, arXiv id or PMID (parsed by the existing `ids.ts`), walk the ladder — **first
hit wins**:

1. **Shelf** — already in `papers/`? Dedupe by resolved DOI (same discipline as `cite`).
   Return its path + stored version tag. No network.
2. **Unpaywall** — `GET https://api.unpaywall.org/v2/<doi>?email=<configured>`. If
   `is_oa`, take `best_oa_location.url_for_pdf` (fall back to `.url`), download it into
   `papers/`. Version tag from `host_type`/`version`:
   `publishedVersion → version-of-record`, `acceptedVersion → accepted-manuscript`,
   `submittedVersion → preprint`.
3. **Preprint** — if the id *is* an arXiv id, or Crossref/arXiv relations expose a
   preprint (arXiv / bioRxiv / medRxiv), download that PDF, tag `preprint`.
4. **TDM** — resolve the DOI's publisher (Crossref `member`/prefix → one of the three
   clients). If that client has a key in `auth.json`, fetch full text through its API and
   save; tag `version-of-record`. No key → skip this rung silently.
5. **Paywalled** — return
   `{ status: "needs-institutional-fetch", doi, publisher, url }`. **Nothing written.**
   The agent surfaces this: offer the in-app institutional fetch, or ask the user to drop
   the PDF.

Every non-terminal return is `{ status: "have", path, version, source }` where `source ∈
{shelf, unpaywall, preprint, tdm}` and `version ∈ {version-of-record,
accepted-manuscript, preprint}`. The **version tag is load-bearing**: an accepted
manuscript can differ from the published version in pagination and wording, so the agent
must state which it read. `abstract-only` is *never* a `fulltext` return — the agent gets
an abstract only from paperclip, and knows it is an abstract.

Failure (network down, malformed id, Unpaywall 404 with no other rung) → structured error,
nothing written, phrased for the agent to surface verbatim.

## `paper_list(workspace)`

Read-only. Scans `papers/` and its sidecar index, returning
`[{ path, doi?, title?, version, addedBy }]` where `addedBy ∈ {unpaywall, preprint, tdm,
institutional, manual-drop}` and `version ∈ {version-of-record, accepted-manuscript,
preprint, unknown}` — `unknown` is reachable only for a manually dropped PDF with no index
entry, and never from `fulltext`, whose three tags are always known. Missing folder → empty
list, not an error. Lets the agent know what is already readable before running the ladder
again.

## The paper shelf

- `papers/` — the PDFs. Named `<citekey-if-known-else-doi-slug>.pdf`.
- `papers/.index.json` — one small JSON mapping filename → `{doi, version, addedBy,
  title?}`, written atomically (temp + rename), append/update only. A manually dropped PDF
  with no index entry still lists (via `paper_list`) with `addedBy: manual-drop` and
  `version: unknown`; the agent is told to treat an unknown-version drop as authoritative
  only if the user says so.
- **Extraction stays in the pdf skill** — no PDF parsing in the MCP. The MCP moves and
  indexes bytes; the agent reads them with pypdfium2 as it already does.
- **`classifyChange` must ignore `papers/**`.** `SOURCE_RE` matches `.pdf` on purpose
  (Figure Studio emits figure PDFs), so without this rule every fetched paper reads as a
  source edit and retriggers the compile — the exact failure mode already documented for
  the emitted `main.pdf`. Add `papers/` to the ignore set beside the emitted-PDF rule.

## In-app institutional fetch (Electron main)

The one rung that cannot live in an MCP: only the main process can open a login window.

- **Trigger.** `fulltext` returning `needs-institutional-fetch` does *not* itself open a
  window (an MCP call must not block on a human). The agent, seeing that status, tells the
  user and — on their go-ahead — the app initiates the fetch. Mechanically: the MCP writes
  `.paperino/fetch-request.json` (`{doi, url, publisher, requestedAt}`); the main process
  already watches the workspace, picks it up, and shows the fetch prompt.
- **Window.** A `BrowserWindow` with `partition: "persist:institution"` opened at the
  publisher's DOI landing page (`https://doi.org/<doi>`). The user signs in through their
  university SSO / library proxy *inside that window*. Credentials flow
  publisher↔university; **we store nothing but the session cookies in the persistent
  partition** (isolated in userData like every other Paperino store).
- **Capture.** When the PDF is shown, a "Save to papers/" action captures it via
  `session.on("will-download")` / `webContents.downloadURL`, writing
  `papers/<slug>.pdf` and an index entry `addedBy: institutional`,
  `version: version-of-record`.
- **Login-once.** The partition persists, so subsequent papers from the same publisher are
  ~one click. Still one confirmation per paper — never a loop over a list.
- **Response path.** No new IPC surface: the PDF appears in `papers/`, the agent re-calls
  `fulltext`, rung 1 (shelf) hits. The `.paperino/fetch-request.json` is deleted once
  handled.

## TDM keys

- Stored in the same `auth.json` the figure key uses (honoring `XDG_DATA_HOME`, so a
  packaged build reads its own isolated store), under provider ids `tdm-springer`,
  `tdm-elsevier`, `tdm-wiley`.
- Entered via a small **Full-text access** settings surface, reusing the same
  `serverSDK().client` auth-write path the wizard's figure-key step uses. **Never** written
  into a config file or baked into the installer — `dist.test.ts`'s leaked-key grep covers
  this exactly as it does the figure key and the old `X-API-Key` rule.
- Publisher → client mapping lives in `src/tdm.ts`, matched from the Crossref member id /
  DOI prefix. Unknown publisher → rung skipped.
- Each client is a thin fetcher: Springer Nature `api.springernature.com` (`openaccess` +
  `meta/v2` for TDM), Elsevier `api.elsevier.com/content/article/doi/<doi>`
  (`X-ELS-APIKey`, institutional token), Wiley TDM
  `onlinelibrary.wiley.com/doi/pdf/<doi>` with the Wiley-Clarivate TDM token. All read the
  key from `auth.json` at call time; none hardcode an endpoint key.

## AGENTS.md changes (shipped agent behavior)

New **Reading papers** section, after **Citations**:

- To read a paper's actual method rather than guess it, call **`fulltext(workspace, id)`**.
  It returns a PDF path and a **version tag**.
- **Always state which version you read** — version of record, accepted manuscript, or
  preprint. An accepted manuscript can differ from the published paper; do not present one
  as the other.
- **`needs-institutional-fetch`** → tell the user the paper is paywalled, name the
  publisher, and offer the in-app institutional fetch or ask them to drop the PDF into
  `papers/`. Do **not** summarize the abstract as though you read the paper.
- `paper_list` tells you what is already on the shelf; check it before re-fetching.
- This never touches `references.bib`. Reading a paper and citing it are separate; you
  still cite by identifier through `cite`.

Rule 1 gains a clause: *reading* is grounded too — a claim about what a paper did must come
from its text (via `fulltext`/`paperclip`), not its abstract or your memory.

## Registration & packaging

- **No new server** — `literature` already registered in both configs. The two new tools
  ship inside its existing bundle. `stage-paperino.ts` unchanged (the literature dist block
  already copies the whole `dist/`).
- **Unpaywall email** — Unpaywall requires an identifying email on every call (it is a
  politeness header, not a credential; no key, no secret, no signup). Resolution order:
  `PAPERINO_UNPAYWALL_EMAIL` env var → `unpaywall_email:` in the workspace `paperino.yaml`
  → the constant `paperino@users.noreply.github.com`. Never a hardcoded personal address —
  that is the jq-path lesson: a value true on exactly one machine must not ship in an
  artifact.
- **Electron fetch window** lives in `src/main/paperino/` beside the other main-process
  Paperino code; wired to the existing workspace watcher.

## Testing

**Offline unit** (`ladder`, `tdm`, `shelf`):
- ladder ordering (shelf → unpaywall → preprint → tdm → needs-fetch), each rung mockable;
- publisher matching from Crossref member/prefix;
- dedupe by resolved DOI;
- version-tag mapping from Unpaywall fields;
- `fetch-request.json` and `.index.json` schemas; atomic index write preserves prior
  entries.

**Live** (network-marked, generous timeouts — Tectonic-compile precedent):
- a known green-OA DOI resolves via Unpaywall and downloads a PDF;
- a preprint-only arXiv id downloads and tags `preprint`;
- a paywalled DOI **with no TDM keys** returns `needs-institutional-fetch` and writes
  nothing.

**TDM** — fixture-based (recorded responses) since live needs the user's keys. Live TDM
verification waits for a real key.

**Bundle sanity** — `dist.test.ts` already greps for leaked absolute paths and keys; extend
it to assert no `tdm-*` key literal is present in the bundle.

**Final verification in the running packaged app**, never the suite (every packaging bug so
far passed tests and failed in the app): `fulltext` on a green-OA DOI puts a PDF in
`papers/`; a paywalled DOI triggers the institutional-fetch window, SSO login saves the PDF,
and the agent then reads it and states the version; `classifyChange` does **not** recompile
when a paper lands in `papers/`.

## Non-goals

- **No pirate sources.** Ever. Not a fallback, not a toggle.
- **No batch/bulk fetch.** The institutional rung is one paper per confirmation, by design.
- **No global cross-project library** (deferred; per-project `papers/` for now).
- **No PDF parsing in the MCP** — the pdf skill owns extraction.
- **No OCR** — inherited from the pdf skill's stated limitation.
- **No new remote server or OAuth** — TDM is API-key, the institutional rung is the user's
  own browser session.
