import { z } from "zod"

import { POKER_VALUES, type PokerValue } from "./poker-scales"
import type { PublicRoomState } from "./room-types"
import {
  displayNameSchema,
  participantIdSchema,
  roomNameSchema,
} from "./validation"

/* -------------------------------------------------------------------------- */
/* Client -> Server                                                           */
/* -------------------------------------------------------------------------- */

export const pokerValueSchema = z.enum(POKER_VALUES)

export const clientEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("JOIN"),
    participantId: participantIdSchema,
    name: displayNameSchema,
  }),
  z.object({ type: z.literal("VOTE"), value: pokerValueSchema }),
  z.object({ type: z.literal("REVEAL") }),
  z.object({ type: z.literal("RESET") }),
  z.object({ type: z.literal("LEAVE") }),
  z.object({ type: z.literal("PING") }),
])

export type ClientEvent = z.infer<typeof clientEventSchema>

/**
 * Parses an untrusted WebSocket payload. Everything that reaches the Durable
 * Object goes through here first — raw payloads are never trusted.
 */
export function parseClientEvent(
  raw: unknown
): { ok: true; event: ClientEvent } | { ok: false; message: string } {
  if (typeof raw !== "string") {
    return { ok: false, message: "Messages must be JSON text frames." }
  }
  if (raw.length > 4096) {
    return { ok: false, message: "Message payload is too large." }
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false, message: "Message is not valid JSON." }
  }

  const result = clientEventSchema.safeParse(json)
  if (!result.success) {
    return {
      ok: false,
      message: result.error.issues[0]?.message ?? "Unsupported message.",
    }
  }
  return { ok: true, event: result.data }
}

/* -------------------------------------------------------------------------- */
/* Server -> Client                                                           */
/* -------------------------------------------------------------------------- */

export type ServerErrorCode =
  | "INVALID_MESSAGE"
  | "INVALID_NAME"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "INVALID_VOTE"
  | "ROOM_REVEALED"
  | "PARTICIPANT_NOT_FOUND"

export type ServerEvent =
  | {
      type: "ROOM_STATE"
      state: PublicRoomState
      /**
       * The recipient's *own* vote, echoed back so a reconnecting tab can
       * re-highlight its card. It is filled in per socket and never contains
       * anybody else's vote.
       */
      yourVote?: PokerValue
    }
  | { type: "ERROR"; code: ServerErrorCode; message: string }
  | { type: "PONG" }

/**
 * Exact heartbeat frames. The Durable Object registers these with
 * `setWebSocketAutoResponse`, so the runtime answers pings without waking a
 * hibernating room — which means the strings must match byte for byte.
 */
export const PING_MESSAGE = JSON.stringify({ type: "PING" })
export const PONG_MESSAGE = JSON.stringify({ type: "PONG" })

/** WebSocket close codes used by the room. */
export const CLOSE_ROOM_NOT_FOUND = 4404
export const CLOSE_ROOM_EXPIRED = 4410
export const CLOSE_GOING_AWAY = 1000

export function parseServerEvent(raw: string): ServerEvent | null {
  try {
    const value = JSON.parse(raw) as ServerEvent
    if (
      value &&
      (value.type === "ROOM_STATE" ||
        value.type === "ERROR" ||
        value.type === "PONG")
    ) {
      return value
    }
    return null
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------- */
/* HTTP API                                                                   */
/* -------------------------------------------------------------------------- */

export const createRoomRequestSchema = z.object({
  /** The room's display name. */
  roomName: roomNameSchema,
  /** The creator's display name. */
  name: displayNameSchema,
})

export interface CreateRoomResponse {
  roomId: string
  roomName: string
  participantId: string
  isOwner: true
}

export interface RoomInfoResponse {
  roomId: string
  exists: boolean
  /** Only present when the room exists. */
  name?: string
}

export interface ApiErrorResponse {
  code: ServerErrorCode
  message: string
}
