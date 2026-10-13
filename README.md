# Paperino

An agentic desktop app for writing research papers of submission quality for top venues —
the Nature family, NeurIPS / ICML / ICLR / ACL, NEJM / Lancet / JAMA, IEEE / ACM.

Paperino is a fork of the [opencode](https://github.com/anomalyco/opencode) desktop app
(Electron). It adds one UI surface, a **Preview** panel that live-compiles your LaTeX, and
a set of MCP servers that give the agent literature, figure and table capabilities.

## The guiding constraint

**The agent never invents results.** Numbers come from `artifacts/`. Citations come from
resolved DOIs. Wherever possible this is enforced by structure (lint rules, files the agent
is not allowed to write) rather than by asking the model nicely.

1. Agents never invent results, numbers, datasets or outcomes. When material is missing,
   the agent asks a question instead of filling the gap with plausible fiction.
2. `references.bib` is machine-owned. Citations come only from a resolved DOI, arXiv id or
   PMID, and the agent's edit permission on that file is denied.
3. When you ask to *see* a document, you get a PDF in the Preview panel, not a summary.
4. When you ask for a figure, the agent offers both figure pipelines and waits for you to
   pick one.

## What's in it

| Component | What it does |
|---|---|
| **Preview panel** | Watches the workspace and recompiles the root `.tex` with [Tectonic](https://tectonic-typesetting.github.io/) on every save, rendering the PDF with pdf.js. It also has a file tree that previews PDFs, images, `.docx` and text files. |
| **`figures-mcp`** — Figure Studio | Code-authored vector figures. There are two engines: `html` for schematics and tables, and `mpl` (matplotlib) for charts. Both render to an SVG measured in Chromium. A deterministic lint then checks text overlap, type size, contrast, fonts and stroke weight. It also checks **number provenance**, so a value that isn't in `data.json` fails the figure. After the lint, the chat model runs a vision review. Fonts and print widths follow the venue named in `paperino.yaml`. Tools: `figure_scaffold`, `figure_render`, `figure_lint`, `figure_review`, `data_query`. |
| **`paperbanana-mcp`** | Wraps the [PaperBanana](https://github.com/dwzhu-pku/PaperBanana) Planner → Stylist → Visualizer → Critic pipeline for image-generated (raster) figures. The figures are raster images, so nothing lints their numbers, and the agent says so when it offers this pipeline. |
| **`literature-mcp`** | Owns `references.bib`. `cite` takes an identifier only (DOI, arXiv id or `pmid:`), resolves it, upgrades preprints to their published DOI and dedupes on the resolved DOI. `fulltext` fetches legal full text through a fixed ladder: shelf → Unpaywall → arXiv → publisher TDM → your own institutional login. There are no pirate sources. Tools: `cite`, `bib_list`, `fulltext`, `paper_list`. Discovery goes through the remote Paperclip MCP (OAuth). |
| **Office skills** | xlsx / docx / pdf skills ported to Windows. Excel and Word run over COM; PDFs are handled with pypdf and pypdfium2. |
| **Onboarding** | A first-run wizard with a feature tour. It signs you in with a ChatGPT subscription, connects Paperclip, and sets the figure-generation key (OpenRouter or Google). |

## Repository layout

```
opencode-dev/
  paperino-config/     The shipped agent: AGENTS.md (its system prompt), opencode.jsonc
                       (MCP registration + permission wall), /new-paper command, skills
  paperino-dev.cmd     Dev launcher
  packages/…           Only the files Paperino modifies in the opencode fork
figures-mcp/           Figure Studio MCP server (TypeScript, bun)
literature-mcp/        Citation + full-text MCP server (TypeScript, bun)
paperbanana-mcp/       PaperBanana wrapper (Python 3.12)
fixtures/              demo-paper (LaTeX workspace for acceptance tests), plain-project
brand/                 The "Fold" mark and icon generation
docs/superpowers/      Design specs and implementation plans, one per subsystem
CLAUDE.md              Engineering notes: build invariants and the traps behind them
```

> **This repository is not a complete, buildable app on its own.** It contains Paperino's
> own code plus the opencode files it modifies. The upstream opencode monorepo it is
> overlaid on is not included. The same goes for the pinned Tectonic and jq binaries
> (`tools/`, gitignored) and the PaperBanana source checkout.

## Running (Windows, development)

Put the files here over a checkout of the opencode monorepo. Then install dependencies,
place Tectonic and jq under `tools/`, and launch with:

```bat
opencode-dev\paperino-dev.cmd
```

Use the wrapper, never plain `bun run dev:desktop`. It sets `OPENCODE_CONFIG_DIR`, which
selects the paper-writing agent, and `PAPERINO_TECTONIC`, which the Preview panel compiles
with. Note that the launcher currently hard-codes local paths. Build the office-skill
Python environment once with `paperino-config\skill\setup.cmd`.

Tests:

```bat
cd figures-mcp    && bun test
cd literature-mcp && bun test
```

## Packaging

From `opencode-dev/packages/desktop`:

```bat
set OPENCODE_CHANNEL=prod
bun run prebuild && bun run build && bun run package:win
```

This produces a one-click NSIS installer, `dist/paperino-win-x64.exe`. The installer does
not bundle Chromium or a Python runtime; first-run setup downloads both into the app's
user-data folder.

## Before changing a subsystem

Read its spec in `docs/superpowers/specs/` and the matching section of `CLAUDE.md`. The
specs record which decisions are locked and why. Many of the notes in `CLAUDE.md` describe
failures that passed every test and only showed up in the running app.
