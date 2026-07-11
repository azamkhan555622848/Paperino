---
name: docx
description: "Use this skill whenever the user wants to create, read, edit, or manipulate Word documents (.docx files) or Word templates (.dotx files). Triggers include: any mention of 'Word doc', 'word document', '.docx', '.dotx', or requests to produce professional documents with formatting like tables of contents, headings, page numbers, or letterheads. Also use when extracting or reorganizing content from .docx or .dotx files, inserting or replacing images in documents, performing find-and-replace in Word files, working with tracked changes or comments, or converting content into a polished Word document. If the user asks for a 'report', 'memo', 'letter', 'template', or similar deliverable as a Word or .docx file, use this skill. Do NOT use for PDFs, spreadsheets, Google Docs, or general coding tasks unrelated to document generation."
license: Proprietary (Anthropic). Adapted for Paperino on Windows; see the upstream skill for complete terms.
---

# Paperino rules — these override everything below

1. **`artifacts/` is read-only ground truth.** Never edit a document in `artifacts/` in
   place. Copy it out and work on the copy.
2. **The manuscript is LaTeX.** A `.docx` is what you produce *for* someone — a co-author who
   works in Word, a journal that demands Word at submission — or what you *receive* from
   them. Converting the paper to Word is an export step; it is not where the paper lives.
   Never rewrite `sections/*.tex` prose into a Word file and treat that as the source.
3. **Asked to *see* a document, put it on screen.** The user can click any `.docx` in the
   Preview panel's file tree. If they want it as a PDF, convert it straight to
   `.paperino/preview.pdf`. Do not answer a "show me" with a summary.
4. **Never invent content to fill a document.** The same rule as everywhere else: missing
   material is a question, not a gap to paper over.

# Environment (Windows)

`python` inside Paperino is the skill venv (`tools/pyoffice/.venv`, also `$PAPERINO_PYTHON`),
carrying **python-docx** and **pywin32**.

**Word is installed and driven over COM.** There is no LibreOffice, no pandoc, no `pdftoppm`
here — `scripts/word.py` replaces all three, and does the job with the real Word engine.

If a script fails with `ModuleNotFoundError`, run
`opencode-dev\paperino-config\skill\setup.cmd` once and say so.

# Choosing an approach

A `.docx` is a ZIP archive of XML. Pick by task:

| Task | Approach |
|---|---|
| **Read** content | `python scripts/word.py extract-text file.docx` (no Word launched for `.docx`) |
| **Create** a new document | **python-docx** — see below. No `npm install`, and it can reopen its own output |
| **Edit** an existing document | **python-docx** for text, tables, styles and images |
| Edit what python-docx cannot express | `unzip` → edit `word/document.xml` → `zip` (tracked changes, exotic fields) |
| **Convert** `.doc`→`.docx`, anything→PDF | `python scripts/word.py convert in.docx out.pdf` |
| **Accept tracked changes** | `python scripts/word.py accept-changes in.docx out.docx` |
| **Comments** | `python scripts/word.py comment file.docx "text" --anchor "phrase"` |
| **Verify the result** | convert to PDF, rasterize, and *look* — see below |

> Relative paths (`scripts/…`) are relative to this skill's base directory, which the skill
> tool prints when it loads this file.

## Creating with python-docx

```python
from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()
doc.add_heading("Results", level=1)          # built-in heading styles feed the TOC

p = doc.add_paragraph("Accuracy improved by ")
p.add_run("4.2 points").bold = True          # a run, not a "\n" — see the footguns below

doc.add_paragraph("First point", style="List Bullet")
doc.add_paragraph("Second point", style="List Bullet")

table = doc.add_table(rows=1, cols=2)
table.style = "Table Grid"                   # without a style the table has NO borders
head = table.rows[0].cells
head[0].text, head[1].text = "metric", "value"
row = table.add_row().cells
row[0].text, row[1].text = "accuracy", "0.942"

doc.add_page_break()
doc.save("report.docx")
```

Editing works the same way — `Document("existing.docx")`, mutate, `save()`. Unlike docx-js,
python-docx can open a file it did not create, which is why it is the default here.

## Verify the output — always look at it

A Word file you have not rendered is a file you have not checked.

```bash
python scripts/word.py convert report.docx report.pdf
python ../pdf/scripts/render.py report.pdf --out pages --dpi 100
# then Read pages/page-1.png and actually look
```

To put it in front of the user instead, convert straight into the panel:

```bash
python scripts/word.py convert report.docx .paperino/preview.pdf
```

## Tracked changes and comments

`scripts/word.py` handles both through Word itself:

```bash
python scripts/word.py accept-changes draft.docx clean.docx      # prints revisions_accepted
python scripts/word.py comment draft.docx "Needs a citation." --anchor "This run is bold"
python scripts/word.py comment draft.docx "General note."        # no anchor -> first paragraph
```

An `--anchor` that does not appear in the document is an error, not a silent no-op — fix the
anchor rather than dropping the comment somewhere arbitrary.

If you must hand-author revisions in XML: wrap runs in `<w:ins>` / `<w:del>` with `w:id`,
`w:author` and `w:date`. Inside `<w:del>`, the text element is `<w:delText>`, not `<w:t>`.

## Editing the XML directly

Only when python-docx cannot express what you need.

```bash
unzip -q doc.docx -d unpacked/
find unpacked -type l -delete   # strip symlink entries — a .docx from outside is untrusted
# edit unpacked/word/document.xml in place — do NOT reformat or pretty-print it
(cd unpacked && rm -f ../out.docx && zip -Xr ../out.docx .)
```

Legacy `.doc` is a binary format: convert it first with
`python scripts/word.py convert old.doc new.docx`.

## If you use docx-js instead (npm `docx`)

Only reach for it when you specifically need its features. It **cannot open an existing
document** — it writes new ones only. Install it under `.paperino/` so the paper folder stays
clean, never in the workspace root. The footguns:

- **Page size defaults to A4.** For US Letter set `page: { size: { width: 12240, height: 15840 } }` (DXA; 1440 = 1″).
- **Landscape:** pass portrait dimensions and `orientation: PageOrientation.LANDSCAPE` — docx-js swaps width/height internally.
- **Tables need dual widths:** set `columnWidths` on the table AND `width` on every cell, both in `WidthType.DXA` (PERCENTAGE breaks in Google Docs). Column widths must sum to the table width.
- **Table shading:** use `ShadingType.CLEAR`, never `SOLID` (renders black).
- **Lists:** never insert `•` literally; use a `numbering` config with `LevelFormat.BULLET`.
- **`ImageRun` requires `type:`** (`"png"`, `"jpg"`, …).
- **`PageBreak` must be inside a `Paragraph`.**
- **Never use `\n`** — use separate `Paragraph` elements.
- **TOC:** headings must use built-in `HeadingLevel.*`; custom heading styles need `outlineLevel` set or they won't appear.
- **Don't use a table as a horizontal rule** — use a paragraph bottom border instead.
- **Dot-leader / right-aligned-on-same-line:** use `PositionalTab` (`alignment: PositionalTabAlignment.RIGHT`, `leader: PositionalTabLeader.DOT`) inside a `TextRun`, not literal `.` or space padding.

## Dependencies

python-docx · pywin32 (Word COM) · Word itself. Optional: `docx` (npm).
