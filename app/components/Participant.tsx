import { Crown } from "lucide-react"
import type { CSSProperties } from "react"

import type { PublicParticipant } from "../../shared/room-types"
import { cn } from "~/lib/utils"

interface ParticipantProps {
  participant: PublicParticipant
  revealed: boolean
  isYou: boolean
  /** Seat order, used to stagger the reveal around the table. */
  index?: number
}

/** Gap between seats flipping. Short enough that a full table is turned over
 *  in well under half a second. */
const STAGGER_MS = 45

/**
 * One seat at the table: the card this participant played (face down until the
 * owner reveals) plus their name.
 */
export function Participant({
  participant,
  revealed,
  isYou,
  index = 0,
}: ParticipantProps) {
  const { hasVoted, connected, vote } = participant
  const showFront = revealed && hasVoted

  return (
    // `--enter-delay` is inherited, so it times both the seat arriving and the
    // card flipping without being wired up twice.
    <li
      className="enter-fade flex w-20 flex-col items-center gap-2 sm:w-24"
      style={{ "--enter-delay": `${index * STAGGER_MS}ms` } as CSSProperties}
    >
      <div className="aspect-2/3 w-13 perspective-distant sm:w-15">
        <div
          className={cn(
            "card-flip relative size-full transform-3d",
            showFront && "rotate-y-180"
          )}
        >
          {/* Back of the card — what everyone sees while voting. */}
          <div
            className={cn(
              "absolute inset-0 flex items-center justify-center rounded-xl border backface-hidden",
              hasVoted
                ? "border-primary bg-primary/85 shadow-md shadow-primary/20"
                : "border-dashed border-border/70 bg-muted/20"
            )}
          >
            {hasVoted ? (
              <div className="size-full rounded-xl bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(255,255,255,0.14)_4px,rgba(255,255,255,0.14)_8px)]" />
            ) : (
              <span className="text-xl text-muted-foreground/60">?</span>
            )}
          </div>

          {/* Front of the card — only meaningful after the reveal. */}
          <div className="absolute inset-0 flex rotate-y-180 items-center justify-center rounded-xl border border-border bg-card font-heading text-xl font-semibold backface-hidden">
            {vote ?? ""}
          </div>
        </div>
      </div>

      <div
        className={cn(
          "flex w-full items-center justify-center gap-1",
          !connected && "opacity-40"
        )}
      >
        {participant.isOwner && (
          <Crown
            aria-label="Room owner"
            className="size-3.5 shrink-0 text-primary"
          />
        )}
        <span className="truncate text-xs font-medium" title={participant.name}>
          {participant.name}
        </span>
      </div>

      <span className="-mt-1.5 text-[0.65rem] text-muted-foreground">
        {!connected
          ? "offline"
          : isYou
            ? "you"
            : hasVoted && !revealed
              ? "voted"
              : ""}
      </span>
    </li>
  )
}
