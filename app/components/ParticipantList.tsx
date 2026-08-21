import type { PublicParticipant } from "../../shared/room-types"
import { Participant } from "./Participant"

interface ParticipantListProps {
  participants: PublicParticipant[]
  revealed: boolean
  youId?: string
}

export function ParticipantList({
  participants,
  revealed,
  youId,
}: ParticipantListProps) {
  const votedCount = participants.filter((p) => p.hasVoted).length

  return (
    <section className="flex flex-col items-center gap-6">
      <div className="relative w-full rounded-3xl border border-border/60 bg-card/40 px-4 py-10 sm:px-10">
        <span className="absolute top-3 left-1/2 -translate-x-1/2 text-[0.65rem] tracking-[0.2em] text-muted-foreground uppercase">
          {revealed
            ? "Results"
            : `${votedCount} of ${participants.length} voted`}
        </span>

        <ul className="flex flex-wrap items-start justify-center gap-x-4 gap-y-6 sm:gap-x-6">
          {participants.map((participant, index) => (
            <Participant
              key={participant.id}
              participant={participant}
              revealed={revealed}
              isYou={participant.id === youId}
              index={index}
            />
          ))}
        </ul>
      </div>
    </section>
  )
}
