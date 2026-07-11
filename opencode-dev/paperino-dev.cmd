@echo off
REM ===========================================================================
REM Paperino - dev launcher for the research-paper-writing desktop app.
REM
REM Why a wrapper instead of plain `bun run dev:desktop`:
REM   - OPENCODE_CONFIG_DIR points at paperino-config/. It does two things:
REM       * Global.Service.config resolves to it (core/src/global.ts:64), so the
REM         persona loaded as "global AGENTS.md" (session/instruction.ts:61) is
REM         paperino-config/AGENTS.md instead of InteJer's embedded/IoT one.
REM       * It is added to the config dir search path (config/paths.ts:39), so
REM         command/new-paper.md is discovered and its opencode.jsonc merges last.
REM   - The global opencode.jsonc (~/.config/opencode) is STILL merged, because
REM     config.ts reads Global.Path.config, which the env var does NOT override.
REM     That file belongs to InteJer and registers 9 hardware MCP servers, so
REM     paperino-config/opencode.jsonc disables them by name.
REM   - PAPERINO_TECTONIC tells the Electron main process where the LaTeX engine
REM     lives; the Paper preview panel shells out to it on every save.
REM   - The pyoffice venv goes FIRST on PATH so that a bare `python` inside the
REM     app is the interpreter the xlsx/docx/pdf skills were written against
REM     (openpyxl, pypdf, pdfplumber, pypdfium2, reportlab, python-docx, pywin32).
REM     Build it once with paperino-config\skill\setup.cmd; tools\ is gitignored,
REM     so a fresh clone has no venv and those skills would fail on first use.
REM     Neither MCP server is affected: paperbanana names its own python by
REM     absolute path, and figures runs on bun.
REM
REM Usage:  paperino-dev.cmd      (run from anywhere; it cd's to its own folder)
REM ===========================================================================
setlocal
set "OPENCODE_CONFIG_DIR=C:/Users/azamk/Documents/Paperino/opencode-dev/paperino-config"
set "PAPERINO_TECTONIC=C:\Users\azamk\Documents\Paperino\tools\tectonic\tectonic.exe"
set "PAPERINO_PYTHON=C:\Users\azamk\Documents\Paperino\tools\pyoffice\.venv\Scripts\python.exe"
set "PATH=C:\Users\azamk\Documents\Paperino\tools\pyoffice\.venv\Scripts;C:\Users\azamk\Documents\Paperino\tools\tectonic;%PATH%"

if not exist "%PAPERINO_PYTHON%" (
  echo [paperino] WARNING: office-skill venv missing. The xlsx/docx/pdf skills will not run.
  echo [paperino]          Build it once:  paperino-config\skill\setup.cmd
)

cd /d "%~dp0"
call bun run dev:desktop
