import type { PokerValue } from "../../shared/poker-scales"
import { cn } from "~/lib/utils"

interface PokerCardProps {
  value: PokerValue
  selected?: boolean
  disabled?: boolean
  onSelect?: (value: PokerValue) => void
}

/** A single selectable card in the deck. */
export function PokerCard({
  value,
  selected = false,
  disabled = false,
  onSelect,
}: PokerCardProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`Vote ${value}`}
      onClick={() => onSelect?.(value)}
      data-selected={selected || undefined}
      className={cn(
        // Named properties rather than `transition-all`, so a layout change
        // elsewhere can never accidentally become an animation here.
        "group relative flex aspect-2/3 w-13 shrink-0 items-center justify-center rounded-xl border text-lg font-semibold outline-none select-none sm:w-15 sm:text-xl",
        "transition-[transform,border-color,background-color,color,box-shadow,opacity] duration-200 ease-smooth",
        "border-border bg-card text-card-foreground shadow-xs",
        "hover:-translate-y-2 hover:border-primary/70 hover:shadow-lg",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "data-selected:-translate-y-3 data-selected:border-primary data-selected:bg-primary data-selected:text-primary-foreground data-selected:shadow-lg data-selected:shadow-primary/25",
        // Composes with the hover/selected lift instead of fighting it, so the
        // card gives way under the finger and springs back on release.
        "active:scale-[0.96] active:duration-100",
        "disabled:pointer-events-none disabled:opacity-40"
      )}
    >
      <span className="absolute top-1 left-1.5 text-[0.6rem] opacity-45">
        {value}
      </span>
      <span className="font-heading">{value}</span>
      <span className="absolute right-1.5 bottom-1 rotate-180 text-[0.6rem] opacity-45">
        {value}
      </span>
    </button>
  )
}
