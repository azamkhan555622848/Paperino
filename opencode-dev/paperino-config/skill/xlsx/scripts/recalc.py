"""Recalculate a workbook with the real Excel engine and report every formula error.

Anthropic's xlsx skill recalculates through LibreOffice. LibreOffice is not installed on
this machine and Excel is, so this drives Excel over COM instead. The stdout contract is
deliberately unchanged, because the skill body documents it:

    {"status": "success" | "errors_found",
     "total_errors": 0,
     "total_formulas": 42,
     "error_summary": {"#REF!": {"count": 2, "locations": ["Sheet1!B5", "Sheet1!C10"]}}}

`error_summary` is present only when errors were found. A failure to open the file at all
reports {"status": "error", "message": ...} and exit code 1.

Usage:  python scripts/recalc.py <workbook> [timeout_seconds]
"""

import gc
import json
import os
import subprocess
import sys
import threading
import time

import pythoncom
import win32com.client
import win32process

XL_CELL_TYPE_FORMULAS = -4123
XL_CELL_TYPE_CONSTANTS = 2
XL_ERRORS = 16
MSO_AUTOMATION_SECURITY_FORCE_DISABLE = 3

# An error cell's .Text is normally the error string, but a cell whose column is too narrow
# renders as "#####" — so fall back to the underlying CVErr code, which is unambiguous.
CVERR = {
    -2146826288: "#NULL!",
    -2146826281: "#DIV/0!",
    -2146826273: "#VALUE!",
    -2146826265: "#REF!",
    -2146826259: "#NAME?",
    -2146826252: "#NUM!",
    -2146826246: "#N/A",
}
KNOWN = set(CVERR.values())


def error_name(cell):
    text = str(cell.Text).strip()
    if text in KNOWN:
        return text
    try:
        return CVERR.get(int(cell.Value), text or "#UNKNOWN")
    except (TypeError, ValueError):
        return text or "#UNKNOWN"


def special_cells(sheet, kind, value=None):
    """SpecialCells raises when nothing matches, which is the normal 'no errors' case."""
    try:
        if value is None:
            return sheet.Cells.SpecialCells(kind)
        return sheet.Cells.SpecialCells(kind, value)
    except pythoncom.com_error:
        return None


def address_of(sheet, cell):
    # Late-binding COM exposes Range.Address as a plain string property, so the early-bound
    # `cell.Address(0, 0)` form raises "'str' object is not callable". Strip the $ ourselves.
    return f"{sheet.Name}!{str(cell.Address).replace('$', '')}"


def scan(workbook):
    total_formulas = 0
    summary = {}

    for sheet in workbook.Worksheets:
        formulas = special_cells(sheet, XL_CELL_TYPE_FORMULAS)
        if formulas is not None:
            total_formulas += formulas.Count

        # A #REF! can sit in a formula cell or, once pasted as a value, in a constant cell.
        # Anthropic's script scans ALL cells; both passes together are that same sweep.
        for kind in (XL_CELL_TYPE_FORMULAS, XL_CELL_TYPE_CONSTANTS):
            found = special_cells(sheet, kind, XL_ERRORS)
            if found is None:
                continue
            for cell in found:
                entry = summary.setdefault(error_name(cell), {"count": 0, "locations": []})
                entry["count"] += 1
                entry["locations"].append(address_of(sheet, cell))

    total_errors = sum(entry["count"] for entry in summary.values())
    result = {
        "status": "errors_found" if total_errors else "success",
        "total_errors": total_errors,
        "total_formulas": total_formulas,
    }
    if summary:
        result["error_summary"] = summary
    return result


def pid_of(app):
    try:
        return win32process.GetWindowThreadProcessId(app.Hwnd)[1]
    except Exception:
        return None


def alive(pid):
    out = subprocess.run(
        ["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True, check=False
    )
    return str(pid) in out.stdout


def reap(pid, grace=5.0):
    """Make sure the Excel WE spawned is gone.

    Quit() alone is not enough: Excel stays resident while any COM reference is still
    outstanding, so an unreaped run leaves a ~180 MB EXCEL.EXE behind every single time.
    Killing by PID — never `taskkill /IM excel.exe` — leaves the user's own workbooks alone.
    """
    if not pid:
        return
    deadline = time.monotonic() + grace
    while time.monotonic() < deadline:
        if not alive(pid):
            return
        time.sleep(0.25)
    subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, check=False)


def recalc(path, state):
    pythoncom.CoInitialize()
    app = None
    try:
        # DispatchEx, never Dispatch: Dispatch attaches to an Excel the user already has
        # open (Excel registers itself in the running-object table). We then set
        # DisplayAlerts = False and Quit() — on THEIR session, discarding THEIR unsaved
        # work. DispatchEx always spawns a private instance we own and can safely close.
        app = win32com.client.DispatchEx("Excel.Application")
        state["pid"] = pid_of(app)
        app.Visible = False
        app.DisplayAlerts = False
        app.EnableEvents = False
        app.AskToUpdateLinks = False
        # A .xlsm arriving from a co-author is untrusted; never let opening it run macros.
        app.AutomationSecurity = MSO_AUTOMATION_SECURITY_FORCE_DISABLE

        workbook = app.Workbooks.Open(path, UpdateLinks=0, ReadOnly=False, AddToMru=False)
        app.CalculateFullRebuild()
        workbook.Save()  # keeps the existing format, so .xlsm stays macro-enabled
        state["result"] = scan(workbook)
        workbook.Close(SaveChanges=False)
        workbook = None
    except Exception as err:  # noqa: BLE001 — any COM failure must reach the agent as JSON
        state["result"] = {"status": "error", "message": str(err)}
    finally:
        if app is not None:
            try:
                app.Quit()
            except Exception:
                pass
            app = None
        gc.collect()  # drop the last COM references so Excel is free to exit
        pythoncom.CoUninitialize()


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "usage: recalc.py <workbook> [timeout_seconds]"}))
        return 1

    path = os.path.abspath(sys.argv[1])
    timeout = float(sys.argv[2]) if len(sys.argv) > 2 else 120.0

    if not os.path.isfile(path):
        print(json.dumps({"status": "error", "message": f"file not found: {path}"}))
        return 1

    state = {}
    worker = threading.Thread(target=recalc, args=(path, state), daemon=True)
    worker.start()
    worker.join(timeout)

    if worker.is_alive():
        reap(state.get("pid"), grace=0)
        print(json.dumps({"status": "error", "message": f"Excel did not finish within {timeout:g}s"}))
        return 1

    reap(state.get("pid"))
    result = state.get("result", {"status": "error", "message": "no result"})
    print(json.dumps(result, indent=2))
    return 0 if result["status"] in ("success", "errors_found") else 1


if __name__ == "__main__":
    sys.exit(main())
