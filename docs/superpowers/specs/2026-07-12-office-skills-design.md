# Office-file skills: xlsx, docx, pdf

**Date:** 2026-07-12
**Status:** Implemented (2026-07-12, branch `feat/paperino`)
**Owner:** `opencode-dev/paperino-config/skill/`, `tools/pyoffice/`

## Problem

Paperino's agent has no instructions for handling the three file types a paper author
actually arrives with: spreadsheets of results, Word manuscripts from co-authors and
journals, and PDFs (references, supplementary material, submission bundles). Today it
improvises — which is exactly the behaviour the product's first rule forbids.

The user supplied Anthropic's official `xlsx`, `docx` and `pdf` skills and asked that the
agent follow them whenever it touches such a file.

## Why they cannot be vendored verbatim

Those skills were written for Anthropic's **Linux sandbox**. Probed on this machine:

| The skills call | Present |
|---|---|
| pandas, pypdf, pdfplumber, python-docx, node/npm | yes |
| LibreOffice (`soffice`) — formula recalc, `.doc`→`.docx`, `.docx`→PDF | **no** |
| pandoc, qpdf, pdftk, pdftoppm, pdfimages, tesseract | **no** |
| openpyxl, reportlab | **no** |
| bundled `scripts/recalc.py`, `scripts/comment.py`, `scripts/office/soffice.py`, `REFERENCE.md`, `FORMS.md` | **no** — only the three `SKILL.md` bodies were supplied |

Vendored as-is, the first `python scripts/recalc.py` or `pandoc -t markdown` call fails.
A skill that breaks on first use is worse than no skill.

## Decisions (locked)

1. **Real skills, not prose in `AGENTS.md`.** The fork already has a skills subsystem:
   `discoverSkills()` scans every config directory for `{skill,skills}/**/SKILL.md`
   (`skill/index.ts:207`), and `ConfigPaths.directories()` includes `OPENCODE_CONFIG_DIR`
   (`config/paths.ts:39`) — which `paperino-dev.cmd` points at `paperino-config/`. So a
   `SKILL.md` dropped in is auto-discovered, advertised in the system prompt as
   `<available_skills>` (`session/system.ts:99-106`), and loadable by the `skill` tool.
   The tool appends `Base directory for this skill: <dir>`, so relative `scripts/…` paths
   in a skill body resolve. `permission.skill` already allows `*`.

2. **Keep the judgement, swap the toolchain.** Every quality rule survives verbatim — zero
   formula errors, blue-input/black-formula colour coding, formulas-never-hardcodes,
   template preservation, the docx-js footguns, the ReportLab Unicode-subscript trap. Only
   the *engine* changes, to what exists on Windows:

   | Skill wants | Paperino uses | Note |
   |---|---|---|
   | LibreOffice recalc | **Excel COM** | the real Excel engine — strictly more faithful than LibreOffice |
   | `soffice --convert-to pdf/docx` | **Word COM** | `AGENTS.md` already converts this way |
   | `pandoc -t markdown file.docx` | python-docx | |
   | `qpdf`, `pdftk` | **pypdf** | merge, split, rotate, encrypt, watermark |
   | `pdftoppm`, `pdfimages` | **pypdfium2** | pip wheel, no system binary |
   | `scripts/comment.py` (6 cross-linked XML files) | **Word COM** `Comments.Add` | |
   | `tesseract` OCR | *unsupported* | stated plainly in the skill; the agent must say so, not fake it |

   Anthropic's documented JSON contract for `recalc.py` is preserved exactly, so the skill
   body still describes what the script prints.

3. **The referenced scripts get written, not left dangling.** `xlsx/scripts/recalc.py`,
   `docx/scripts/word.py`, `pdf/scripts/render.py`, `pdf/FORMS.md`.

4. **A dedicated venv, not the global interpreter.** `tools/pyoffice/.venv`, mirroring
   `paperbanana-mcp`'s own venv. `paperino-dev.cmd` prepends its `Scripts/` to `PATH` and
   exports `PAPERINO_PYTHON`, so a bare `python` inside the app *is* the skill venv and the
   skill bodies stay clean. `tools/` is gitignored (like Tectonic and jq), so the venv is
   not in version control: `skill/requirements.txt` + `skill/setup.cmd` are tracked instead
   and rebuild it. Neither MCP server is affected — `paperbanana` invokes its own Python by
   absolute path and `figures` runs on bun.

5. **Paperino's product rules override the skills.** Each skill carries a short preamble:
   - `artifacts/` is **read-only ground truth** — never edit a file in place there; copy it
     out first. (The stock skills happily edit in place; on `artifacts/` that would destroy
     the user's raw data.)
   - Numbers extracted from a spreadsheet or PDF are *data*, not licence to invent: the
     never-fabricate rule still holds.
   - To *show* the user a file, use the Preview panel — the file tree renders pdf/docx/
     image/text directly, and `.paperino/preview.pdf` is the agent's push channel. Do not
     answer a "show me" with a summary.

## Layout

```
opencode-dev/paperino-config/skill/
  requirements.txt          pinned deps for the venv
  setup.cmd                 creates tools/pyoffice/.venv and installs them
  xlsx/SKILL.md   + scripts/recalc.py     Excel COM recalc + error scan → JSON
  docx/SKILL.md   + scripts/word.py       convert | accept-changes | comment | extract-text
  pdf/SKILL.md    + scripts/render.py     rasterize pages via pypdfium2
                  + FORMS.md              AcroForm filling with pypdf
tools/pyoffice/.venv/                     gitignored
```

## Testing

- **Unit-ish, live:** round-trip each script against a real fixture — an `.xlsx` carrying a
  good formula *and* a deliberate `#DIV/0!` (recalc must report both `total_formulas` and
  the error's sheet/cell); a `.docx` → PDF; a PDF → PNG.
- **Discovery:** `opencode debug skill` with `OPENCODE_CONFIG_DIR=paperino-config` must list
  `xlsx`, `docx`, `pdf` with their descriptions and no duplicate-name warnings.
- **Live in the app:** ask the running agent to touch a spreadsheet and confirm it loads the
  skill rather than improvising. Rule of this repo: verify against the running app.

## Out of scope

- OCR (needs a tesseract binary; the skill says so instead of pretending).
- Google Sheets / Docs.
- Replacing the Preview panel's own docx renderer (mammoth) — that is read-only viewing and
  is unrelated to authoring.
