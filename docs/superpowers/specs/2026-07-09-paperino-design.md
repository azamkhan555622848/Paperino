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
- **Models:** OpenRouter for everything — one key. Two independent tiers:
  - **Chat/writing model: the user's choice**, picked in the app's model picker at any time.
  - **Figure generation: pinned, not user-selectable.** `paperbanana-mcp` always calls
    "Nano Banana" (`google/gemini-3.1-flash-image-preview`) for image synthesis, whatever
    the chat model is. Figures must not silently change quality because the user switched
    chat models.
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
├─ artifacts/           # user's raw inputs (results, data, notes, code) — read-only ground truth
└─ .paperino/           # build output (gitignored). compile.log + main.pdf are generated;
                        # preview.pdf is written by the agent to show a non-LaTeX document
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

**Models are pinned by the server, never inherited from the chat session.** PaperBanana
resolves models from `MAIN_MODEL_NAME` / `IMAGE_GEN_MODEL_NAME` and its key from
`OPENROUTER_API_KEY` (`utils/config.py:64-76`, `utils/generation_utils.py:98-102`), so the
MCP server sets all three in its own `environment` block — no PaperBanana code changes:

| Role | Model | Why |
|---|---|---|
| Image synthesis (Visualizer, refine/upscale) | `google/gemini-3.1-flash-image-preview` ("Nano Banana") | Pinned per product decision; verified present on OpenRouter with `output_modalities: [image, text]` |
| Pipeline VLM (Retriever, Planner, Stylist, **Critic**) | `google/gemini-3.5-flash` (override: `PAPERINO_FIGURE_VLM`) | The Critic must *see* the rendered candidate, so this must accept image input (`input_modalities` includes `image`) |

The chat model the user selects has no effect on either. Conversely, figure generation
never consumes the chat session's model budget or context.

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

### 3.4 Chassis: Preview panel

Right-side panel in the opencode desktop UI, titled **"Preview"**. It is **always
present**, in every project, and always shows a PDF. It renders whichever source
changed last:

1. **Compiled manuscript** — watches the workspace's `.tex`/`.bib`/`figures` and does a
   debounced compile via **Tectonic** (single binary, auto-fetches packages,
   Windows-friendly); renders the output PDF with pdf.js.
2. **`.paperino/preview.pdf`** — any PDF the agent drops there is shown as-is, with no
   compile step. This is how a non-LaTeX document reaches the panel (an existing `.docx`
   draft, a downloaded paper). `.paperino/` is otherwise build output and ignored by the
   watcher, so compiling can never retrigger itself.

States: `empty` (neither source available — panel explains how to fill it), `compiling`,
`ok`, `error`. Compile failure → keep last good PDF, show parsed error (file:line) in the
footer.

**The panel is the answer to "show me the paper".** `AGENTS.md` instructs the agent to put
the document on screen rather than paste a summary into chat: copy a PDF, or convert a
`.docx` (Word COM on Windows, LibreOffice otherwise) straight to `.paperino/preview.pdf`.

Because the watcher re-checks `isPaperWorkspace` on every source change, a plain project
that gains a `main.tex` mid-session (via `/new-paper`) starts live-compiling with no
restart.

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
3. **figures-mcp (Figure Studio)** — code-authored HTML/CSS/SVG figures with the
   render→lint→review loop; see `2026-07-09-figure-studio-design.md`. **Supersedes
   paperbanana-mcp at this position** — PaperBanana moves to the backlog as an optional
   pictorial add-on (its tool contracts and pinned-model policy in §3.2 stay recorded
   for that eventual add-on).
   *Exit: both Anthropic reference figures reproduced lint-clean + one data-bound table,
   all `\includegraphics`-ed into the demo paper.*
4. **Writing + critic pack** — 4 venue families, drafting agents, `/review` + `/revise`.
   *Exit: system acceptance test (Section 5).*
