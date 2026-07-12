# Paperino Onboarding (Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user who installs Paperino can, without touching a config file, sign in with their
ChatGPT subscription (getting GPT-5.6 Terra/Luna/Sol + GPT-5.3 Codex) and paste one API key —
from OpenRouter *or* Google — to enable PaperBanana's Nano Banana figures.

**Architecture:** A first-run wizard (Welcome → Runtime setup → ChatGPT → Nano Banana key → Done)
rendered in the renderer, gated by a store key owned by the main process. The wizard does not
reimplement auth: ChatGPT sign-in reuses the fork's `DialogConnectProvider` with the `openai`
provider preselected, and the Banana key is written with the same `client.auth.set` call the
fork's own API-key form uses. PaperBanana then reads whichever credential landed in the isolated
auth store and picks its endpoint and model-id shape from it.

**Tech Stack:** SolidJS (renderer), Electron IPC, opencode's provider-auth SDK, Python (paperbanana).

## Global Constraints

- **Findings from the code that override the spec** (verified against `models.dev/api.json` and
  `PaperBanana-main/utils/generation_utils.py`, 2026-07-13):
  - `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.6-sol` and `gpt-5.3-codex` **already exist in
    models.dev**. They need NO `provider.models` declarations. The current hand-written Terra
    declaration in `opencode.packaged.jsonc` is not merely redundant, it is **wrong** (it claims
    a 400 000-token context; the real value is 1 050 000) and must be deleted.
  - The codex plugin's gate is `ALLOWED_MODELS ∪ {id : /^gpt-(\d+\.\d+)/ > 5.4}`. The 5.6 family
    passes on the version rule alone. `gpt-5.3-codex` does not (5.3 ≤ 5.4) and is not in
    `ALLOWED_MODELS` — that is the one-line vendor patch.
  - Google's env var in both models.dev and PaperBanana is **`GOOGLE_API_KEY`** (the spec said
    `GEMINI_API_KEY`, which is only an alias).
  - PaperBanana **already supports Google directly**: `call_model_with_retry_async` auto-detects
    (OpenRouter > Gemini > …) and `visualizer_agent` falls back to native Gemini image generation
    when `openrouter_client is None`. So dual-key needs **no monkeypatching** — only the right env
    var and the right model-id shape (`google/`-prefixed for OpenRouter, bare for Google).
- Provider ids are `openai`, `openrouter`, `google`.
- Never `git add -A`. Stage explicit paths.
- Vendor files we patch (`codex.ts`) are upstream-revert-prone — record in CLAUDE.md, same class
  as the rebrand.

---

### Task B1: Models — Terra/Luna/Sol via models.dev, Codex via a one-line gate patch

**Files:**
- Modify: `opencode-dev/paperino-config/opencode.packaged.jsonc` (drop the bogus declaration)
- Modify: `opencode-dev/packages/opencode/src/plugin/openai/codex.ts:15`
- Test: `opencode-dev/packages/opencode/src/plugin/openai/codex.paperino.test.ts` (new)

**Interfaces:**
- Produces: nothing importable. The observable contract is that with an `oauth` auth entry, the
  codex plugin's `models()` filter admits `gpt-5.6-{terra,luna,sol}` and `gpt-5.3-codex`.

- [ ] **Step 1: Write the failing test** — assert the gate admits all four ids and still rejects
      `gpt-5.5-pro` (in `DISALLOWED_MODELS`) and `gpt-4o`.

```ts
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The gate is a filter inside a plugin factory that needs a live provider + auth context, so
// assert on the rule itself: the ALLOWED_MODELS literal plus the >5.4 version rule.
function gate(id: string): boolean {
  const source = readFileSync(join(import.meta.dir, "codex.ts"), "utf8")
  const allowed = new Set(
    [...source.match(/const ALLOWED_MODELS = new Set\(\[([^\]]*)\]/)![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!),
  )
  const disallowed = new Set(
    [...source.match(/const DISALLOWED_MODELS = new Set\(\[([^\]]*)\]/)![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!),
  )
  if (allowed.has(id)) return true
  if (disallowed.has(id)) return false
  const match = id.match(/^gpt-(\d+\.\d+)/)
  return match ? parseFloat(match[1]!) > 5.4 : false
}

test("the subscription gate admits the models Paperino ships", () => {
  // The 5.6 family passes on the version rule alone.
  for (const id of ["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol"]) expect(gate(id)).toBe(true)
  // 5.3 <= 5.4, so Codex only passes if it is explicitly allowlisted.
  expect(gate("gpt-5.3-codex")).toBe(true)
})

test("the gate still rejects what upstream rejects", () => {
  expect(gate("gpt-5.5-pro")).toBe(false)
  expect(gate("gpt-4o")).toBe(false)
})
```

