import { ArrowRight, Check, Link2, LogOut, Plus } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"

import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { ConnectionIndicator } from "./ConnectionIndicator"
import type { ConnectionStatus } from "~/hooks/useRoomSocket"

interface RoomHeaderProps {
  roomId: string
  round: number
  status: ConnectionStatus
  onNewRoom: () => void
  onJoinOther: () => void
  onLeave: () => void
}

/**
 * The utility bar: room code, round, connection, and the actions for leaving
 * or switching rooms. The room's own name lives in `RoomTitle` instead, front
 * and center above the table — this bar is chrome, not identity.
 */
export function RoomHeader({
  roomId,
  round,
  status,
  onNewRoom,
  onJoinOther,
  onLeave,
}: RoomHeaderProps) {
  const [copied, setCopied] = useState(false)

  const copyInviteLink = async () => {
    const url = `${window.location.origin}/room/${roomId}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Clipboard blocked (insecure context or denied permission).
      window.prompt("Copy this invite link", url)
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3">
        <Link
          to="/"
          viewTransition
          className="-my-2 flex shrink-0 items-center gap-1"
          aria-label="Scrum Poker home"
        >
          {/* The source art sits inside ~22% transparent padding, which reads
              as a tiny mark at header size — scale it inside a clipped box. */}
          <span className="grid size-9 shrink-0 place-items-center overflow-hidden">
            <img
              src="/logo_poker.webp"
              alt=""
              width={500}
              height={500}
              className="size-9 scale-[1.7]"
            />
          </span>
          <span className="hidden font-heading text-sm font-semibold tracking-tight sm:block">
            Scrum<span className="text-primary">Poker</span>
          </span>
        </Link>

        <code className="shrink-0 rounded-md bg-muted/60 px-2 py-1 font-heading text-sm font-semibold tracking-[0.2em]">
          {roomId}
        </code>

        <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
          Round {round}
        </Badge>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <ConnectionIndicator status={status} />

          <Button variant="outline" size="sm" onClick={copyInviteLink}>
            {copied ? <Check className="text-emerald-500" /> : <Link2 />}
            <span className="hidden sm:inline">
              {copied ? "Copied" : "Invite"}
            </span>
          </Button>

          {/* Switching rooms, spelled out rather than hidden behind a menu. */}
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" />

          <Button
            variant="ghost"
            size="sm"
            onClick={onNewRoom}
            title="Create a new room"
          >
            <Plus />
            <span className="hidden md:inline">New room</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={onJoinOther}
            title="Join a different room with a code"
          >
            <ArrowRight />
            <span className="hidden md:inline">Join other</span>
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Leave room"
            title="Leave this room"
            onClick={onLeave}
          >
            <LogOut />
          </Button>
        </div>
      </div>
    </header>
  )
}
