---
name: pdf
description: Use this skill whenever the user wants to do anything with PDF files. This includes reading or extracting text/tables from PDFs, combining or merging multiple PDFs into one, splitting PDFs apart, rotating pages, adding watermarks, creating new PDFs, filling PDF forms, encrypting/decrypting PDFs, extracting images, and OCR on scanned PDFs to make them searchable. If the user mentions a .pdf file or asks to produce one, use this skill.
license: Proprietary (Anthropic). Adapted for Paperino on Windows; see the upstream skill for complete terms.
---

# Paperino rules — these override everything below

1. **Asked to *see* a PDF, put it on screen — never summarise instead.** The Preview panel is
   the answer. The user can click any PDF in its file tree; to push one yourself, copy it to
   `.paperino/preview.pdf` (`mkdir -p .paperino` first) and reply with one line saying what
   is now on screen.
2. **`artifacts/` is read-only ground truth.** Extract from a PDF there all you like; never
   write back into it. Write outputs elsewhere.
3. **The manuscript's PDF comes from LaTeX.** In a paper workspace, `main.pdf` is Tectonic's
   output — do not hand-assemble the paper with ReportLab. ReportLab is for ad-hoc documents
   (a cover letter, a response-to-reviewers), not for the paper itself.
4. **A number you extracted is data; a number you didn't is not.** Pulling figures out of a
   reference PDF is legitimate. Inventing one because a table looked like it should have a
   value is not — ask.

# Environment (Windows)

`python` inside Paperino is the skill venv (`tools/pyoffice/.venv`, also `$PAPERINO_PYTHON`)
with **pypdf, pdfplumber, pypdfium2 and reportlab**.

There is **no qpdf, pdftk, poppler (`pdftoppm`/`pdfimages`) or tesseract** on this machine.
pypdf does everything qpdf and pdftk did; `scripts/render.py` replaces `pdftoppm`.

**OCR is not available.** If a PDF is a scan with no text layer, say so plainly and offer to
install an OCR toolchain — do not pretend to have read it.

If a script fails with `ModuleNotFoundError`, run
`opencode-dev\paperino-config\skill\setup.cmd` once and say so.

# Quick start

```python
from pypdf import PdfReader

reader = PdfReader("document.pdf")
print(f"Pages: {len(reader.pages)}")
text = "".join(page.extract_text() for page in reader.pages)
```

If `extract_text()` returns empty strings for every page, the PDF is a scan — see the OCR
note above. Do not report an empty extraction as an empty document.

# pypdf — page operations

### Merge
```python
from pypdf import PdfWriter, PdfReader

writer = PdfWriter()
for path in ["doc1.pdf", "doc2.pdf", "doc3.pdf"]:
    for page in PdfReader(path).pages:
        writer.add_page(page)

with open("merged.pdf", "wb") as out:
    writer.write(out)
```

### Split
```python
reader = PdfReader("input.pdf")
for i, page in enumerate(reader.pages):
    writer = PdfWriter()
    writer.add_page(page)
    with open(f"page_{i + 1}.pdf", "wb") as out:
        writer.write(out)
```

### Metadata
```python
meta = PdfReader("document.pdf").metadata
print(meta.title, meta.author, meta.subject, meta.creator)
```

### Rotate
```python
reader, writer = PdfReader("input.pdf"), PdfWriter()
page = reader.pages[0]
page.rotate(90)                      # clockwise; must be a multiple of 90
writer.add_page(page)
with open("rotated.pdf", "wb") as out:
    writer.write(out)
```

### Watermark
```python
watermark = PdfReader("watermark.pdf").pages[0]
reader, writer = PdfReader("document.pdf"), PdfWriter()
for page in reader.pages:
    page.merge_page(watermark)
    writer.add_page(page)
with open("watermarked.pdf", "wb") as out:
    writer.write(out)
```

### Encrypt / decrypt
```python
writer.encrypt("userpassword", "ownerpassword")     # before write()

reader = PdfReader("encrypted.pdf")
if reader.is_encrypted:
    reader.decrypt("mypassword")
```

# pdfplumber — text and tables

### Text with layout
```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        print(page.extract_text())
```

### Tables
```python
import pandas as pd
import pdfplumber

frames = []
with pdfplumber.open("document.pdf") as pdf:
    for page_number, page in enumerate(pdf.pages, start=1):
        for table in page.extract_tables():
            if table and len(table) > 1:
                frames.append(pd.DataFrame(table[1:], columns=table[0]))

if frames:
    pd.concat(frames, ignore_index=True).to_excel("extracted_tables.xlsx", index=False)
```

Table extraction is a heuristic, not a parse. **Spot-check the numbers against the rendered
page before you use them for anything** — render it with `scripts/render.py` and look. A
misaligned column silently shifts values into the wrong row, and a wrong number in a paper is
the one failure mode this product exists to prevent.

# Looking at a PDF

```bash
python scripts/render.py document.pdf --out pages --dpi 100
python scripts/render.py document.pdf --out pages --pages 1-3
# then Read pages/page-01.png
```

Pages are 1-based and zero-padded to the page count (`page-01.png` … `page-12.png`).
Rendering is how you *check your own output* — always look at a PDF you produced.

# Forms

Read **FORMS.md** in this skill's directory before filling any form. Checkboxes take an
export value (`/Yes`), not `True`, and without `NeedAppearances` a filled field renders blank.

# reportlab — creating PDFs

### Basic
```python
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

c = canvas.Canvas("hello.pdf", pagesize=letter)
width, height = letter
c.drawString(100, height - 100, "Hello World!")
c.line(100, height - 140, 400, height - 140)
c.save()
```

### Multi-page, flowing
```python
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak

doc = SimpleDocTemplate("report.pdf", pagesize=letter)
styles = getSampleStyleSheet()
story = [
    Paragraph("Report Title", styles["Title"]),
    Spacer(1, 12),
    Paragraph("Body text. " * 20, styles["Normal"]),
    PageBreak(),
    Paragraph("Page 2", styles["Heading1"]),
]
doc.build(story)
```

### Subscripts and superscripts

**Never use Unicode sub/superscript characters (₀₁₂₃, ⁰¹²³) in a ReportLab PDF.** The built-in
fonts have no glyphs for them and they render as solid black boxes. Use the markup tags:

```python
Paragraph("H<sub>2</sub>O", styles["Normal"])
Paragraph("x<super>2</super> + y<super>2</super>", styles["Normal"])
```

For canvas-drawn text (not `Paragraph`), shift the baseline and shrink the font by hand.

# Quick reference

| Task | Tool |
|---|---|
| Merge / split / rotate / encrypt | pypdf |
| Extract text | pdfplumber (fall back to pypdf) |
| Extract tables | pdfplumber — then verify against the render |
| Rasterize pages / look at a PDF | `scripts/render.py` (pypdfium2) |
| Create a PDF | reportlab — but the *paper* comes from LaTeX |
| Fill a form | pypdf — read FORMS.md first |
| Show it to the user | copy to `.paperino/preview.pdf` |
| OCR a scan | **unavailable** — say so |
