import { readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

// The THIRD table of the app's identity, after main/index.ts (which keys userData off it) and
// electron-builder.config.ts (which stamps the installer). All three are pinned equal by
// src/main/paperino/packaged.test.ts: when they drift, a Paperino build advertises itself as
// some other product — this file shipped OpenCode's id, name and bugtracker inside Paperino's
// own app.asar, because electron-builder packs resources/**/*.
const APP_IDS = {
  dev: "ai.paperino.desktop.dev",
  beta: "ai.paperino.desktop.beta",
  prod: "ai.paperino.desktop",
} as const

const PRODUCT_NAMES = {
  dev: "Paperino Dev",
  beta: "Paperino Beta",
  prod: "Paperino",
} as const

const appId = APP_IDS[channel]
const productName = PRODUCT_NAMES[channel]
const summary = `Agentic writing for research papers${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="ai.paperino">
    <name>Azam Khan</name>
  </developer>

  <description>
    <p>
      Paperino is an agentic desktop app for writing research papers of submission quality. It
      drafts LaTeX with a live preview, authors figures and tables from your own data, and cites
      only work it has resolved by DOI.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="bugtracker">https://github.com/azamkhan555622848/Paperino/issues</url>
  <url type="homepage">https://github.com/azamkhan555622848/Paperino</url>
  <url type="vcs-browser">https://github.com/azamkhan555622848/Paperino</url>
</component>
`

// Sweep first: the file is named after the app id, so a rename leaves the old one behind and
// electron-builder, which packs resources/**/*, would ship both.
for (const entry of readdirSync("resources")) {
  if (entry.endsWith(".metainfo.xml")) rmSync(join("resources", entry))
}

await Bun.write(`resources/${appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
