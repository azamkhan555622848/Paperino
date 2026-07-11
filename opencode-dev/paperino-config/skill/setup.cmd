@echo off
REM ===========================================================================
REM Builds the Python environment the xlsx / docx / pdf skills run on.
REM
REM tools\ is gitignored (same as the pinned Tectonic and jq binaries), so a
REM fresh clone has no venv and every one of those skills fails on first use.
REM Run this once after cloning:
REM
REM     opencode-dev\paperino-config\skill\setup.cmd
REM
REM paperino-dev.cmd puts tools\pyoffice\.venv\Scripts first on PATH, so inside
REM the running app a bare `python` IS this interpreter. That is what lets the
REM skill bodies say `python scripts/recalc.py` and have it mean the right thing.
REM ===========================================================================
setlocal
set "ROOT=%~dp0..\..\.."
set "VENV=%ROOT%\tools\pyoffice\.venv"

if not exist "%VENV%\Scripts\python.exe" (
  echo Creating %VENV%
  py -3 -m venv "%VENV%" || python -m venv "%VENV%" || exit /b 1
)

"%VENV%\Scripts\python.exe" -m pip install --upgrade pip || exit /b 1
"%VENV%\Scripts\python.exe" -m pip install -r "%~dp0requirements.txt" || exit /b 1

REM Import every dependency the skills name, so a broken venv fails here and not
REM halfway through a user's spreadsheet. win32com.client is the COM bridge to
REM Excel and Word; without it recalculation and format conversion are impossible.
"%VENV%\Scripts\python.exe" -c "import openpyxl, pandas, pypdf, pdfplumber, pypdfium2, reportlab, docx, win32com.client; print('pyoffice venv ready')" || exit /b 1
