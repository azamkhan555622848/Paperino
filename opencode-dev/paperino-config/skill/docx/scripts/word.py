"""Word operations that need a real Word engine, driven over COM.

Anthropic's docx skill reaches for LibreOffice (`soffice --convert-to`), pandoc, and a
`comment.py` that hand-writes six cross-linked XML parts. None of that is installed here —
but Word is, and Word does all three natively and more faithfully.

    python scripts/word.py convert         <in> <out>          # .doc/.docx -> .docx/.pdf/.rtf/.txt/.html
    python scripts/word.py accept-changes  <in> <out>          # accept every tracked revision
    python scripts/word.py comment         <file> <text> [--anchor "text"] [-o <out>]
    python scripts/word.py extract-text    <file>              # .docx without launching Word

Every subcommand prints JSON: {"status": "ok", ...} or {"status": "error", "message": ...}.
"""

import argparse
import gc
import json
import os
import subprocess
import sys
import time
from contextlib import contextmanager

import pythoncom
import win32com.client

WD_FORMAT = {
    ".docx": 16,  # wdFormatDocumentDefault
    ".pdf": 17,  # wdFormatPDF
    ".doc": 0,  # wdFormatDocument97
    ".rtf": 6,  # wdFormatRTF
    ".txt": 2,  # wdFormatText
    ".html": 8,  # wdFormatHTML
}
WD_ALERTS_NONE = 0
MSO_AUTOMATION_SECURITY_FORCE_DISABLE = 3
WD_FIND_STOP = 0  # wdFindStop — do not wrap past the end of the document


def word_pids():
    out = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq WINWORD.EXE", "/NH", "/FO", "CSV"],
        capture_output=True,
        text=True,
        check=False,
    )
    found = set()
    for line in out.stdout.splitlines():
        fields = line.split('","')
        if len(fields) > 1:
            try:
                found.add(int(fields[1].strip('"')))
            except ValueError:
                pass
    return found


def reap(pid, grace=5.0):
    """Word, like Excel, stays resident while any COM reference is outstanding.

    Kill by PID only — `taskkill /IM winword.exe` would close the user's own documents.
    """
    if not pid:
        return
    deadline = time.monotonic() + grace
    while time.monotonic() < deadline:
        if pid not in word_pids():
            return
        time.sleep(0.25)
    subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, check=False)


@contextmanager
def word():
    """A private Word instance, always cleaned up.

    DispatchEx, never Dispatch: Dispatch would attach to the Word the user already has open
    and then Quit() it out from under them, losing unsaved work.
    """
    pythoncom.CoInitialize()
    before = word_pids()
    app = win32com.client.DispatchEx("Word.Application")
    pid = next(iter(word_pids() - before), None)
    try:
        app.Visible = False
        app.DisplayAlerts = WD_ALERTS_NONE
        # A .docx from a co-author or a journal is untrusted; opening it must not run macros.
        app.AutomationSecurity = MSO_AUTOMATION_SECURITY_FORCE_DISABLE
        yield app
    finally:
        try:
            app.Quit(SaveChanges=0)
        except Exception:
            pass
        del app
        gc.collect()
        pythoncom.CoUninitialize()
        reap(pid)


def open_doc(app, path):
    return app.Documents.Open(
        FileName=path, ConfirmConversions=False, ReadOnly=False, AddToRecentFiles=False, Visible=False
    )


def format_for(path):
    ext = os.path.splitext(path)[1].lower()
    if ext not in WD_FORMAT:
        raise ValueError(f"unsupported output format '{ext}' (use {', '.join(sorted(WD_FORMAT))})")
    return WD_FORMAT[ext]


def cmd_convert(args):
    src, dst = os.path.abspath(args.input), os.path.abspath(args.output)
    fmt = format_for(dst)
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    with word() as app:
        doc = open_doc(app, src)
        try:
            doc.SaveAs2(dst, FileFormat=fmt)
        finally:
            doc.Close(SaveChanges=0)
    return {"status": "ok", "output": dst}


def cmd_accept_changes(args):
    src, dst = os.path.abspath(args.input), os.path.abspath(args.output)
    fmt = format_for(dst)
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    with word() as app:
        doc = open_doc(app, src)
        try:
            revisions = doc.Revisions.Count
            doc.Revisions.AcceptAll()
            doc.TrackRevisions = False  # or the next edit silently starts tracking again
            doc.SaveAs2(dst, FileFormat=fmt)
        finally:
            doc.Close(SaveChanges=0)
    return {"status": "ok", "output": dst, "revisions_accepted": revisions}


def cmd_comment(args):
    src = os.path.abspath(args.file)
    dst = os.path.abspath(args.output) if args.output else src
    fmt = format_for(dst)
    with word() as app:
        doc = open_doc(app, src)
        try:
            if args.anchor:
                target = doc.Content
                find = target.Find
                find.Text = args.anchor
                find.Forward = True
                find.Wrap = WD_FIND_STOP
                if not find.Execute():
                    return {"status": "error", "message": f"anchor text not found: {args.anchor!r}"}
                # Find.Execute redefines the range in place to the matched text, so `target`
                # is now exactly the anchor — which is what the comment attaches to.
            else:
                target = doc.Paragraphs(1).Range
            doc.Comments.Add(target, args.text)
            doc.SaveAs2(dst, FileFormat=fmt)
        finally:
            doc.Close(SaveChanges=0)
    return {"status": "ok", "output": dst, "anchored_to": args.anchor or "(first paragraph)"}


def cmd_extract_text(args):
    src = os.path.abspath(args.file)
    ext = os.path.splitext(src)[1].lower()

    if ext == ".docx":
        # python-docx reads the zip directly — no Word process, no COM, much faster.
        import docx

        doc = docx.Document(src)
        parts = [p.text for p in doc.paragraphs]
        for table in doc.tables:
            for row in table.rows:
                parts.append("\t".join(cell.text for cell in row.cells))
        return {"status": "ok", "text": "\n".join(parts)}

    # Legacy .doc is a binary format python-docx cannot read; only Word can.
    with word() as app:
        doc = open_doc(app, src)
        try:
            text = doc.Content.Text
        finally:
            doc.Close(SaveChanges=0)
    return {"status": "ok", "text": text}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    convert = sub.add_parser("convert", help="convert between Word-readable formats")
    convert.add_argument("input")
    convert.add_argument("output")
    convert.set_defaults(func=cmd_convert)

    accept = sub.add_parser("accept-changes", help="accept every tracked revision")
    accept.add_argument("input")
    accept.add_argument("output")
    accept.set_defaults(func=cmd_accept_changes)

    comment = sub.add_parser("comment", help="add a comment, optionally anchored to some text")
    comment.add_argument("file")
    comment.add_argument("text")
    comment.add_argument("--anchor", help="text the comment attaches to; default is the first paragraph")
    comment.add_argument("-o", "--output", help="write here instead of editing in place")
    comment.set_defaults(func=cmd_comment)

    extract = sub.add_parser("extract-text", help="print the document's text")
    extract.add_argument("file")
    extract.set_defaults(func=cmd_extract_text)

    args = parser.parse_args()

    target = getattr(args, "file", None) or getattr(args, "input", None)
    if target and not os.path.isfile(target):
        print(json.dumps({"status": "error", "message": f"file not found: {os.path.abspath(target)}"}))
        return 1

    try:
        result = args.func(args)
    except Exception as err:  # noqa: BLE001 — any COM failure must reach the agent as JSON
        result = {"status": "error", "message": str(err)}

    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
