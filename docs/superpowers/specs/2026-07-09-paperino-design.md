# Paperino — Agentic Desktop App for Top-Venue Research Paper Writing

**Date:** 2026-07-09
**Status:** Approved umbrella design (each sub-project gets its own plan)
**Location:** `C:\Users\azamk\Documents\Paperino\`

## 1. Purpose

Paperino is a desktop app — an OpenCode fork, in the InteJer/TISS/CutAI lineage — for
writing research papers of submission quality for top venues (Nature family, top CS
conferences, top medical journals, IEEE/ACM journals). The user chats with agents on the
left; the right panel live-previews the compiled manuscript PDF (Claude-Desktop-artifact
style).

**Scope decisions (locked):**

- **Chassis:** opencode-dev fork with one UI addition (Paper Preview panel). No other UI changes in v1.
- **Native format:** LaTeX. The preview always shows the real compiled PDF — camera-ready is what you see.
- **v1 capabilities:** drafting engine, literature search + verified citations, figure generation (PaperBanana), venue-matched reviewer/critic passes.
- **Input model:** real research artifacts only. Agents ground all scientific content in user-provided materials; Paperino contributes structure and prose craft, never invented results.
- **Distribution:** personal tool first. Dev-mode launch (`paperino-dev.cmd`), local Python/uv and Tectonic installs are acceptable. Productization is out of scope for v1.
- **Models:** OpenRouter for everything (text agents and PaperBanana image generation) — one key.
- **Venues in v1:** Nature family, NeurIPS/ICML/ICLR/ACL, NEJM/Lancet/JAMA, IEEE/ACM journals.

**Known constraint:** PaperBanana's README notes Google has filed patents on its workflows
and restricts third-party *commercial* applications. Acceptable for a personal research
tool; must be revisited before any commercial distribution. PaperBanana sits behind an MCP
interface so it is swappable.

## 2. Architecture

```
Paperino (opencode-dev fork, branded)
├─ Chassis change #1: Paper Preview panel (right side)
│    watches main.tex + sections/ → debounced Tectonic compile → pdf.js render
│    compile errors in panel footer (never modal)
├─ Launch: paperino-dev.cmd  (OPENCODE_CONFIG=paperino.jsonc — proven TISS/CutAI pattern;
│    other projects' MCP servers stay disabled)
└─ paperino.jsonc registers:
     • literature-mcp   (TypeScript stdio server)
     • paperbanana-mcp  (thin Python stdio wrapper, runs via uv)
     • writing/critic pack (markdown agents, commands, venue profiles — no code)
```

### Paper workspace convention

One folder per paper, scaffolded by `/new-paper`:

```
my-paper/
├─ paperino.yaml        # venue family, stage (drafting|revision), title
├─ main.tex             # venue template; \input's sections
├─ sections/            # 01-abstract.tex … 06-discussion.tex — what agents edit
├─ figures/             # PaperBanana outputs + user-supplied figures
├─ references.bib       # machine-owned: written ONLY by literature-mcp
└─ artifacts/           # user's raw inputs (results, data, notes, code) — read-only ground truth
```

### Grounding rules (integrity by construction)

1. **Artifacts are the only source of scientific claims.** Drafting agents' instructions
   forbid inventing results; every quantitative/empirical statement must trace to
   `artifacts/`.
2. **`references.bib` is machine-owned.** Only literature-mcp's `add_citation` writes to
   it, and that tool only accepts entries resolved from a real DOI/arXiv ID/PMID.
   Hallucinated citations are structurally impossible, not merely discouraged.

### Data flow

User chats → agents read `artifacts/`, edit `sections/*.tex`, call MCP tools for
citations/figures → file watcher triggers debounced Tectonic recompile → preview panel
updates. Compile log is exposed to agents (via a `compile_status` artifact/tool) so they
can self-fix LaTeX errors.

## 3. Components

### 3.1 literature-mcp (TypeScript stdio MCP server)

| Tool | Behavior |
|---|---|
| `search_literature` | Queries Semantic Scholar + arXiv + PubMed (venue-appropriate mix); returns title/authors/year/abstract/DOI + citation counts |
| `get_paper` | Full metadata + abstract (+ open-access PDF link when available) |
| `add_citation` | Resolves DOI/arXiv/PMID → canonical BibTeX (Crossref/ADS), dedupes, appends to `references.bib`, returns cite key |
| `check_citations` | Audits manuscript: every `\cite{}` has an entry, every entry resolves, flags retracted papers (Crossref retraction data) |

Free API tiers suffice for personal use; optional Semantic Scholar key raises rate limits.

### 3.2 paperbanana-mcp (Python stdio wrapper over PaperBanana-main)

- `generate_figure(method_text, caption, aspect_ratio, mode)` — runs the existing
  Retriever→Planner→Stylist→Visualizer→Critic pipeline via OpenRouter; saves winner +
  candidates into `figures/`; returns paths for `\includegraphics`.
- `refine_figure(image_path, instructions)` — wraps refine/upscale (2K/4K print quality).
- No changes to PaperBanana internals; call its Python API as `demo.py` does. Runs in its
  own uv-managed venv. Long runs stream MCP progress notifications.

### 3.3 Writing + critic pack (pure markdown)

- **Venue profiles** (`venues/<family>/`): LaTeX template + structured constraints
  (word/page limits, abstract style, section order, reporting checklists —
  CONSORT/STROBE for medical) + the venue's actual review criteria.
- **Drafting agents:** outline agent first (paper story from `artifacts/` + venue
  structure; user approves before prose), then per-section writer agents that cite via
  `add_citation` while writing. Never whole-paper single-shot generation.
- **Critic personas:** `/review` runs venue-matched reviewers (NeurIPS reviewer:
  soundness/presentation/contribution + weaknesses; Nature editor: significance/breadth
  triage; NEJM statistical reviewer: checklist-driven). Output = review report +
  prioritized revision list. `/revise` executes the list. Iterate until scores plateau.

### 3.4 Chassis: Paper Preview panel

- Right-side panel in the opencode desktop UI; watches the active workspace's `.tex`
  files; debounced compile via **Tectonic** (single binary, auto-fetches packages,
  Windows-friendly); renders output PDF with pdf.js.
- Compile failure → keep last good PDF, show parsed error (file:line) in panel footer.
- UI framework/panel mechanics verified against the actual opencode-dev source at
  planning time (CutAI/TISS panel experience applies).

## 4. Error handling

- **LaTeX compile fails:** last good PDF stays; parsed Tectonic error in footer; agents
  read the compile log and self-fix. No blocking dialogs.
- **Literature APIs down/rate-limited:** typed errors with retry-after; `add_citation`
  never writes unverified entries — agent parks the spot as `% TODO-CITE`.
- **PaperBanana failures** (refusals, OpenRouter hiccups): wrapper returns the pipeline's
  own error + any successful intermediate candidates; progress streamed during long runs.
- **Windows realities (from prior forks):** no `{env:PATH}` in jsonc config; `.env` does
  not reach the sidecar — pass keys explicitly in server env blocks; clean up orphan
  processes on restart (they lock the binary).

## 5. Testing

- **literature-mcp:** unit tests on recorded API fixtures; live smoke: search →
  `add_citation` → BibTeX that Tectonic/bibtex accepts.
- **paperbanana-mcp:** end-to-end smoke: tiny method text → figure file exists in `figures/`.
- **Chassis preview:** fixture paper must compile; manual verification via WebView2 CDP
  screenshot method.
- **System acceptance test:** one real mini-paper from a real artifact set (e.g. a
  MedXpertQA eval run) through outline → draft → figures → `/review` → revision. This is
  the "does Paperino actually write a paper" gate for v1.

## 6. Build order — four sub-projects

Each gets its own spec→plan→implement cycle; each is independently useful when it lands.

1. **Chassis** — fork/rebrand, `paperino-dev.cmd` + `paperino.jsonc`, workspace
   convention + `/new-paper`, Paper Preview panel.
   *Exit: edit a .tex file → PDF updates in-pane.*
2. **literature-mcp** — the four tools above.
   *Exit: agent drafts a related-work paragraph with 5 real, verified citations.*
3. **paperbanana-mcp** — figure tools wired to OpenRouter.
   *Exit: agent generates a method diagram into a manuscript.*
4. **Writing + critic pack** — 4 venue families, drafting agents, `/review` + `/revise`.
   *Exit: system acceptance test (Section 5).*
