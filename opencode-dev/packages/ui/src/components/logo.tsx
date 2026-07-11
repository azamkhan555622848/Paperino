import { type ComponentProps } from "solid-js"

// Paperino's mark: a sheet of paper with its top-right corner turned back, and three lines of
// set text. It replaces opencode's nested-square mark.
//
// Two things are load-bearing:
//
//   * The lines of text are CUT OUT of the page with fill-rule="evenodd", not painted in the
//     background colour. The mark sits on the app background, on the splash, on a dark panel
//     and on a light one — a rule painted "white" would show as a white slab on dark.
//   * The page keeps opencode's 16x20 viewBox, which is already a 4:5 page ratio. Every call
//     site sizes by CSS, so nothing downstream changes.
//
// The fold flap is the lighter of the two ink tones. That is what gives the mark its second
// tone without introducing a colour — the app themes both tones per light/dark.

// The text block starts at y=7, just under the fold, and ends 4 units above the foot. Set it
// lower (the obvious first guess) and the page reads bottom-heavy with a dead top-left corner.
const PAGE =
  // outer sheet, top-right corner cut on the diagonal
  "M2 1H10L14 5V19H2V1Z " +
  // three lines of text, knocked through by evenodd
  "M4.5 7H11.5V8.4H4.5V7Z " +
  "M4.5 10.2H11.5V11.6H4.5V10.2Z " +
  "M4.5 13.4H8.5V14.8H4.5V13.4Z"

const FOLD = "M10 1L14 5H10V1Z"

// Splash is the same geometry at 5x, so the two cannot drift apart.
const PAGE_LG =
  "M10 5H50L70 25V95H10V5Z " +
  "M22.5 35H57.5V42H22.5V35Z " +
  "M22.5 51H57.5V58H22.5V51Z " +
  "M22.5 67H42.5V74H22.5V67Z"

const FOLD_LG = "M50 5L70 25H50V5Z"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        data-slot="logo-mark-page"
        fill-rule="evenodd"
        clip-rule="evenodd"
        d={PAGE}
        fill="var(--icon-strong-base)"
      />
      <path data-slot="logo-mark-fold" d={FOLD} fill="var(--icon-weak-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        data-slot="logo-splash-page"
        fill-rule="evenodd"
        clip-rule="evenodd"
        d={PAGE_LG}
        fill="var(--icon-strong-base)"
      />
      <path data-slot="logo-splash-fold" d={FOLD_LG} fill="var(--icon-base)" />
    </svg>
  )
}

// The wordmark: the mark, then the name. opencode drew its letters as pixel blocks; Paperino is
// a paper, so it wears a real typeface. Georgia is a system face on every platform the app
// ships to, so the wordmark cannot silently fall back to a face that was never designed for.
export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 190 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g transform="translate(0 6) scale(1.45)">
        <path fill-rule="evenodd" clip-rule="evenodd" d={PAGE} fill="var(--icon-strong-base)" />
        <path d={FOLD} fill="var(--icon-weak-base)" />
      </g>
      <text
        x="34"
        y="32"
        font-size="30"
        letter-spacing="-0.4"
        fill="var(--icon-strong-base)"
        style={{ "font-family": "Georgia, 'Iowan Old Style', 'Palatino Linotype', Palatino, serif" }}
      >
        Paperino
      </text>
    </svg>
  )
}
