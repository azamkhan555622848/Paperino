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
REM
REM Usage:  paperino-dev.cmd      (run from anywhere; it cd's to its own folder)
REM ===========================================================================
setlocal
set "OPENCODE_CONFIG_DIR=C:/Users/azamk/Documents/Paperino/opencode-dev/paperino-config"
set "PAPERINO_TECTONIC=C:\Users\azamk\Documents\Paperino\tools\tectonic\tectonic.exe"
set "PATH=C:\Users\azamk\Documents\Paperino\tools\tectonic;%PATH%"
cd /d "%~dp0"
call bun run dev:desktop
