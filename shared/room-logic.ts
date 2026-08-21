/**
 * The room state machine.
 *
 * Every function here is pure: it takes a state and returns a new state (or a
 * structured failure). The Durable Object is the only thing that persists and
 * broadcasts the results, which keeps every rule unit-testable without any
 * Cloudflare runtime.
 *
 *              RESET (owner)
 *        ┌────────────────────┐
 *        ▼                    │
 *   ┌────────┐  REVEAL   ┌──────────┐
 *   │ VOTING │ ────────► │ REVEALED │
 *   └────────┘  (owner)  └──────────┘
 */

import { DEFAULT_SCALE, type PokerValue } from "./poker-scales"
import type { ServerErrorCode } from "./protocol"
import {
  MAX_NAME_LENGTH,
  MAX_PARTICIPANTS,
  MAX_ROOM_NAME_LENGTH,
  ROOM_TTL_MS,
  type ParticipantState,
  type RoomState,
} from "./room-types"

export type LogicResult =
  | { ok: true; state: RoomState; changed: boolean }
  | { ok: false; code: ServerErrorCode; message: string }

function fail(code: ServerErrorCode, message: string): LogicResult {
  return { ok: false, code, message }
}

/** Shallow-clones the state deeply enough that callers never mutate the input. */
function cloneState(state: RoomState): RoomState {
  const participants: Record<string, ParticipantState> = {}
  for (const [id, participant] of Object.entries(state.participants)) {
    participants[id] = { ...participant }
  }
  return { ...state, scale: [...state.scale], participants }
}

/** Collapses whitespace and enforces a hard length ceiling. */
function sanitizeText(value: string, maxLength: number): string {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength)
}

export function sanitizeName(name: string): string {
  return sanitizeText(name, MAX_NAME_LENGTH)
}

export function sanitizeRoomName(name: string): string {
  return sanitizeText(name, MAX_ROOM_NAME_LENGTH)
}

export function createRoom(options: {
  roomId: string
  /** The room's own display name, e.g. "Sprint 42 planning". */
  name: string
  ownerId: string
  ownerName: string
  now: number
  scale?: PokerValue[]
}): RoomState {
  const ownerName = sanitizeName(options.ownerName)
  const roomName = sanitizeRoomName(options.name)
  return {
    roomId: options.roomId,
    // A room always has something to show in the header, even if the name
    // arrived empty from an older client.
    name: roomName || `Room ${options.roomId}`,
    ownerId: options.ownerId,
    phase: "voting",
    round: 1,
    scale: options.scale ? [...options.scale] : [...DEFAULT_SCALE],
    participants: {
      [options.ownerId]: {
        id: options.ownerId,
        name: ownerName || "Owner",
        connected: false,
        joinedAt: options.now,
      },
    },
    createdAt: options.now,
    lastActivityAt: options.now,
  }
}

/**
 * Registers or re-registers a participant.
 *
 * Re-joining with a known participant id (a refresh or a reconnect) updates the
 * display name and marks the participant connected again — it never creates a
 * second participant, and it never changes ownership.
 */
export function join(
  state: RoomState,
  input: { participantId: string; name: string; now: number }
): LogicResult {
  const name = sanitizeName(input.name)
  if (name.length === 0) {
    return fail("INVALID_NAME", "Enter a display name.")
  }

  const next = cloneState(state)
  const existing = next.participants[input.participantId]

  if (!existing && Object.keys(next.participants).length >= MAX_PARTICIPANTS) {
    return fail(
      "ROOM_FULL",
      `This room already has ${MAX_PARTICIPANTS} participants.`
    )
  }

  if (existing) {
    existing.name = name
    existing.connected = true
  } else {
    next.participants[input.participantId] = {
      id: input.participantId,
      name,
      connected: true,
      joinedAt: input.now,
    }
  }

  next.lastActivityAt = input.now
  return { ok: true, state: next, changed: true }
}

/** Marks a participant connected/disconnected without removing them. */
export function setConnected(
  state: RoomState,
  input: { participantId: string; connected: boolean; now: number }
): LogicResult {
  const participant = state.participants[input.participantId]
  if (!participant) {
    return fail("PARTICIPANT_NOT_FOUND", "Participant is not in this room.")
  }
  if (participant.connected === input.connected) {
    return { ok: true, state, changed: false }
  }

  const next = cloneState(state)
  next.participants[input.participantId].connected = input.connected
  next.lastActivityAt = input.now
  return { ok: true, state: next, changed: true }
}

/** Explicit LEAVE removes the participant entirely (unlike a dropped socket). */
export function leave(
  state: RoomState,
  input: { participantId: string; now: number }
): LogicResult {
  if (!state.participants[input.participantId]) {
    return { ok: true, state, changed: false }
  }

  const next = cloneState(state)
  delete next.participants[input.participantId]
  next.lastActivityAt = input.now
  return { ok: true, state: next, changed: true }
}

export function vote(
  state: RoomState,
  input: { participantId: string; value: PokerValue; now: number }
): LogicResult {
  const participant = state.participants[input.participantId]
  if (!participant) {
    return fail("PARTICIPANT_NOT_FOUND", "Join the room before voting.")
  }
  if (state.phase !== "voting") {
    return fail(
      "ROOM_REVEALED",
      "Votes are revealed. Wait for the next round to vote."
    )
  }
  if (!state.scale.includes(input.value)) {
    return fail("INVALID_VOTE", "That card is not part of this room's scale.")
  }

  const next = cloneState(state)
  next.participants[input.participantId].vote = input.value
  next.lastActivityAt = input.now
  return { ok: true, state: next, changed: true }
}

/** Any participant can reveal — see the note at the top of this file. */
export function reveal(
  state: RoomState,
  input: { participantId: string; now: number }
): LogicResult {
  if (!state.participants[input.participantId]) {
    return fail(
      "PARTICIPANT_NOT_FOUND",
      "Join the room before revealing votes."
    )
  }
  if (state.phase === "revealed") {
    return { ok: true, state, changed: false }
  }

  const next = cloneState(state)
  next.phase = "revealed"
  next.lastActivityAt = input.now
  return { ok: true, state: next, changed: true }
}

/** Any participant can start the next round — same reasoning as `reveal`. */
export function reset(
  state: RoomState,
  input: { participantId: string; now: number }
): LogicResult {
  if (!state.participants[input.participantId]) {
    return fail(
      "PARTICIPANT_NOT_FOUND",
      "Join the room before starting a new round."
    )
  }

  const next = cloneState(state)
  next.phase = "voting"
  next.round += 1
  for (const participant of Object.values(next.participants)) {
    participant.vote = undefined
  }
  next.lastActivityAt = input.now
  return { ok: true, state: next, changed: true }
}

export function isExpired(
  state: RoomState,
  now: number,
  ttlMs = ROOM_TTL_MS
): boolean {
  return now - state.lastActivityAt >= ttlMs
}

/** When the room should next be checked for expiry. */
export function expiresAt(state: RoomState, ttlMs = ROOM_TTL_MS): number {
  return state.lastActivityAt + ttlMs
}