- [ ] **Step 2: Run it — expect `gpt-5.3-codex` to fail**

Run: `bun test packages/opencode/src/plugin/openai/codex.paperino.test.ts`
Expected: FAIL — "expected false to be true" for `gpt-5.3-codex`.

- [ ] **Step 3: Patch the allowlist** (`codex.ts:15`)

```ts
// gpt-5.3-codex is the newest Codex (2026-02-05) but 5.3 <= the 5.4 version gate below, so it
// only reaches a subscription user if it is named here. Paperino ships it; upstream merges
// revert this line.
const ALLOWED_MODELS = new Set(["gpt-5.5", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.4", "gpt-5.4-mini"])
```

- [ ] **Step 4: Delete the bogus model declaration** from `opencode.packaged.jsonc` — keep
      `"model": "openai/gpt-5.6-terra"`, remove the whole `"provider"` block.

- [ ] **Step 5: Run tests + typecheck.** Expected: PASS.

- [ ] **Step 6: Commit** — `feat(models): ship Terra/Luna/Sol + 5.3-codex on the subscription`

---

### Task B2: PaperBanana dual-key (OpenRouter **or** Google)

**Files:**
- Modify: `paperbanana-mcp/server.py` (replace `_openrouter_key`)
- Modify: `opencode-dev/paperino-config/opencode.packaged.jsonc` (stop pinning prefixed model ids)
- Test: `paperbanana-mcp/test_credentials.py` (new)

**Interfaces:**
- Produces: `resolve_credentials(env, auth) -> Credentials(source, key, image_model, vlm_model)`,
  a **pure** function (env dict + parsed auth dict in, decision out) so it is testable without a
  filesystem or network. `apply_credentials()` is the thin impure wrapper that reads `auth.json`
  (honoring `XDG_DATA_HOME`) and mutates `os.environ`.

- [ ] **Step 1: Write the failing test**

```python
import pytest
from server import resolve_credentials

OR_IMAGE, OR_VLM = "google/gemini-3.1-flash-image-preview", "google/gemini-3.5-flash"
G_IMAGE, G_VLM = "gemini-3.1-flash-image-preview", "gemini-3.5-flash"


def test_env_openrouter_wins_over_everything():
    c = resolve_credentials({"OPENROUTER_API_KEY": "sk-or-env"}, {"google": {"key": "g"}})
    assert (c.source, c.key) == ("openrouter", "sk-or-env")
    assert (c.image_model, c.vlm_model) == (OR_IMAGE, OR_VLM)


def test_env_google_when_no_openrouter():
    c = resolve_credentials({"GOOGLE_API_KEY": "g-env"}, {})
    assert (c.source, c.key) == ("google", "g-env")
    # Google direct takes UNPREFIXED ids; a "google/" prefix is an OpenRouter-ism.
    assert (c.image_model, c.vlm_model) == (G_IMAGE, G_VLM)


def test_gemini_api_key_is_accepted_as_an_alias():
    assert resolve_credentials({"GEMINI_API_KEY": "g"}, {}).source == "google"


def test_auth_store_openrouter_beats_auth_store_google():
    c = resolve_credentials({}, {"openrouter": {"key": "sk-or"}, "google": {"key": "g"}})
    assert (c.source, c.key) == ("openrouter", "sk-or")


def test_auth_store_google_alone():
    c = resolve_credentials({}, {"google": {"key": "g-auth"}})
    assert (c.source, c.key) == ("google", "g-auth")


def test_no_key_anywhere_names_both_options():
    with pytest.raises(RuntimeError) as e:
        resolve_credentials({}, {})
    assert "OpenRouter" in str(e.value) and "Google" in str(e.value)
```

- [ ] **Step 2: Run it** — `python -m pytest test_credentials.py` → FAIL (`ImportError: cannot
      import name 'resolve_credentials'`).

