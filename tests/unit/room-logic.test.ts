import { describe, expect, it } from "vitest"

import { DEFAULT_SCALE } from "../../shared/poker-scales"
import {
  createRoom,
  isExpired,
  join,
  leave,
  reset,
  reveal,
  setConnected,
  vote,
} from "../../shared/room-logic"
import {
  MAX_PARTICIPANTS,
  ROOM_TTL_MS,
  type RoomState,
} from "../../shared/room-types"

const OWNER = "11111111-1111-4111-8111-111111111111"
const ALICE = "22222222-2222-4222-8222-222222222222"
const BOB = "33333333-3333-4333-8333-333333333333"
const NOW = 1_700_000_000_000

function room(): RoomState {
  return createRoom({
    roomId: "ABC123",
    name: "Sprint 42 planning",
    ownerId: OWNER,
    ownerName: "Carlos",
    now: NOW,
  })
}

/** Sets up a room where the owner, Alice and Bob have all joined. */
function populated(): RoomState {
  let state = room()
  for (const [id, name] of [
    [OWNER, "Carlos"],
    [ALICE, "Alice"],
    [BOB, "Bob"],
  ] as const) {
    const result = join(state, { participantId: id, name, now: NOW })
    if (!result.ok) throw new Error(result.message)
    state = result.state
  }
  return state
}

function expectOk(result: ReturnType<typeof vote>) {
  if (!result.ok) throw new Error(`expected success, got ${result.code}`)
  return result
}

describe("createRoom", () => {
  it("starts in the voting phase on round 1 with the default scale", () => {
    const state = room()
    expect(state.phase).toBe("voting")
    expect(state.round).toBe(1)
    expect(state.scale).toEqual(DEFAULT_SCALE)
    expect(state.ownerId).toBe(OWNER)
    expect(state.name).toBe("Sprint 42 planning")
  })

  it("registers the creator as a participant", () => {
    expect(room().participants[OWNER]).toMatchObject({
      id: OWNER,
      name: "Carlos",
      connected: false,
    })
  })
})

describe("join", () => {
  it("adds a new participant", () => {
    const state = expectOk(
      join(room(), { participantId: ALICE, name: "Alice", now: NOW })
    ).state
    expect(state.participants[ALICE]).toMatchObject({
      name: "Alice",
      connected: true,
    })
  })

  it("reuses the participant when the same id rejoins (refresh/reconnect)", () => {
    const first = expectOk(
      join(populated(), { participantId: ALICE, name: "Alice", now: NOW })
    ).state
    const withVote = expectOk(
      vote(first, { participantId: ALICE, value: "5", now: NOW })
    ).state
    const rejoined = expectOk(
      join(withVote, { participantId: ALICE, name: "Alice B.", now: NOW + 10 })
    ).state

    expect(Object.keys(rejoined.participants)).toHaveLength(3)
    expect(rejoined.participants[ALICE].name).toBe("Alice B.")
    expect(rejoined.participants[ALICE].vote).toBe("5")
    expect(rejoined.participants[ALICE].joinedAt).toBe(NOW)
  })

  it("never changes ownership", () => {
    const state = expectOk(
      join(populated(), { participantId: ALICE, name: "Alice", now: NOW })
    ).state
    expect(state.ownerId).toBe(OWNER)
  })

  it("rejects blank names", () => {
    const result = join(room(), { participantId: ALICE, name: "   ", now: NOW })
    expect(result).toMatchObject({ ok: false, code: "INVALID_NAME" })
  })

  it("truncates and normalizes long names", () => {
    const state = expectOk(
      join(room(), {
        participantId: ALICE,
        name: `  Alice${" ".repeat(4)}the${"o".repeat(60)}  `,
        now: NOW,
      })
    ).state
    expect(state.participants[ALICE].name).toHaveLength(40)
    expect(state.participants[ALICE].name.startsWith("Alice the")).toBe(true)
  })

  it("rejects joins once the room is full", () => {
    let state = room()
    for (let i = 0; i < MAX_PARTICIPANTS - 1; i++) {
      state = expectOk(
        join(state, { participantId: `p-${i}`, name: `P${i}`, now: NOW })
      ).state
    }
    expect(Object.keys(state.participants)).toHaveLength(MAX_PARTICIPANTS)

    const result = join(state, {
      participantId: "one-too-many",
      name: "Nope",
      now: NOW,
    })
    expect(result).toMatchObject({ ok: false, code: "ROOM_FULL" })
  })

  it("still lets an existing participant rejoin a full room", () => {
    let state = room()
    for (let i = 0; i < MAX_PARTICIPANTS - 1; i++) {
      state = expectOk(
        join(state, { participantId: `p-${i}`, name: `P${i}`, now: NOW })
      ).state
    }
    expect(join(state, { participantId: "p-0", name: "P0", now: NOW }).ok).toBe(
      true
    )
  })
})

