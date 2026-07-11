# Filling PDF forms

Read this before filling any AcroForm. Every snippet here was run against pypdf 6.14 on
this machine; none of it is from memory.

## 1. Look at the form before you touch it

Never guess field names — read them.

```python
from pypdf import PdfReader

fields = PdfReader("form.pdf").get_fields()
for name, field in fields.items():
    print(name, field.get("/FT"), field.get("/_States_", ""))
```

`/FT` is the field type: `/Tx` text, `/Btn` checkbox or radio, `/Ch` dropdown or list.

## 2. Checkboxes and radios take an export value, not `True`

A checkbox's legal values live in `/_States_` — typically `['/Off', '/Yes']`, but a form is
free to use `/On`, `/1`, `/Choice2`… Read the states and pass one of them verbatim, with the
leading slash. `True`, `"true"` and `"X"` all silently do nothing.

For a radio group, every button shares one field name; the value you set is the export value
of the button you want on.

## 3. Fill it

```python
from pypdf import PdfReader, PdfWriter

writer = PdfWriter(clone_from="form.pdf")

# Without NeedAppearances, many viewers (including Acrobat) show the field EMPTY even though
# the value is stored — the value is there, the rendering instructions are not.
writer.set_need_appearances_writer(True)

writer.update_page_form_field_values(
    writer.pages[0],
    {"author": "A. Khan", "agree": "/Yes"},
    auto_regenerate=False,
)

with open("filled.pdf", "wb") as fh:
    writer.write(fh)
```

Fields live on the page that draws them: `update_page_form_field_values` is per-page, so
loop over `writer.pages` for a multi-page form.

## 4. Always read it back

The write can succeed while the value lands nowhere. Verify, and say so honestly if it did
not take:

```python
back = PdfReader("filled.pdf").get_fields()
print(back["author"].get("/V"), back["agree"].get("/V"))   # 'A. Khan' '/Yes'
```

Then render it and look at it — a value that is stored but invisible is still a broken
deliverable:

```bash
python scripts/render.py filled.pdf --out pages --dpi 100
```

## Limits, stated plainly

- **XFA forms** (LiveCycle; common in government and some journal submission packs) are not
  AcroForms. pypdf cannot fill them. Say so and ask the user to open it in Acrobat — do not
  produce a half-filled file and call it done.
- **Flattening** (making values permanent, uneditable) is not something pypdf does reliably.
  If the recipient demands a flattened PDF, print to PDF from a viewer, or convert via Word.
- If a field name in the form does not match anything the user gave you, **ask**. Never
  invent a plausible value to fill a blank — the same rule that governs the rest of Paperino.
