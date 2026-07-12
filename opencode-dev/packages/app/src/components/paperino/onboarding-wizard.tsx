import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Mark } from "@opencode-ai/ui/logo"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { For, Match, Show, Switch, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Link } from "@/components/link"
import { useServerSDK } from "@/context/server-sdk"
import { useProviders } from "@/hooks/use-providers"
import { DialogConnectProvider, useProviderConnectController } from "../dialog-connect-provider"
import { KEY_PROVIDERS, nextStep, wizardSteps, type KeyProvider, type WizardStep } from "./onboarding-steps"

type SetupComponent = "chromium" | "python"
type SetupProgress = { component: SetupComponent; phase: string; percent?: number }
type OnboardingBridge = {
  onboardingStatus: () => Promise<{ pending: boolean; packaged: boolean }>
  onboardingComplete: () => Promise<void>
  setupStatus: () => Promise<Record<SetupComponent, { installed: boolean }>>
  setupRun: (component: SetupComponent) => Promise<{ ok: true } | { ok: false; error: string }>
  onSetupProgress: (cb: (progress: SetupProgress) => void) => () => void
}

// This package cannot import the desktop package's preload types, so the bridge is declared
// structurally — the same shape paper-preview-panel.tsx uses.
const bridge = (): OnboardingBridge | undefined => (window as { api?: { paperino?: OnboardingBridge } }).api?.paperino

/**
 * Once per app run. The wizard has to be mounted inside a ServerSync/ServerSDK subtree — the
 * dialog it shows resolves those through its owner — and there is no single such ancestor: the
 * providers live per route (SelectedServerProviders for home/sessions, ResolvedDraftRoute for
 * /new-session). So it is mounted in both, and this flag keeps the second mount from re-showing
 * the wizard (or restarting it at step 1 on a route change).
 */
let shown = false

/**
 * Paperino's first run. Self-gating: it asks the main process whether the wizard is still pending
 * and renders nothing otherwise, so it is safe to mount in more than one place.
 */
export function PaperinoOnboarding() {
  const dialog = useDialog()

  onMount(() => {
    void (async () => {
      const api = bridge()
      if (!api || shown) return // no desktop bridge (browser/dev server): no first run to walk
      const status = await api.onboardingStatus().catch(() => undefined)
      if (!status?.pending) return
      shown = true
      dialog.show(() => <Wizard packaged={status.packaged} />)
    })()
  })

  return null
}

