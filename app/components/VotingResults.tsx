import { Sparkles } from "lucide-react"
import type { CSSProperties } from "react"

import { computeVoteStats, type PokerValue } from "../../shared/poker-scales"
import type { PublicRoomState } from "../../shared/room-types"
import { Badge } from "~/components/ui/badge"
import { ConsensusConfetti } from "./ConsensusConfetti"

/** Gap between staggered children. Short enough that the whole panel is
 *  settled well inside half a second. */
const STAGGER_MS = 40

/** Lets `--enter-delay` ride along in a style object without a cast at
 *  every call site. */
const enterDelay = (ms: number) =>
  ({ "--enter-delay": `${ms}ms` }) as CSSProperties

function formatNumber(value: number | undefined): string {
  if (value === undefined) return "—"
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function Stat({
  label,
  value,
  delay,
}: {
  label: string
  value: string
  delay: number
}) {
  return (
    <div
      className="enter-fade flex flex-col items-center gap-1"
      style={enterDelay(delay)}
    >
      <span className="text-xs font-medium tracking-widest text-muted-strong uppercase">
        {label}
      </span>
      <span className="font-heading text-3xl font-semibold tabular-nums">
        {value}
      </span>
    </div>
  )
}

/** Post-reveal summary. Derived purely from the votes the server sent. */
export function VotingResults({ room }: { room: PublicRoomState }) {
  const votes = room.participants
    .map((participant) => participant.vote)
    .filter((vote): vote is PokerValue => vote !== undefined)

  if (votes.length === 0) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        Nobody voted this round.
      </p>
    )
  }

  const stats = computeVoteStats(votes, room.scale)
  const maxCount = Math.max(...stats.distribution.map((entry) => entry.count))

  return (
    <>
      {/* Deliberately outside the panel: `.enter-fade` sets `translate`, and any
          transform makes an element the containing block for its fixed-position
          descendants — which would shrink the full-viewport confetti canvas
          down to the size of this panel. */}
      <ConsensusConfetti round={room.round} active={stats.consensus} />

      <section className="enter-fade flex flex-col gap-6 rounded-2xl border border-border/60 bg-card/60 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-sm font-semibold tracking-wide text-muted-strong uppercase">
            Round {room.round} results
          </h2>
          {stats.consensus && (
            <Badge className="gap-1">
              <Sparkles className="size-3" />
              Consensus
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="Average"
            value={formatNumber(stats.average)}
            delay={STAGGER_MS}
          />
          <Stat
            label="Median"
            value={formatNumber(stats.median)}
            delay={STAGGER_MS * 2}
          />
          <Stat
            label="Lowest"
            value={formatNumber(stats.min)}
            delay={STAGGER_MS * 3}
          />
          <Stat
            label="Highest"
            value={formatNumber(stats.max)}
            delay={STAGGER_MS * 4}
          />
        </div>

        <div className="flex flex-col gap-2">
          {stats.distribution.map((entry, index) => (
            <div
              key={entry.value}
              className="enter-fade flex items-center gap-3"
              // Picks up where the stat row left off, and is inherited by the
              // bar so its wipe starts with the row it belongs to.
              style={enterDelay(STAGGER_MS * (5 + index))}
            >
              <span className="w-8 text-right font-heading text-sm font-semibold">
                {entry.value}
              </span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted/40">
                <div
                  className="results-bar h-full rounded-full bg-[linear-gradient(90deg,#1C7FBF_0%,#3FA9E8_100%)] bg-no-repeat"
                  style={
                    {
                      "--fill": `${(entry.count / maxCount) * 100}%`,
                    } as CSSProperties
                  }
                />
              </div>
              <span className="w-16 text-xs text-muted-strong">
                {entry.count} {entry.count === 1 ? "vote" : "votes"}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
