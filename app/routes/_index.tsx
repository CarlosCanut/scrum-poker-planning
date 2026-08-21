import { ArrowRight, LoaderCircle, Plus } from "lucide-react"
import { useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router"

import { normalizeRoomCode } from "../../shared/room-code"
import { MAX_NAME_LENGTH, MAX_ROOM_NAME_LENGTH } from "../../shared/room-types"
import {
  createRoomFormSchema,
  fieldErrors,
  joinRoomFormSchema,
} from "../../shared/validation"
import { Alert, AlertDescription } from "~/components/ui/alert"
import { Button } from "~/components/ui/button"
import { FieldError } from "~/components/ui/field-error"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { useParticipantIdentity } from "~/hooks/useParticipantIdentity"
import { originFromMatches, pageMeta } from "~/lib/meta"
import { cn } from "~/lib/utils"
import { RoomApiError, createRoom, findRoom } from "~/lib/room-client"
import type { Route } from "./+types/_index"

type Mode = "create" | "join"

const MODES: Array<{ value: Mode; label: string; hint: string }> = [
  {
    value: "create",
    label: "Create",
    hint: "Name the room and share its code — anyone in it can reveal the votes.",
  },
  {
    value: "join",
    label: "Join",
    hint: "Ask a teammate for the 6-character room code.",
  },
]

export function meta({ matches }: Route.MetaArgs) {
  return pageMeta({
    origin: originFromMatches(matches),
    title: "Scrum Poker — Real-time story point estimation",
    path: "/",
  })
}

export default function Landing() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { adopt, saveName } = useParticipantIdentity()

  // Room pages link back here with ?mode=join to switch rooms.
  const [mode, setMode] = useState<Mode>(
    searchParams.get("mode") === "join" ? "join" : "create"
  )

  // Every field starts empty, on purpose: a pre-filled value from a previous
  // session reads as something already decided, and gets submitted unread.
  const [roomName, setRoomName] = useState("")
  const [name, setName] = useState("")
  const [code, setCode] = useState("")

  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const roomNameRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  /** Clears a field's complaint as soon as the user starts fixing it. */
  const clearError = (field: string) =>
    setErrors((current) => {
      if (!(field in current)) return current
      const { [field]: _removed, ...rest } = current
      return rest
    })

  const chooseMode = (next: Mode) => {
    setMode(next)
    // The two modes do not share their fields, so their complaints should not
    // outlive the switch either.
    setErrors({})
    setFormError(null)
    requestAnimationFrame(() =>
      (next === "join" ? codeRef : roomNameRef).current?.focus()
    )
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)

    // One schema per mode, and the parsed output is what gets sent — so the
    // request always carries trimmed, normalized values.
    const parsed =
      mode === "create"
        ? createRoomFormSchema.safeParse({ roomName, name })
        : joinRoomFormSchema.safeParse({ code, name })

    if (!parsed.success) {
      const found = fieldErrors(parsed.error)
      setErrors(found)
      const refs = { roomName: roomNameRef, code: codeRef, name: nameRef }
      for (const field of ["roomName", "code", "name"] as const) {
        if (found[field]) {
          refs[field].current?.focus()
          break
        }
      }
      return
    }

    setErrors({})
    setPending(true)
    try {
      if (parsed.data && "roomName" in parsed.data) {
        const room = await createRoom({
          roomName: parsed.data.roomName,
          name: parsed.data.name,
        })
        // The Worker issues the owner's participant id — keep it, it is what
        // makes this browser the owner on reconnect.
        adopt({ id: room.participantId, name: parsed.data.name })
        navigate(`/room/${room.roomId}`, { viewTransition: true })
        return
      }

      const { code: roomId, name: displayName } = parsed.data
      if (!(await findRoom(roomId)).exists) {
        setErrors({ code: "That room does not exist or has expired." })
        codeRef.current?.focus()
        setPending(false)
        return
      }
      saveName(displayName)
      navigate(`/room/${roomId}`, { viewTransition: true })
    } catch (cause) {
      setFormError(
        cause instanceof RoomApiError
          ? cause.message
          : "Could not reach the server. Check your connection."
      )
      setPending(false)
    }
  }

  const activeMode = MODES.find((entry) => entry.value === mode)!

  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-4 py-12">
      {/* Ambient background glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-primary/20 blur-[140px]"
      />

      <div className="relative flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <img
            src="/logo_poker.webp"
            alt=""
            width={500}
            height={500}
            className="-mb-3 size-36 shrink-0"
          />
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Scrum Poker
          </h1>
          <p className="text-sm text-balance text-muted-foreground">
            Real-time story point estimation. No accounts, no setup — just share
            the room code.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex flex-col gap-5 rounded-2xl border border-border/60 bg-card/60 p-5 shadow-xl backdrop-blur-sm"
        >
          {/* Pick the action first, so it is never ambiguous which one the
              form is about to perform. */}
          <div
            role="tablist"
            aria-label="Create or join a room"
            className="relative grid grid-cols-2 rounded-xl bg-muted/60 p-1"
          >
            {/* One highlight that travels, rather than two backgrounds
                cross-fading — the selection reads as a single object moving to
                where you pointed. */}
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-background shadow-sm",
                "transition-transform duration-[220ms] ease-travel",
                mode === "join" && "translate-x-full"
              )}
            />
            {MODES.map((entry) => (
              <button
                key={entry.value}
                type="button"
                role="tab"
                aria-selected={mode === entry.value}
                onClick={() => chooseMode(entry.value)}
                className={cn(
                  "relative z-10 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium outline-none",
                  "transition-colors duration-[220ms] ease-travel",
                  "focus-visible:ring-3 focus-visible:ring-ring/50",
                  mode === entry.value
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {entry.value === "create" ? (
                  <Plus className="size-4" />
                ) : (
                  <ArrowRight className="size-4" />
                )}
                {entry.label}
              </button>
            ))}
          </div>

          {/* Height is reserved for the longer of the two hints so swapping
              them cannot nudge everything below. */}
          <p
            key={mode}
            className="swap-fade min-h-8 text-center text-xs text-balance text-muted-foreground"
          >
            {activeMode.hint}
          </p>

          {/* The mode-specific fields stay mounted and collapse instead of
              unmounting, so switching modes resizes the card smoothly rather
              than making it jump. `inert` keeps a collapsed input out of tab
              order and off the a11y tree. Grouped with the name field, with
              the form's gap moved inside the collapsibles, so a collapsed
              field leaves no gap of its own behind. */}
          <div className="flex flex-col">
            <Collapsible open={mode === "create"}>
              <Label htmlFor="roomName">Room name</Label>
              <Input
                ref={roomNameRef}
                id="roomName"
                autoComplete="off"
                placeholder="Sprint 42 planning"
                maxLength={MAX_ROOM_NAME_LENGTH}
                aria-invalid={Boolean(errors.roomName)}
                aria-describedby={
                  errors.roomName ? "roomName-error" : undefined
                }
                value={roomName}
                onChange={(event) => {
                  setRoomName(event.target.value)
                  clearError("roomName")
                }}
              />
              <FieldError id="roomName-error">{errors.roomName}</FieldError>
            </Collapsible>

            <Collapsible open={mode === "join"}>
              <Label htmlFor="code">Room code</Label>
              <Input
                ref={codeRef}
                id="code"
                placeholder="ABC123"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={6}
                aria-invalid={Boolean(errors.code)}
                aria-describedby={errors.code ? "code-error" : undefined}
                value={code}
                onChange={(event) => {
                  setCode(normalizeRoomCode(event.target.value))
                  clearError("code")
                }}
                className="text-center font-heading text-lg tracking-[0.4em] uppercase"
              />
              <FieldError id="code-error">{errors.code}</FieldError>
            </Collapsible>

            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Your name</Label>
              <Input
                ref={nameRef}
                id="name"
                autoComplete="nickname"
                placeholder="Alex"
                maxLength={MAX_NAME_LENGTH}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? "name-error" : undefined}
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  clearError("name")
                }}
              />
              <FieldError id="name-error">{errors.name}</FieldError>
            </div>
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            <span
              key={mode}
              className="swap-fade inline-flex items-center gap-1.5"
            >
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : mode === "create" ? (
                <Plus />
              ) : (
                <ArrowRight />
              )}
              {mode === "create" ? "Create room" : "Join room"}
            </span>
          </Button>

          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </form>

        <p className="text-center text-xs text-muted-foreground/70">
          Rooms disappear automatically after 12 hours of inactivity.
        </p>
      </div>
    </main>
  )
}

/** A field that collapses to nothing instead of unmounting. */
function Collapsible({
  open,
  children,
}: {
  open: boolean
  children: React.ReactNode
}) {
  return (
    <div
      inert={!open}
      aria-hidden={!open}
      className={cn(
        "-mx-1 grid transition-[grid-template-rows] duration-[280ms] ease-smooth",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      )}
    >
      {/* The clip that makes the collapse possible would also cut the input's
          focus ring, hence the matching inset padding. */}
      <div className="overflow-hidden">
        <div className="flex flex-col gap-2 px-1 pt-1 pb-5">{children}</div>
      </div>
    </div>
  )
}
