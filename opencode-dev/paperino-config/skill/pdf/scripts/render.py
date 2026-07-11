"""Rasterize PDF pages to PNGs so you can LOOK at a document you just produced.

Anthropic's pdf skill uses poppler's `pdftoppm`. Poppler is not installed here, so this
uses pypdfium2 — a pip wheel with no system dependency, wrapping the same PDFium engine
Chrome renders with.

    python scripts/render.py <pdf> [--out DIR] [--dpi 100] [--pages 1-3]

Page numbers are 1-based and zero-padded to the width of the page count (page-01.png …
page-12.png), matching pdftoppm's convention. Prints:

    {"status": "ok", "count": 2, "pages": ["...\\page-1.png", "...\\page-2.png"]}
"""

import argparse
import json
import os
import sys

import pypdfium2 as pdfium

PDF_POINTS_PER_INCH = 72  # PDF user space is 72 units to the inch; scale = dpi / 72


def parse_pages(spec, total):
    """'3' -> [3]; '1-4' -> [1,2,3,4]; '1,3,5' -> [1,3,5]; None -> every page."""
    if not spec:
        return list(range(1, total + 1))

    wanted = []
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            first, last = part.split("-", 1)
            wanted.extend(range(int(first), int(last) + 1))
        else:
            wanted.append(int(part))

    out_of_range = [n for n in wanted if n < 1 or n > total]
    if out_of_range:
        raise ValueError(f"page(s) {out_of_range} out of range; the document has {total}")
    return wanted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf")
    parser.add_argument("--out", default=None, help="output directory (default: alongside the PDF)")
    parser.add_argument("--dpi", type=float, default=100.0)
    parser.add_argument("--pages", default=None, help="e.g. 3 | 1-4 | 1,3,5 (default: all)")
    args = parser.parse_args()

    src = os.path.abspath(args.pdf)
    if not os.path.isfile(src):
        print(json.dumps({"status": "error", "message": f"file not found: {src}"}))
        return 1

    out_dir = os.path.abspath(args.out) if args.out else os.path.dirname(src)
    os.makedirs(out_dir, exist_ok=True)

    try:
        doc = pdfium.PdfDocument(src)
        total = len(doc)
        pages = parse_pages(args.pages, total)
        width = len(str(total))
        scale = args.dpi / PDF_POINTS_PER_INCH

        written = []
        for number in pages:
            image = doc[number - 1].render(scale=scale).to_pil()
            path = os.path.join(out_dir, f"page-{number:0{width}d}.png")
            image.save(path)
            written.append(path)
    except Exception as err:  # noqa: BLE001 — surface failures as JSON, not a traceback
        print(json.dumps({"status": "error", "message": str(err)}))
        return 1

    print(json.dumps({"status": "ok", "count": len(written), "pages": written}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