function Wizard(props: { packaged: boolean }) {
  const dialog = useDialog()
  const [step, setStep] = createSignal<WizardStep>("welcome")

  const steps = createMemo(() => wizardSteps(props.packaged))
  const position = createMemo(() => steps().indexOf(step()) + 1)
  const last = createMemo(() => steps().at(-1))

  // Continuing and skipping are the same move: every step is optional, and each stays reachable
  // (Settings re-runs the downloads; the model picker connects a provider).
  async function advance() {
    const next = nextStep(step(), props.packaged)
    if (next) {
      setStep(next)
      return
    }
    await bridge()?.onboardingComplete()
    dialog.close()
  }

  return (
    <Dialog
      size="large"
      title={
        <div class="flex items-center gap-2">
          <Mark class="size-5" />
          <span>Welcome to Paperino</span>
        </div>
      }
    >
      <div class="flex flex-col gap-6">
        <Switch>
          <Match when={step() === "welcome"}>
            <WelcomeStep />
          </Match>
          <Match when={step() === "runtime"}>
            <RuntimeStep />
          </Match>
          <Match when={step() === "chatgpt"}>
            <ChatGPTStep />
          </Match>
          <Match when={step() === "figure-key"}>
            <FigureKeyStep onSaved={() => void advance()} />
          </Match>
        </Switch>

        <div class="flex items-center justify-between">
          <span class="text-12-regular text-text-weak">
            Step {position()} of {steps().length}
          </span>
          <div class="flex items-center gap-2">
            <Show when={step() !== "welcome"}>
              <Button variant="ghost" onClick={() => void advance()}>
                Skip
              </Button>
            </Show>
            <Button variant="primary" onClick={() => void advance()}>
              {step() === last() ? "Finish" : "Continue"}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

function WelcomeStep() {
  return (
    <div class="flex flex-col gap-4">
      <div class="text-14-regular text-text-base">
        Paperino writes research papers with you: LaTeX with a live preview, figures and tables built
        from your own data, and citations resolved from real DOIs.
      </div>
      <div class="text-14-regular text-text-weak">
        It never invents a result. Numbers come from your files and references come from papers it has
        actually looked up — when something is missing it asks you rather than filling the gap.
      </div>
      <div class="text-14-regular text-text-weak">A few short steps and you are set up.</div>
    </div>
  )
}

/**
 * Chromium (Figure Studio) and a portable CPython (PaperBanana + the Word/Excel/PDF skills). They
 * are downloaded rather than shipped — that is what keeps the installer ~150MB instead of ~500MB.
 */
function RuntimeStep() {
  const api = bridge()
  const [installed, setInstalled] = createSignal<Record<SetupComponent, boolean>>({ chromium: false, python: false })
  const [progress, setProgress] = createSignal<Partial<Record<SetupComponent, SetupProgress>>>({})
  const [busy, setBusy] = createSignal<SetupComponent | undefined>()
  const [error, setError] = createSignal<string | undefined>()

  const refresh = async () => {
    const status = await api?.setupStatus()
    if (!status) return
    setInstalled({ chromium: status.chromium.installed, python: status.python.installed })
  }

  onMount(() => {
    void refresh()
    const off = api?.onSetupProgress((update) => setProgress((current) => ({ ...current, [update.component]: update })))
    onCleanup(() => off?.())
  })

  async function install(component: SetupComponent) {
    setBusy(component)
    setError(undefined)
    const result = await api?.setupRun(component)
    setBusy(undefined)
    // A failed download must say so. Silence here reads as "installed".
    if (result && !result.ok) setError(result.error)
    await refresh()
  }

  const rows: Array<{ id: SetupComponent; label: string; detail: string }> = [
    { id: "chromium", label: "Chromium", detail: "Renders Figure Studio figures. About 130 MB." },
    { id: "python", label: "Python", detail: "Runs PaperBanana and the Word/Excel/PDF skills. About 90 MB." },
  ]

  return (
    <div class="flex flex-col gap-4">
      <div class="text-14-regular text-text-base">
        Paperino needs two runtimes. They download once, into this app's own folder.
      </div>

      <For each={rows}>
        {(row) => (
          <div class="flex items-center justify-between gap-4 rounded border border-border-weak p-3">
            <div class="flex flex-col">
              <span class="text-14-medium text-text-base">{row.label}</span>
              <span class="text-12-regular text-text-weak">
                <Show when={busy() === row.id && progress()[row.id]} fallback={row.detail}>
                  {(update) => (
                    <>
                      {update().phase}
                      <Show when={update().percent !== undefined}> — {update().percent}%</Show>
                    </>
                  )}
                </Show>
              </span>
            </div>
            <Switch>
              <Match when={installed()[row.id]}>
                <span class="flex items-center gap-1 text-12-regular text-text-weak">
                  <Icon name="check" /> Installed
                </span>
              </Match>
              <Match when={busy() === row.id}>
                <Spinner />
              </Match>
              <Match when={true}>
                <Button variant="secondary" onClick={() => void install(row.id)} disabled={busy() !== undefined}>
                  Install
                </Button>
              </Match>
            </Switch>
          </div>
        )}
      </For>

      <Show when={error()}>{(message) => <div class="text-12-regular text-text-danger">{message()}</div>}</Show>
      <div class="text-12-regular text-text-weak">
        You can skip and finish this later from Settings — but figures will not render until you do.
      </div>
    </div>
  )
}

/**
 * Sign in with the user's ChatGPT subscription. This does NOT reimplement OAuth: it opens the fork's
 * own provider dialog with `openai` preselected, so PKCE, the callback server on port 1455 and the
 * token store all stay in one place.
 */
function ChatGPTStep() {
  const dialog = useDialog()
  const providers = useProviders()
  const controller = useProviderConnectController()

  const signedIn = createMemo(() => providers.connected().some((provider) => provider.id === "openai"))

  function connect() {
    controller.select("openai")
    // push, not show: the wizard stays underneath and reappears when this dialog closes.
    void dialog.push(() => <DialogConnectProvider controller={controller} />)
  }

  return (
    <div class="flex flex-col gap-4">
      {/* Name only what the Codex backend actually serves a ChatGPT account — see the probe table
          in plugin/openai/codex.ts. Luna is listed by models.dev but 404s here. */}
      <div class="text-14-regular text-text-base">
        Sign in with your ChatGPT account to write with GPT-5.6 Terra, GPT-5.6 Sol and GPT-5.5.
      </div>
      <div class="text-14-regular text-text-weak">
        This uses your existing Pro or Plus subscription — no API key, and no per-token bill. Choose
        "ChatGPT" when it asks how you want to sign in.
      </div>
      <Show
        when={!signedIn()}
        fallback={
          <div class="flex items-center gap-2 text-14-regular text-text-base">
            <Icon name="check" /> Signed in with ChatGPT.
          </div>
        }
      >
        <div>
          <Button variant="secondary" onClick={connect}>
            Sign in with ChatGPT
          </Button>
        </div>
      </Show>
    </div>
  )
}

/**
 * The Nano Banana key. Either provider works, and the choice is load-bearing: it decides the
 * endpoint AND the model-id shape downstream (paperbanana-mcp resolves both from whichever key it
 * finds in the auth store, under exactly these provider ids).
 */
function FigureKeyStep(props: { onSaved: () => void }) {
  const serverSDK = useServerSDK()
  const providers = useProviders()
  const [selected, setSelected] = createSignal<KeyProvider>(KEY_PROVIDERS[0]!)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>()

  const alreadySaved = createMemo(() => providers.connected().some((provider) => provider.id === selected().id))

  async function save(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    const key = String(new FormData(form).get("apiKey") ?? "").trim()
    if (!key) {
      setError("Paste a key first, or skip this step.")
      return
    }

    setSaving(true)
    setError(undefined)
    const saved = await serverSDK()
      .client.auth.set({ providerID: selected().id, auth: { type: "api", key } })
      .then(() => true)
      .catch(() => false)
    setSaving(false)

    if (!saved) {
      setError("Could not save that key. Check it and try again.")
      return
    }
    props.onSaved()
  }

  return (
    <form class="flex flex-col gap-4" onSubmit={(event) => void save(event)}>
      <div class="text-14-regular text-text-base">
        To draw illustrative figures with Nano Banana, paste an API key. Either provider works.
      </div>

      <div class="flex gap-2">
        <For each={KEY_PROVIDERS}>
          {(provider) => (
            <Button
              type="button"
              variant={selected().id === provider.id ? "primary" : "secondary"}
              onClick={() => setSelected(provider)}
            >
              {provider.label}
            </Button>
          )}
        </For>
      </div>

      <div class="text-12-regular text-text-weak">
        {selected().hint} <Link href={selected().url}>Get a key</Link>
      </div>

      <TextField
        name="apiKey"
        type="password"
        label={`${selected().label} API key`}
        placeholder="Paste your key"
        class="font-mono"
        autocomplete="off"
      />

      <Show when={alreadySaved()}>
        <div class="flex items-center gap-2 text-12-regular text-text-weak">
          <Icon name="check" /> A {selected().label} key is already saved. Pasting a new one replaces it.
        </div>
      </Show>

      <Show when={error()}>{(message) => <div class="text-12-regular text-text-danger">{message()}</div>}</Show>

      <div>
        <Button type="submit" variant="secondary" disabled={saving()}>
          <Show when={saving()} fallback="Save key">
            <Spinner />
          </Show>
        </Button>
      </div>

      <div class="text-12-regular text-text-weak">
        Skip this and Figure Studio still works — it draws figures from your data as vector PDFs and
        needs no key at all. Only Nano Banana's image generation does.
      </div>
    </form>
  )
}
