import type { PokerValue } from "../../shared/poker-scales"
import { PokerCard } from "./PokerCard"

interface PokerDeckProps {
  scale: PokerValue[]
  selected?: PokerValue
  disabled?: boolean
  onSelect: (value: PokerValue) => void
}

export function PokerDeck({
  scale,
  selected,
  disabled = false,
  onSelect,
}: PokerDeckProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">
        {disabled ? "Votes are revealed" : "Pick your card"}
      </p>
      <div className="flex flex-wrap items-end justify-center gap-2 pt-3 sm:gap-3">
        {scale.map((value) => (
          <PokerCard
            key={value}
            value={value}
            selected={selected === value}
            disabled={disabled}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}
