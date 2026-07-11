// Regenerates Paperino's app icons for every channel from the mark in paperino-mark.svg.
//
//   node brand/make-icons.mjs           (run from the Paperino root)
//
// The icon sets live under opencode-dev/packages/desktop/icons/<channel>/, which is inside the
// fork's vendor tree and therefore NOT in git — this script plus paperino-mark.svg are what is
// tracked, so the brand is reproducible from a fresh clone.
//
// Two things you have to know:
//   * packages/desktop/scripts/copy-icons.ts does `rm -rf resources/icons && cp -R icons/<channel>`.
//     resources/icons is BUILD OUTPUT: write there and the next build wipes it. Write to
//     icons/<channel>, which is what this script does, then run copy-icons.
//   * Playwright HANGS under bun in this repo (it drives Chrome over a pipe on fds 3/4 that bun's
//     spawn ignores), so this must run under NODE, and from a directory where `playwright`
//     resolves (the figures-mcp install).

import { chromium } from "playwright"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Keep in lockstep with brand/paperino-mark.svg and packages/ui/src/components/logo.tsx.
const PAGE =
  "M2 1H10L14 5V19H2V1Z " +
  "M4.5 7H11.5V8.4H4.5V7Z " +
  "M4.5 10.2H11.5V11.6H4.5V10.2Z " +
  "M4.5 13.4H8.5V14.8H4.5V13.4Z"
const FOLD = "M10 1L14 5H10V1Z"

const INK = "#15171D" // the tile the sheet sits on
const PAPER = "#F7F8FA"
const MUTED = "#8A91A0" // the folded flap

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="224" fill="${INK}"/>
  <g transform="translate(232 166) scale(34)">
    <path fill-rule="evenodd" clip-rule="evenodd" d="${PAGE}" fill="${PAPER}"/>
    <path d="${FOLD}" fill="${MUTED}"/>
  </g>
</svg>`

const scratch = mkdtempSync(join(tmpdir(), "paperino-brand-"))
const master = join(scratch, "master.png")

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 })
await page.setContent(`<body style="margin:0">${svg}</body>`)
writeFileSync(master, await page.screenshot({ omitBackground: true, type: "png" }))
await browser.close()
console.log("rendered master:", master)

// Pillow does the resizing and the multi-size .ico / .icns containers.
const python = "tools/pyoffice/.venv/Scripts/python.exe"
const slice = `
import pathlib, sys
from PIL import Image

master = Image.open(sys.argv[1]).convert("RGBA")
root = pathlib.Path("opencode-dev/packages/desktop/icons")
targets = {"32x32.png": 32, "64x64.png": 64, "128x128.png": 128,
           "128x128@2x.png": 256, "dock.png": 512, "icon.png": 1024}
ICO = [(16,16), (24,24), (32,32), (48,48), (64,64), (128,128), (256,256)]

for channel in ("dev", "beta", "prod"):
    d = root / channel
    if not d.is_dir():
        print("missing:", d); continue
    for name, px in targets.items():
        master.resize((px, px), Image.LANCZOS).save(d / name)
    # Windows tiles keep whatever size they already are.
    for f in sorted(d.glob("Square*Logo.png")) + sorted(d.glob("StoreLogo.png")):
        px = Image.open(f).size[0]
        master.resize((px, px), Image.LANCZOS).save(f)
    master.save(d / "icon.ico", format="ICO", sizes=ICO)
    master.save(d / "icon.icns", format="ICNS")
    print("wrote", channel)
`
execFileSync(python, ["-c", slice, master], { stdio: "inherit" })

console.log("\nNow refresh the copy the app actually loads:")
console.log("  cd opencode-dev/packages/desktop && bun scripts/copy-icons.ts dev")
