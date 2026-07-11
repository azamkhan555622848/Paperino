import type { JSX } from "solid-js"
import { Mark } from "@opencode-ai/ui/logo"
import { NEW_SESSION_CONTENT_WIDTH } from "@/pages/session/new-session-layout"

export function NewSessionDesignView(props: { children: JSX.Element }) {
  return (
    <div data-component="session-new-design" class="relative size-full overflow-hidden bg-v2-background-bg-deep ">
      <div class="absolute inset-x-0 top-[25.375%] flex justify-center px-6">
        <div class={NEW_SESSION_CONTENT_WIDTH}>
          {/* Paperino lockup replaces the stock opencode wordmark. The v2 layout is the screen
              the user actually lands on, and it carried the name with no mark at all — so this
              is the one place the logo is seen day to day. */}
          <div class="flex items-center justify-center gap-3.5 select-none">
            <Mark class="w-8 shrink-0" />
            <div class="text-[44px] leading-none font-semibold tracking-tight text-v2-icon-icon-base">Paperino</div>
          </div>
          <div class="mt-8">{props.children}</div>
        </div>
      </div>
    </div>
  )
}