- [ ] **Step 3: Implement** in `server.py`, replacing `_openrouter_key()`:

```python
from dataclasses import dataclass

# Nano Banana + the Critic's VLM, in each provider's id shape. OpenRouter namespaces every model
# ("google/x"); Google's own API takes the bare id. Same weights either way.
_MODELS = {
    "openrouter": ("google/gemini-3.1-flash-image-preview", "google/gemini-3.5-flash"),
    "google": ("gemini-3.1-flash-image-preview", "gemini-3.5-flash"),
}


@dataclass(frozen=True)
class Credentials:
    source: str  # "openrouter" | "google"
    key: str
    image_model: str
    vlm_model: str


def resolve_credentials(env: dict, auth: dict) -> Credentials:
    """Pick the figure-generation credential. Env beats the auth store; OpenRouter beats Google.

    Pure on purpose: the precedence rules are the whole behaviour, and they should be testable
    without an auth.json on disk.
    """

    def make(source: str, key: str) -> Credentials:
        image, vlm = _MODELS[source]
        return Credentials(source, key, image, vlm)

    if env.get("OPENROUTER_API_KEY"):
        return make("openrouter", env["OPENROUTER_API_KEY"])
    for name in ("GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"):
        if env.get(name):
            return make("google", env[name])
    for source in ("openrouter", "google"):
        key = (auth.get(source) or {}).get("key", "")
        if key:
            return make(source, key)
    raise RuntimeError(
        "No figure-generation key. Paste an OpenRouter key (openrouter.ai/keys) or a Google "
        "AI Studio key (aistudio.google.com/apikey) in Paperino's onboarding, or set "
        "OPENROUTER_API_KEY / GOOGLE_API_KEY."
    )


def _auth_store() -> dict:
    # The packaged app isolates its auth store inside userData (XDG_DATA_HOME) so it never shares
    # credentials with InteJer; dev falls back to the standard location.
    data_home = os.environ.get("XDG_DATA_HOME")
    base = Path(data_home) if data_home else Path.home() / ".local" / "share"
    auth = base / "opencode" / "auth.json"
    if not auth.exists():
        return {}
    try:
        return json.loads(auth.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def apply_credentials() -> Credentials:
    """Resolve, then shape the environment PaperBanana's client factory reads at import time."""
    creds = resolve_credentials(dict(os.environ), _auth_store())
    if creds.source == "openrouter":
        os.environ["OPENROUTER_API_KEY"] = creds.key
    else:
        # OpenRouter wins PaperBanana's auto-detect, so a stale OPENROUTER_API_KEY in the
        # environment would silently route a Google user through OpenRouter with a Google key.
        os.environ.pop("OPENROUTER_API_KEY", None)
        os.environ["GOOGLE_API_KEY"] = creds.key
    os.environ["IMAGE_GEN_MODEL_NAME"] = creds.image_model
    os.environ["MAIN_MODEL_NAME"] = creds.vlm_model
    return creds
```

  Replace the two `_openrouter_key()` call sites with `apply_credentials()`, and make the module
  take `IMAGE_MODEL`/`VLM_MODEL` from the resolved credentials rather than pinning them at import.

- [ ] **Step 4: Run the tests.** Expected: 6 pass.

- [ ] **Step 5: Drop the pinned model env from the config template.** `opencode.packaged.jsonc`'s
      paperbanana `environment` currently hardcodes `MAIN_MODEL_NAME`/`IMAGE_GEN_MODEL_NAME` with
      `google/`-prefixed ids, which would be wrong for a Google-key user. Remove both; the server
      now sets them from the resolved source.

- [ ] **Step 6: Commit** — `feat(paperbanana): accept an OpenRouter or a Google key`

---

### Task B3: The wizard's gate (main process)

**Files:**
- Modify: `opencode-dev/packages/desktop/src/main/paperino/ipc.ts`
- Modify: `opencode-dev/packages/desktop/src/main/store-keys.ts`
- Modify: `opencode-dev/packages/desktop/src/preload/index.ts`, `src/preload/types.ts`
- Test: `opencode-dev/packages/desktop/src/main/paperino/onboarding.test.ts` (new)

