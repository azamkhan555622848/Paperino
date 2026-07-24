import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { For, Show, createSignal } from "solid-js"
import { Link } from "@/components/link"

/**
 * Optional publisher text-and-data-mining keys. Each is issued by a publisher to a SUBSCRIBING
 * institution — the sanctioned way to read closed full text, and the user's own entitlement. They
 * live in auth.json beside the figure key, never in a config file and never in the installer: a key
 * in a shipped artifact is one institution's entitlement handed to everyone who downloads it.
 *
 * Every field is optional. With none set, the full-text ladder skips the TDM rung and falls through
 * to the institutional fetch — which is why this ships as settings, not as a wizard step.
 */
export type TdmProvider = {
  /** MUST match literature-mcp's tdm.ts, which reads auth.json by exactly this id. */
  id: "tdm-springer" | "tdm-elsevier" | "tdm-wiley"
  label: string
  /** Where a user whose institution subscribes goes to request a key. */
  url: string
  hint: string
}

export const TDM_PROVIDERS: TdmProvider[] = [
  {
    id: "tdm-springer",
    label: "Springer Nature",
    url: "https://dev.springernature.com",
    hint: "Nature, Springer, BMC, Palgrave.",
  },
  {
    id: "tdm-elsevier",
    label: "Elsevier",
    url: "https://dev.elsevier.com",
    hint: "ScienceDirect, Cell Press. Keyed requests must come from a subscribing network.",
  },
  {
    id: "tdm-wiley",
    label: "Wiley",
    url: "https://onlinelibrary.wiley.com/library-info/resources/text-and-datamining",
    hint: "Wiley Online Library.",
  },
]

export function FulltextKeys(props: { writeKey: (provider: string, key: string) => Promise<void> }) {
  const [saving, setSaving] = createSignal<string | undefined>()
  const [saved, setSaved] = createSignal<Record<string, boolean>>({})
  const [error, setError] = createSignal<Record<string, string | undefined>>({})

  // Uncontrolled, like the wizard's figure-key step: the key is read out of the form on submit and
  // the field is cleared straight after, so a secret never sits in a signal for the session's life.
  async function save(provider: TdmProvider, event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    const key = String(new FormData(form).get("apiKey") ?? "").trim()
    if (!key) {
      setError((e) => ({ ...e, [provider.id]: "Paste a key first." }))
      return
    }

    setSaving(provider.id)
    setError((e) => ({ ...e, [provider.id]: undefined }))
    const ok = await props
      .writeKey(provider.id, key)
      .then(() => true)
      .catch(() => false)
    setSaving(undefined)

    if (!ok) {
      setError((e) => ({ ...e, [provider.id]: "Could not save that key. Check it and try again." }))
      return
    }
    form.reset()
    setSaved((s) => ({ ...s, [provider.id]: true }))
  }

  // The settings-v2 panel chrome lives here rather than in dialog-settings-v2.tsx: that file is
  // upstream vendor code an opencode merge reverts, so the less of ours sits in it, the less we
  // lose. It gets an import, a trigger and a content pane — nothing more.
  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">Full text</h2>
      </div>
      <div class="settings-v2-tab-body flex flex-col gap-6">
        <div class="text-14-regular text-text-weak">
          Optional. If your institution subscribes, a text-and-data-mining key lets Paperino fetch
          the published version of a closed paper directly. Without one it will ask you to sign in
          and save the PDF yourself.
        </div>

        <For each={TDM_PROVIDERS}>
          {(provider) => (
            <form class="flex flex-col gap-2" onSubmit={(event) => void save(provider, event)}>
              <TextField
                name="apiKey"
                type="password"
                label={`${provider.label} TDM key`}
                placeholder="Paste your key"
                class="font-mono"
                autocomplete="off"
              />

              <div class="text-12-regular text-text-weak">
                {provider.hint} <Link href={provider.url}>Request a key</Link>
              </div>

              <Show when={error()[provider.id]}>
                {(message) => <div class="text-12-regular text-text-danger">{message()}</div>}
              </Show>

              <Show when={saved()[provider.id]}>
                <div class="flex items-center gap-2 text-12-regular text-text-weak">
                  <Icon name="check" /> Saved. Pasting a new key replaces it.
                </div>
              </Show>

              <div>
                <Button type="submit" variant="secondary" disabled={saving() === provider.id}>
                  <Show when={saving() === provider.id} fallback="Save key">
                    <Spinner />
                  </Show>
                </Button>
              </div>
            </form>
          )}
        </For>
      </div>
    </>
  )
}
