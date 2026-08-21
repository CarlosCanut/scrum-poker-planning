import { Eye, RotateCcw } from "lucide-react"

import type { PublicRoomState } from "../../shared/room-types"
import { Button } from "~/components/ui/button"

interface RoomControlsProps {
  room: PublicRoomState
  /** True while the socket is not open — actions would be dropped silently. */
  offline: boolean
  onReveal: () => void
  onReset: () => void
}

/**
 * The round controls, available to everyone in the room.
 *
 * Whoever is running the session is not necessarily whoever opened the room,
 * so both actions are open to any participant — the Durable Object checks only
 * that the caller has joined.
 */
export function RoomControls({
  room,
  offline,
  onReveal,
  onReset,
}: RoomControlsProps) {
  const votes = room.participants.filter((p) => p.hasVoted).length
  const waiting = room.participants.length - votes

  return (
    <div className="flex flex-col items-center justify-center gap-2">
      {room.phase === "voting" ? (
        <Button
          key="reveal"
          className="swap-fade"
          size="lg"
          disabled={offline || votes === 0}
          onClick={onReveal}
        >
          <Eye />
          Reveal votes
        </Button>
      ) : (
        <Button
          key="reset"
          className="swap-fade"
          size="lg"
          disabled={offline}
          onClick={onReset}
        >
          <RotateCcw />
          New round
        </Button>
      )}

      {/* Keyed on the phase so the line fades when the round moves on, rather
          than swapping mid-sentence under the reader. */}
      <p key={room.phase} className="swap-fade text-xs text-muted-foreground">
        {offline
          ? "Reconnecting — hold on a moment."
          : room.phase === "revealed"
            ? "Anyone can start the next round."
            : votes === 0
              ? "Reveal unlocks once somebody votes."
              : waiting > 0
                ? `Still waiting on ${waiting} ${waiting === 1 ? "person" : "people"} — anyone can reveal.`
                : "Everybody voted. Anyone can reveal."}
      </p>
    </div>
  )
}
