# Paperino v1 — installable release with first-run onboarding

**Date:** 2026-07-13
**Status:** Approved — implementing
**Owner:** `opencode-dev/packages/desktop` (packaging, main-process setup), `opencode-dev/packages/app` (onboarding wizard), `paperbanana-mcp/server.py`, `figures-mcp` (build output), `paperino-config/`

## Problem

Paperino runs only via `paperino-dev.cmd` on this machine: absolute paths in
`paperino-config/opencode.jsonc`, env vars set by the launcher, and four runtimes (bun,
node, Python, Playwright's Chromium) assumed present. An end user cannot install it.

Two onboarding requirements from the user:

1. **Nano Banana key, dead simple** — paste an OpenRouter API key *or* a Google AI
   Studio (Gemini) key; PaperBanana must work with either.
2. **ChatGPT-subscription sign-in, in-app** — the OpenAI OAuth we wired (built-in codex
   plugin, `auth.openai.com`, callback on :1455) exposed as a first-run step, so
   GPT-5.6 Terra / Luna / Sol and the current Codex model ride the subscription, not an
   API key.

And one hard constraint (user, mid-design): **nothing of InteJer may leak in.** InteJer
is built on this same opencode fork and this same machine: it owns the machine-global
`~/.config/opencode/opencode.jsonc` (9 hardware MCP servers), global IoT skills, and
shares `~/.local/share/opencode/auth.json`. The packaged Paperino must be fully isolated
from all of it.

## Decisions (locked)

1. **Approach A** — own product identity + runtime-generated config + slim installer
   with first-run runtime setup. (Rejected: fully self-contained ~500MB installer;
   portable zip with no updater.)
2. **Slim installer (~150MB)**, first run downloads Chromium (~130MB) and a portable
   CPython (~90MB unpacked) with progress UI. Both steps skippable and re-runnable.
3. **Banana key: both providers.** OpenRouter key → `openrouter.ai` with
   `google/gemini-3.1-flash-image-preview`; Google key → Gemini's OpenAI-compatible
   endpoint with unprefixed model ids. OpenRouter wins if both present; env overrides win
   over both.
4. **OpenAI models: Terra + Luna + Sol + Codex.** `gpt-5.6-{terra,luna,sol}` are pure
   config declarations (the codex plugin's `> 5.4` version gate admits them);
   `gpt-5.3-codex` requires a one-line vendor allowlist patch in
   `packages/opencode/src/plugin/openai/codex.ts`, documented in CLAUDE.md as
   upstream-revert-prone (same class as the rebrand). Every id is verified against the
   real account during implementation; rejects are dropped.
5. **Distribution: GitHub Releases on `azamkhan555622848/Paperino`** with
   `electron-updater` auto-update. Windows-first, unsigned (the sign hook only runs in
   CI). **The repo's releases must be publicly readable** or the unauthenticated update
   check fails.
6. **One spec, two implementation plans**: (A) packaging/isolation/runtimes,
   (B) onboarding wizard + keys + models. Plan B depends on Plan A's env plumbing but
   the wizard is testable in dev.

## 1 · Identity & isolation from InteJer

- `electron-builder.config.ts` (currently still OpenCode identity): per channel
  appId `ai.paperino.desktop{.dev,.beta}`, productName `Paperino {Dev,Beta}`,
  `artifactName: paperino-${os}-${arch}.${ext}`, protocol scheme `paperino`,
  `publish: { provider: "github", owner: "azamkhan555622848", repo: "Paperino" }`
  (beta + prod).
- userData is already keyed off appId (`main/index.ts`), so a Paperino install never
  shares state with an InteJer install.
- **Packaged builds only:** the sidecar env gets
  `XDG_CONFIG_HOME = {userData}/xdg/config` and `XDG_DATA_HOME = {userData}/xdg/data`
  (alongside the existing `XDG_STATE_HOME`). Consequences, all intended:
  the machine-global `~/.config/opencode` is **never merged** (InteJer's servers and
  skills cannot leak in), and the auth store is
  `{userData}/xdg/data/opencode/auth.json` — Paperino's own logins, nothing shared.
  MCP children inherit this env from the sidecar.
- External skill discovery (`~/.claude`, `~/.agents`) is disabled in packaged builds via
  opencode's existing runtime flags (`RuntimeFlags.disableExternalSkills` /
  `disableClaudeCodeSkills` — exact env names verified in the plan), so an end user's
  unrelated Claude skills are not hoovered into the paper agent.
- The only MCP servers registered are `figures` and `paperbanana`; the only skills are
  Paperino's office skills (shipped in `paperino-config/skill/`). The InteJer disable
  list in the dev config becomes unnecessary in the packaged config (isolation makes it
  moot) and is omitted from the template.
- Dev flow (`paperino-dev.cmd`) is untouched — isolation applies only when
  `app.isPackaged`.
- Recorded fact: this branch (`feat/paperino`) is Paperino-flavored throughout
  (APP_NAMES, logo, icons). InteJer must ship from its own branch/checkout.

## 2 · Installer payload (extraResources)

```
resources/
  paperino-config/        template form of the shipped config (see §4) + AGENTS.md +
                          command/ + skill/ (office skills incl. scripts/)
  bin/tectonic/           tectonic.exe (~30MB)
  bin/jq/                 jq.exe
  figures-mcp/            server.mjs        (bun build --target=node bundle of src/server.ts)
                          render-worker.mjs (as-is; spawned as a child)
                          assets/ templates/ (scaffold sources, incl. lib/katex)
                          node_modules/playwright, node_modules/playwright-core (pure JS)
  paperbanana/            PaperBanana source + server.py + requirements.lock
```

**No bun, no node, no Chromium, no Python in the payload.** figures-mcp's server and its
render worker both run under `ELECTRON_RUN_AS_NODE=1` on the app's own electron
executable. `figures-mcp/src/render.ts` gains an env override for the worker command
(default `node` in dev; the packaged config sets it to the electron exe). The jq path
used by `data_query` likewise becomes env-overridable, pointing at `resources/bin/jq`.

## 3 · First-run runtime setup

Main-process setup service, driven from the onboarding wizard over IPC
(start/progress/done/error events per component):

- **Chromium**: Playwright's installer run under ELECTRON_RUN_AS_NODE with
  `PLAYWRIGHT_BROWSERS_PATH = {userData}/browsers`; the same env var is set on the
  figures-mcp process so the render worker finds it.
- **Python**: download python-build-standalone (`install_only`, CPython 3.12, win
  x86_64) → unpack to `{userData}/python`; then
  `python.exe -m pip install -r resources/paperbanana/requirements.lock` plus the office
  skills' `requirements.txt`. One env serves both PaperBanana and the office skills:
  `PAPERINO_PYTHON` points at it, **and main prepends `{userData}/python` to the sidecar
  PATH** so a bare `python` in the agent's shells resolves to it — the same contract
  `paperino-dev.cmd` gives the office skills in dev.
- Failure handling: per-step retry / skip. Skipping leaves the app fully usable for
  writing + Tectonic preview; Figure Studio / PaperBanana / office tools fail with the
  exact remediation ("run Complete setup in Settings"). A Settings action re-runs setup
  idempotently (each step checks its install marker before downloading).

## 4 · Runtime-generated config

The packaged app never trusts install-time paths. On every boot, main:

1. copies `resources/paperino-config/` → `{userData}/paperino-config/` (machine-owned,
   overwritten every boot), then
2. renders `opencode.jsonc` from the shipped template by substituting tokens:
   `{{RESOURCES}}` (process.resourcesPath), `{{USERDATA}}`, `{{ELECTRON}}`
   (process.execPath), and
3. sets sidecar env: `OPENCODE_CONFIG_DIR = {userData}/paperino-config`, the XDG dirs
   (§1), `PAPERINO_TECTONIC = {{RESOURCES}}/bin/tectonic/tectonic.exe`,
   `PLAYWRIGHT_BROWSERS_PATH`, `PAPERINO_PYTHON`.

Template highlights (packaged variant, sibling of the dev config —
`paperino-config/opencode.packaged.jsonc` in the repo):

```jsonc
"model": "openai/gpt-5.6-terra",
"provider": { "openai": { "models": {
  "gpt-5.6-terra": { ... }, "gpt-5.6-luna": { ... }, "gpt-5.6-sol": { ... },
  "gpt-5.3-codex": { ... }   // requires the vendor allowlist patch
}}},
"mcp": {
  "figures":    { "command": ["{{ELECTRON}}", "{{RESOURCES}}/figures-mcp/server.mjs"],
                  "environment": { "ELECTRON_RUN_AS_NODE": "1", ... } },
  "paperbanana":{ "command": ["{{USERDATA}}/python/python.exe",
                  "{{RESOURCES}}/paperbanana/server.py"], "timeout": 600000, ... }
}
```

`tectonicBinary()` in the desktop main additionally falls back to
`{resourcesPath}/bin/tectonic/tectonic.exe` when packaged, so the Preview panel compiles
without any env at all.

## 5 · Onboarding wizard

Extends the existing `isFirstLaunchOnboardingPending` gate (main/onboarding.ts + the
renderer's first-launch flow) with a Paperino wizard shown in packaged builds:

**Welcome → Runtime setup → Sign in with ChatGPT → Nano Banana key → Done**

- *Runtime setup*: §3 progress; skippable.
- *ChatGPT*: one button; drives the same `client.provider.oauth.authorize(...)` path the
  existing `dialog-connect-provider.tsx` uses, provider `openai` preselected, method =
  "ChatGPT Pro/Plus (browser)". Token lands in the isolated auth store. Skippable.
- *Banana key*: OpenRouter | Google toggle + one paste field; stored as the `openrouter`
  or `google` provider credential via the normal provider-auth API. Skippable.
- *Done* → `finishFirstLaunchOnboarding`. Every step reachable again from Settings.

## 6 · PaperBanana dual-key (`paperbanana-mcp/server.py`)

- Locate `auth.json` honoring `XDG_DATA_HOME` (falls back to `~/.local/share`) so it
  reads the isolated store in packaged builds and the shared one in dev.
- Key/endpoint selection order: explicit env (`OPENROUTER_API_KEY` /
  `GEMINI_API_KEY`) → `openrouter` auth entry → `google` auth entry.
  OpenRouter → base `https://openrouter.ai/api/v1`, models `google/...`-prefixed.
  Google → base `https://generativelanguage.googleapis.com/v1beta/openai/`, models
  unprefixed. Clear startup error naming both options when neither key exists.

## 7 · Updates & release process

- `electron-updater` with the §1 publish config; the desktop already exposes updater
  IPC. prod channel checks `azamkhan555622848/Paperino` releases.
- Release: `OPENCODE_CHANNEL=prod bun run package:win` → `dist/` NSIS one-click
  installer + `latest.yml`; publish with
  `gh release create vX.Y.Z paperino-win-x64.exe latest.yml --latest`.
- Versioning from `packages/desktop/package.json` version field.

## 8 · Error handling

- Setup downloads: resume/retry per step; disk-space and offline failures name the fix.
- OAuth: callback port 1455 busy → surfaced message (close the other app / retry);
  flow cancelable.
- MCP servers refuse cleanly when their runtime is missing (message points at Settings →
  Complete setup) rather than crashing the sidecar.
- Config generation failures (unwritable userData) surface at boot with the path named.

## 9 · Testing & acceptance

- **Unit**: config-template token substitution; `server.py` key-source/endpoint
  selection (env / openrouter / google / neither); worker-command env override in
  figures-mcp render.
- **Build smoke**: `package:win` for dev channel completes; installer under 200MB;
  `server.mjs` starts under ELECTRON_RUN_AS_NODE and answers MCP initialize.
- **Acceptance (real machine, real accounts)**: install the prod build alongside dev
  (distinct appIds); walk the wizard end-to-end with the real ChatGPT OAuth and a real
  key; then in the installed app: compile the demo paper (bundled Tectonic), render a
  Figure Studio figure (downloaded Chromium, electron-as-node), generate one PaperBanana
  figure (portable Python, each key source), run one office-skill operation.
- **Isolation acceptance**: on this machine — with InteJer's global config and skills
  present — the installed Paperino lists exactly 2 MCP servers, none of InteJer's
  skills, and writes auth to its own userData. `gpt-5.6-terra` answers via subscription.

## Out of scope (deliberate)

- macOS/Linux packages (config already scaffolds them; untested, unshipped).
- Code signing and store distribution.
- Auto-updating the runtime downloads (Chromium/Python versions pinned per release).
- Migrating dev-machine state into the packaged app (fresh onboarding is the point).
