@echo off
REM ===========================================================================
REM Stamps Paperino's icon and name onto the DEV electron.exe.
REM
REM Why this is needed at all: in a dev run the process IS node_modules'
REM electron.exe, and Windows caches a taskbar button's icon against the
REM executable. Ship builds are fine (electron-builder reads
REM resources/icons/icon.ico), so this is dev-only cosmetics.
REM
REM node_modules is not in git, so `bun install` or an electron reinstall REVERTS
REM this. Re-run it after either.
REM
REM Usage:  brand\patch-electron-exe.cmd        (run from anywhere)
REM
REM Windows caches shell icons aggressively. After patching, the taskbar can keep
REM showing the old Electron atom until the cache is dropped:
REM     ie4uinit.exe -show                      (cheap, sometimes enough)
REM     or restart Explorer / sign out          (always works)
REM ===========================================================================
setlocal

set "ROOT=%~dp0.."
set "RCEDIT=%ROOT%\opencode-dev\node_modules\.bun\electron-winstaller@5.4.0+759ce506b1ed1a42\node_modules\electron-winstaller\vendor\rcedit.exe"
set "EXE=%ROOT%\opencode-dev\node_modules\.bun\electron@42.3.3+759ce506b1ed1a42\node_modules\electron\dist\electron.exe"
set "ICO=%ROOT%\opencode-dev\packages\desktop\icons\dev\icon.ico"

if not exist "%RCEDIT%" (
  echo [paperino] rcedit not found. It ships inside electron-winstaller:
  echo            %RCEDIT%
  echo            That path is version-pinned; if deps moved, locate it with:
  echo            dir /s /b opencode-dev\node_modules\rcedit.exe
  exit /b 1
)
if not exist "%EXE%" (
  echo [paperino] electron.exe not found at %EXE%
  exit /b 1
)
if not exist "%ICO%" (
  echo [paperino] %ICO% missing - run `node brand\make-icons.mjs` first.
  exit /b 1
)

REM rcedit cannot write the exe while the app is running.
tasklist /FI "IMAGENAME eq electron.exe" | find /I "electron.exe" >nul
if not errorlevel 1 (
  echo [paperino] electron.exe is running - close Paperino first, or rcedit cannot write it.
  exit /b 1
)

"%RCEDIT%" "%EXE%" ^
  --set-icon "%ICO%" ^
  --set-version-string ProductName "Paperino" ^
  --set-version-string FileDescription "Paperino" ^
  --set-version-string CompanyName "Paperino" || exit /b 1

echo [paperino] electron.exe now carries the Paperino icon.
echo [paperino] If the taskbar still shows the Electron atom, that is the Windows
echo [paperino] icon cache - run `ie4uinit.exe -show`, or restart Explorer.
