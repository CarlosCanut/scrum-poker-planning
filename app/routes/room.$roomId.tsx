import { LoaderCircle, TriangleAlert } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router"

import { isValidRoomCode, normalizeRoomCode } from "../../shared/room-code"
import { MAX_NAME_LENGTH } from "../../shared/room-types"
import { fieldErrors, nameFormSchema } from "../../shared/validation"
import { ParticipantList } from "~/components/ParticipantList"
import { PokerDeck } from "~/components/PokerDeck"
import { RoomControls } from "~/components/RoomControls"
import { RoomHeader } from "~/components/RoomHeader"
import { RoomTitle } from "~/components/RoomTitle"
import { VotingResults } from "~/components/VotingResults"
import { Alert, AlertDescription } from "~/components/ui/alert"
import { Button } from "~/components/ui/button"
import { FieldError } from "~/components/ui/field-error"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { useParticipantIdentity } from "~/hooks/useParticipantIdentity"
import { useRoomSocket } from "~/hooks/useRoomSocket"
import { originFromMatches, pageMeta } from "~/lib/meta"
import { findRoom } from "~/lib/room-client"
import type { Route } from "./+types/room.$roomId"

export function meta({ params, matches }: Route.MetaArgs) {
  const roomId = normalizeRoomCode(params.roomId ?? "")
  return pageMeta({
    origin: originFromMatches(matches),
    title: `Room ${roomId} · Scrum Poker`,
    description: `Join room ${roomId} to estimate story points with your team.`,
    path: `/room/${roomId}`,
    // Room links are shared privately; they should never be indexed.
    noindex: true,
  })
}

export default function RoomPage({ params }: Route.ComponentProps) {
  const roomId = normalizeRoomCode(params.roomId ?? "")
  const navigate = useNavigate()
  const { identity, ready, saveName } = useParticipantIdentity()

  const { room, connectionStatus, error, myVote, vote, reveal, reset, leave } =
    useRoomSocket(roomId, ready && isValidRoomCode(roomId) ? identity : null)

  if (!isValidRoomCode(roomId)) {
    return (
      <Fallback
        title="Invalid room code"
        message="Room codes are 6 characters, like ABC123."
      />
    )
  }

  // Nothing renders before the stored identity is known, so the server HTML and
  // the first client render stay identical.
  if (!ready) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!identity) {
    return <NameGate roomId={roomId} onSubmit={(name) => saveName(name)} />
  }

  const roomIsGone =
    error?.code === "ROOM_NOT_FOUND" || connectionStatus === "disconnected"

  /**
   * Every way out of a room is the same move: tell the Durable Object we are
   * gone, then go to the lobby. Starting or joining another room needs a name
   * or a code, so those hand off to the matching lobby tab rather than
   * conjuring a room silently.
   */
  const exitTo = (path: string) => () => {
    leave()
    navigate(path, { viewTransition: true })
  }

  return (
    <div className="flex min-h-svh flex-col">
      <RoomHeader
        roomId={roomId}
        round={room?.round ?? 1}
        status={connectionStatus}
        onNewRoom={exitTo("/")}
        onJoinOther={exitTo("/?mode=join")}
        onLeave={exitTo("/")}
      />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8">
        {roomIsGone ? (
          <Alert variant="destructive" className="mx-auto max-w-md">
            <TriangleAlert />
            <AlertDescription className="flex flex-col items-start gap-2">
              {error?.message ?? "This room does not exist or has expired."}
              <Link
                to="/"
                viewTransition
                className="text-primary underline underline-offset-4"
              >
                Start a new room
              </Link>
            </AlertDescription>
          </Alert>
        ) : !room ? (
          <div className="flex flex-1 items-center justify-center">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <RoomTitle
              roomName={room.name}
              roomId={roomId}
              round={room.round}
            />

            <ParticipantList
              participants={room.participants}
              revealed={room.phase === "revealed"}
              youId={identity.id}
            />

            {room.phase === "revealed" && <VotingResults room={room} />}

            <RoomControls
              room={room}
              offline={connectionStatus !== "connected"}
              onReveal={reveal}
              onReset={reset}
            />

            {error && error.code !== "ROOM_NOT_FOUND" && (
              <Alert variant="destructive" className="mx-auto max-w-md">
                <TriangleAlert />
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            )}
          </>
        )}
      </main>

      {room && !roomIsGone && (
        <footer className="sticky bottom-0 border-t border-border/60 bg-card/30 px-4 py-5 backdrop-blur-md">
          <div className="mx-auto max-w-5xl">
            <PokerDeck
              scale={room.scale}
              selected={myVote}
              disabled={
                room.phase === "revealed" || connectionStatus !== "connected"
              }
              onSelect={vote}
            />
          </div>
        </footer>
      )}
    </div>
  )
}

/** Shown when someone opens a room link without a stored identity. */
function NameGate({
  roomId,
  onSubmit,
}: {
  roomId: string
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState("")
  const [error, setError] = useState<string | undefined>(undefined)
  // The socket needs an identity before it will connect, so the room's name is
  // fetched over HTTP just for this screen. It is decoration: if the lookup
  // fails, the code alone still says which room this is.
  const [roomName, setRoomName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    findRoom(roomId)
      .then((info) => {
        if (!cancelled && info.name) setRoomName(info.name)
      })
      .catch(() => {
        // Offline or expired — the room page itself reports that properly.
      })
    return () => {
      cancelled = true
    }
  }, [roomId])

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = nameFormSchema.safeParse({ name })
    if (!parsed.success) {
      setError(fieldErrors(parsed.error).name)
      return
    }
    onSubmit(parsed.data.name)
  }

  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-border/60 bg-card/60 p-6 shadow-xl"
      >
        <div className="flex flex-col gap-1">
          <img
            src="/logo_poker.webp"
            alt=""
            width={500}
            height={500}
            className="-mt-2 -mb-2 size-20 self-center"
          />
          <h1 className="font-heading text-xl font-semibold text-balance">
            {roomName ? (
              <>Join {roomName}</>
            ) : (
              <>
                Join room{" "}
                <span className="tracking-[0.2em] uppercase">{roomId}</span>
              </>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {roomName ? (
              <>
                Room{" "}
                <span className="tracking-[0.2em] uppercase">{roomId}</span> —
                pick the name your team will see.
              </>
            ) : (
              <>Pick the name your team will see.</>
            )}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Your name</Label>
          <Input
            id="name"
            autoFocus
            placeholder="Alex"
            maxLength={MAX_NAME_LENGTH}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "name-error" : undefined}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setError(undefined)
            }}
          />
          <FieldError id="name-error">{error}</FieldError>
        </div>

        <Button type="submit" size="lg">
          Join room
        </Button>
      </form>
    </main>
  )
}

function Fallback({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="font-heading text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Link
        to="/"
        viewTransition
        className="text-sm text-primary underline underline-offset-4"
      >
        Back to the lobby
      </Link>
    </main>
  )
}
