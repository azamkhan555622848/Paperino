#!/usr/bin/env bun
import { $ } from "bun"

import { resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`cd ../opencode && bun script/build-node.ts`

// Paperino's shipped payload: config template, tectonic, jq, the node-target figures-mcp
// bundle, and PaperBanana. Staged here so resources-paperino/ is always in step with the
// source that produced it.
await $`bun ./scripts/stage-paperino.ts`