describe("vote", () => {
  it("records a vote during the voting phase", () => {
    const state = expectOk(
      vote(populated(), { participantId: ALICE, value: "8", now: NOW })
    ).state
    expect(state.participants[ALICE].vote).toBe("8")
  })

  it("lets a participant change their mind", () => {
    let state = expectOk(
      vote(populated(), { participantId: ALICE, value: "8", now: NOW })
    ).state
    state = expectOk(
      vote(state, { participantId: ALICE, value: "3", now: NOW })
    ).state
    expect(state.participants[ALICE].vote).toBe("3")
  })

  it("rejects values outside the room scale", () => {
    // "☕" is a valid poker value but not part of the default scale.
    const result = vote(populated(), {
      participantId: ALICE,
      value: "☕",
      now: NOW,
    })
    expect(result).toMatchObject({ ok: false, code: "INVALID_VOTE" })
  })

  it("rejects votes from unknown participants", () => {
    const result = vote(populated(), {
      participantId: "ghost",
      value: "5",
      now: NOW,
    })
    expect(result).toMatchObject({ ok: false, code: "PARTICIPANT_NOT_FOUND" })
  })

  it("rejects votes once the round is revealed", () => {
    const revealed = expectOk(
      reveal(populated(), { participantId: OWNER, now: NOW })
    ).state
    const result = vote(revealed, {
      participantId: ALICE,
      value: "5",
      now: NOW,
    })
    expect(result).toMatchObject({ ok: false, code: "ROOM_REVEALED" })
  })

  it("does not mutate the state it was given", () => {
    const before = populated()
    vote(before, { participantId: ALICE, value: "8", now: NOW })
    expect(before.participants[ALICE].vote).toBeUndefined()
  })
})

describe("reveal", () => {
  it("moves the room to the revealed phase", () => {
    const state = expectOk(
      reveal(populated(), { participantId: OWNER, now: NOW })
    ).state
    expect(state.phase).toBe("revealed")
  })

  it("is allowed for any participant, not just the owner", () => {
    const state = expectOk(
      reveal(populated(), { participantId: ALICE, now: NOW })
    ).state
    expect(state.phase).toBe("revealed")
  })

  it("is rejected for somebody who never joined", () => {
    const result = reveal(populated(), { participantId: "ghost", now: NOW })
    expect(result).toMatchObject({ ok: false, code: "PARTICIPANT_NOT_FOUND" })
  })

  it("is idempotent", () => {
    const once = expectOk(
      reveal(populated(), { participantId: OWNER, now: NOW })
    )
    const twice = reveal(once.state, { participantId: OWNER, now: NOW })
    expect(twice).toMatchObject({ ok: true, changed: false })
  })
})

describe("reset", () => {
  it("is allowed for any participant, not just the owner", () => {
    const state = expectOk(
      reset(populated(), { participantId: BOB, now: NOW })
    ).state
    expect(state.round).toBe(2)
  })

  it("is rejected for somebody who never joined", () => {
    const result = reset(populated(), { participantId: "ghost", now: NOW })
    expect(result).toMatchObject({ ok: false, code: "PARTICIPANT_NOT_FOUND" })
  })

  it("clears every vote and increments the round", () => {
    let state = populated()
    state = expectOk(
      vote(state, { participantId: ALICE, value: "5", now: NOW })
    ).state
    state = expectOk(
      vote(state, { participantId: BOB, value: "8", now: NOW })
    ).state
    state = expectOk(reveal(state, { participantId: OWNER, now: NOW })).state

    const next = expectOk(
      reset(state, { participantId: OWNER, now: NOW })
    ).state
    expect(next.phase).toBe("voting")
    expect(next.round).toBe(2)
    expect(
      Object.values(next.participants).every((p) => p.vote === undefined)
    ).toBe(true)
  })

  it("keeps participants in the room", () => {
    const next = expectOk(
      reset(populated(), { participantId: OWNER, now: NOW })
    ).state
    expect(Object.keys(next.participants)).toHaveLength(3)
  })
})

describe("presence", () => {
  it("marks a participant offline without removing them", () => {
    const state = expectOk(
      setConnected(populated(), {
        participantId: ALICE,
        connected: false,
        now: NOW,
      })
    ).state
    expect(state.participants[ALICE]).toMatchObject({ connected: false })
  })

  it("reports no change when the flag already matches", () => {
    const result = setConnected(populated(), {
      participantId: ALICE,
      connected: true,
      now: NOW,
    })
    expect(result).toMatchObject({ ok: true, changed: false })
  })

  it("removes the participant on an explicit leave", () => {
    const state = expectOk(
      leave(populated(), { participantId: ALICE, now: NOW })
    ).state
    expect(state.participants[ALICE]).toBeUndefined()
  })

  it("keeps ownership recorded even if the owner leaves", () => {
    const state = expectOk(
      leave(populated(), { participantId: OWNER, now: NOW })
    ).state
    expect(state.ownerId).toBe(OWNER)
  })
})

describe("expiry", () => {
  it("is not expired while activity is recent", () => {
    expect(isExpired(populated(), NOW + ROOM_TTL_MS - 1)).toBe(false)
  })

  it("expires once the TTL has elapsed since the last activity", () => {
    expect(isExpired(populated(), NOW + ROOM_TTL_MS)).toBe(true)
  })

  it("pushes the expiry forward on every mutation", () => {
    const later = NOW + 60_000
    const state = expectOk(
      vote(populated(), { participantId: ALICE, value: "5", now: later })
    ).state
    expect(state.lastActivityAt).toBe(later)
    expect(isExpired(state, NOW + ROOM_TTL_MS)).toBe(false)
  })
})
