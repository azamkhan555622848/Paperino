// The shared v2 icon set has `expand`/`collapse`, but those are vertical arrows — they
// read as "expand this row", not "make this panel take over the window". The diagonal
// pair below is the maximize/restore idiom (the same one Claude's document preview uses).
// They live here rather than in packages/ui because that package is vendor code an
// upstream merge would overwrite.

type Props = { class?: string }

export function ExpandDiagonalIcon(props: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      <polyline points="14 4 20 4 20 10" />
      <polyline points="10 20 4 20 4 14" />
      <line x1="20" y1="4" x2="13" y2="11" />
      <line x1="4" y1="20" x2="11" y2="13" />
    </svg>
  )
}

export function CollapseDiagonalIcon(props: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      <polyline points="20 10 14 10 14 4" />
      <polyline points="4 14 10 14 10 20" />
      <line x1="13" y1="11" x2="20" y2="4" />
      <line x1="11" y1="13" x2="4" y2="20" />
    </svg>
  )
}