**Interfaces:**
- Produces: `window.api.paperino.onboardingStatus(): Promise<{ pending: boolean; packaged: boolean }>`
  and `window.api.paperino.onboardingComplete(): Promise<void>`.
- Consumes: `setupStatus()` from Plan A / T5 (already shipped).

- [ ] **Step 1: Write the failing test** for the store gate: pending is true until completed,
      false after; `packaged` mirrors `app.isPackaged`.
- [ ] **Step 2: Run it** → FAIL (handler not registered).
- [ ] **Step 3: Implement.** New store key
      `PAPERINO_ONBOARDING_COMPLETE_KEY = "paperino.onboarding.complete"`. Two `ipcMain.handle`s;
      two preload methods; two type entries.
      **The wizard shows in dev too** (gated on the store key, not on `isPackaged`) — otherwise it
      is untestable without packaging. `packaged` is returned so the wizard can hide the
      runtime-setup step in dev, where Chromium and Python come from the repo.
- [ ] **Step 4: Run tests + typecheck.** Expected: PASS.
- [ ] **Step 5: Commit** — `feat(desktop): gate + IPC for the Paperino onboarding wizard`

---

### Task B4: The wizard itself

**Files:**
- Create: `opencode-dev/packages/app/src/components/paperino/onboarding-wizard.tsx`
- Modify: `opencode-dev/packages/app/src/pages/new-session.tsx` (mount it — the screen a first
  launch actually lands on; see CLAUDE.md's "v2 layout renders new-session.tsx" invariant)
- Test: `opencode-dev/packages/app/src/components/paperino/onboarding-wizard.test.ts` (new — the
  pure step-machine logic; the JSX is verified by running the app)

**Interfaces:**
- Consumes: `window.api.paperino.{onboardingStatus,onboardingComplete,setupStatus,setupRun,onSetupProgress}`;
  `useProviderConnectController` + `DialogConnectProvider` from `../dialog-connect-provider`;
  `useDialog`; `useServerSDK`.
- Produces: `<PaperinoOnboarding />` — self-gating; renders `null` when not pending.

- [ ] **Step 1: Write the failing test** for the step machine: `steps(packaged)` omits `runtime`
      when not packaged; `next()` advances; the last step reports `done`.
- [ ] **Step 2: Run it** → FAIL (module not found).
- [ ] **Step 3: Implement the step machine + the component.**
      - *Welcome*: what Paperino is; one Continue button.
      - *Runtime setup* (packaged only): two rows (Chromium, Python) with progress from
        `onSetupProgress`; "Install" / "Skip for now". Already-installed rows show a check.
      - *ChatGPT*: one button → `controller.select("openai")` then
        `dialog.show(() => <DialogConnectProvider controller={controller} />)`. **Reuses the fork's
        OAuth flow** — no second implementation of PKCE, the callback server, or token storage.
        Skippable.
      - *Nano Banana key*: OpenRouter | Google segmented toggle + one paste field + the matching
        "get a key" link; on submit `client.auth.set({ providerID, auth: { type: "api", key } })`.
        Skippable.
      - *Done* → `window.api.paperino.onboardingComplete()`.
- [ ] **Step 4: Run tests + typecheck.** Expected: PASS.
- [ ] **Step 5: Verify in the running dev app** (`paperino-dev.cmd`, wizard forced by clearing the
      store key): walk every step, sign in with the real ChatGPT account, paste a real key.
- [ ] **Step 6: Commit** — `feat(app): first-run onboarding wizard`

---

### Task B5: Package, and prove it on the installed build

**Files:**
- Modify: `Paperino/CLAUDE.md` (record the codex-gate patch as upstream-revert-prone; record the
  Google-vs-OpenRouter model-id shapes)

- [ ] **Step 1:** `OPENCODE_CHANNEL=prod bun run build && bun run package:win` (app closed first —
      electron-builder cannot rewrite `win-unpacked` while it runs).
- [ ] **Step 2:** Wipe userData, run the installed app, walk the wizard.
- [ ] **Step 3:** Confirm in the app: the model picker lists Terra, Luna, Sol and 5.3 Codex; a chat
      with Terra answers; `generate_figure` produces a figure with the pasted key.
- [ ] **Step 4:** Confirm isolation still holds (every `loading path=` inside userData).
- [ ] **Step 5: Commit** — `docs: record the codex gate patch and the dual-key model shapes`
