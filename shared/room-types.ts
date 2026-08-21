import type { PokerValue } from "./poker-scales"

export type RoomPhase = "voting" | "revealed"

/** Limits enforced by the Durable Object. */
export const MAX_NAME_LENGTH = 40
export const MAX_ROOM_NAME_LENGTH = 60
export const MAX_PARTICIPANTS = 50
/** A room is deleted after this much inactivity. */
export const ROOM_TTL_MS = 12 * 60 * 60 * 1000

/**
 * Internal, authoritative room state. Lives only inside the Durable Object.
 * It contains hidden votes and must never be sent to clients as-is.
 */
export interface RoomState {
  roomId: string
  /** What the team is estimating, chosen when the room is created. */
  name: string
  ownerId: string
  phase: RoomPhase
  round: number
  scale: PokerValue[]
  participants: Record<string, ParticipantState>
  createdAt: number
  lastActivityAt: number
}

export interface ParticipantState {
  id: string
  name: string
  connected: boolean
  vote?: PokerValue
  joinedAt: number
}

/** What clients are allowed to see about a participant. */
export interface PublicParticipant {
  id: string
  name: string
  connected: boolean
  isOwner: boolean
  hasVoted: boolean
  /** Only present once the room is revealed. */
  vote?: PokerValue
  joinedAt: number
}

export interface PublicRoomState {
  roomId: string
  name: string
  ownerId: string
  phase: RoomPhase
  round: number
  scale: PokerValue[]
  participants: PublicParticipant[]
  createdAt: number
  lastActivityAt: number
}

/**
 * The single place where internal state becomes public state.
 *
 * Every field is copied explicitly (never spread) so a new internal field can
 * never leak to clients by accident. Votes are attached only in the
 * "revealed" phase.
 */
export function createPublicRoomState(state: RoomState): PublicRoomState {
  const revealed = state.phase === "revealed"

  const participants = Object.values(state.participants)
    .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
    .map((participant): PublicParticipant => {
      const publicParticipant: PublicParticipant = {
        id: participant.id,
        name: participant.name,
        connected: participant.connected,
        isOwner: participant.id === state.ownerId,
        hasVoted: participant.vote !== undefined,
        joinedAt: participant.joinedAt,
      }
      if (revealed && participant.vote !== undefined) {
        publicParticipant.vote = participant.vote
      }
      return publicParticipant
    })

  return {
    roomId: state.roomId,
    name: state.name,
    ownerId: state.ownerId,
    phase: state.phase,
    round: state.round,
    scale: [...state.scale],
    participants,
    createdAt: state.createdAt,
    lastActivityAt: state.lastActivityAt,
  }
}
