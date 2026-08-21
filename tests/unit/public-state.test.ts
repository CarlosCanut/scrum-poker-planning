import { describe, expect, it } from "vitest"

import {
  computeVoteStats,
  isPokerValue,
  type PokerValue,
} from "../../shared/poker-scales"
import {
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from "../../shared/room-code"
import { createRoom, join, reveal, vote } from "../../shared/room-logic"
import { createPublicRoomState, type RoomState } from "../../shared/room-types"

const OWNER = "11111111-1111-4111-8111-111111111111"
const ALICE = "22222222-2222-4222-8222-222222222222"
const BOB = "33333333-3333-4333-8333-333333333333"
const DANA = "44444444-4444-4444-8444-444444444444"
const NOW = 1_700_000_000_000

function roomWithVotes(): RoomState {
  let state = createRoom({
    roomId: "ABC123",
    name: "Sprint 42 planning",
    ownerId: OWNER,
    ownerName: "Carlos",
    now: NOW,
  })
  for (const [id, name] of [
    [ALICE, "Alice"],
    [BOB, "Bob"],
  ] as const) {
    const joined = join(state, { participantId: id, name, now: NOW })
    if (!joined.ok) throw new Error(joined.message)
    state = joined.state
  }
  for (const [id, value] of [
    [ALICE, "8"],
    [BOB, "5"],
  ] as const) {
    const voted = vote(state, { participantId: id, value, now: NOW })
    if (!voted.ok) throw new Error(voted.message)
    state = voted.state
  }
  return state
}

/** Four people in the room, only the two named here vote, then reveal. */
function roomOfFourWhereTwoVoted(first: PokerValue, second: PokerValue) {
  let state = createRoom({
    roomId: "ABC123",
    name: "Sprint 42 planning",
    ownerId: OWNER,
    ownerName: "Carlos",
    now: NOW,
  })
  for (const [id, name] of [
    [ALICE, "Alice"],
    [BOB, "Bob"],
    [DANA, "Dana"],
  ] as const) {
    const joined = join(state, { participantId: id, name, now: NOW })
    if (!joined.ok) throw new Error(joined.message)
    state = joined.state
  }
  for (const [id, value] of [
    [ALICE, first],
    [BOB, second],
  ] as const) {
    const voted = vote(state, { participantId: id, value, now: NOW })
    if (!voted.ok) throw new Error(voted.message)
    state = voted.state
  }
  const revealed = reveal(state, { participantId: ALICE, now: NOW })
  if (!revealed.ok) throw new Error(revealed.message)
  return revealed.state
}

describe("createPublicRoomState — vote secrecy", () => {
  it("never includes vote values while voting", () => {
    const state = roomWithVotes()
    const publicState = createPublicRoomState(state)

    const alice = publicState.participants.find((p) => p.id === ALICE)!
    expect(alice.hasVoted).toBe(true)
    expect(alice.vote).toBeUndefined()
    expect("vote" in alice).toBe(false)
  })

  it("leaves no trace of a vote value anywhere in the serialized payload", () => {
    // The strongest form of the check: the participant payload that goes on
    // the wire must not carry the hidden values at all. (The room's `scale`
    // legitimately lists every card, so it is excluded here.)
    const serialized = JSON.stringify(
      createPublicRoomState(roomWithVotes()).participants
    )
    expect(serialized).not.toContain('"vote"')
    expect(serialized).not.toContain('"8"')
    expect(serialized).not.toContain('"5"')
  })

  it("exposes vote values only after the reveal", () => {
    const revealed = reveal(roomWithVotes(), {
      participantId: OWNER,
      now: NOW,
    })
    if (!revealed.ok) throw new Error("reveal failed")

    const publicState = createPublicRoomState(revealed.state)
    const alice = publicState.participants.find((p) => p.id === ALICE)!
    const bob = publicState.participants.find((p) => p.id === BOB)!
    const owner = publicState.participants.find((p) => p.id === OWNER)!

    expect(alice.vote).toBe("8")
    expect(bob.vote).toBe("5")
    // The owner never voted, so there is nothing to show.
    expect(owner.hasVoted).toBe(false)
    expect(owner.vote).toBeUndefined()
  })

  it("marks the owner and reports connection state", () => {
    const publicState = createPublicRoomState(roomWithVotes())
    expect(publicState.participants.find((p) => p.isOwner)?.id).toBe(OWNER)
    expect(publicState.participants.filter((p) => p.isOwner)).toHaveLength(1)
    expect(
      publicState.participants.find((p) => p.id === ALICE)?.connected
    ).toBe(true)
  })

  it("orders participants by join time", () => {
    const publicState = createPublicRoomState(roomWithVotes())
    expect(publicState.participants.map((p) => p.name)).toEqual([
      "Carlos",
      "Alice",
      "Bob",
    ])
  })

  it("copies the scale instead of sharing the internal array", () => {
    const state = roomWithVotes()
    const publicState = createPublicRoomState(state)
    publicState.scale.push("☕")
    expect(state.scale).not.toContain("☕")
  })
})

describe("vote statistics", () => {
  it("summarizes numeric votes and ignores non-numeric ones", () => {
    const stats = computeVoteStats(
      ["1", "3", "5", "?"],
      ["1", "2", "3", "5", "8", "?"]
    )
    expect(stats.total).toBe(4)
    expect(stats.numeric).toBe(3)
    expect(stats.average).toBe(3)
    expect(stats.median).toBe(3)
    expect(stats.min).toBe(1)
    expect(stats.max).toBe(5)
    expect(stats.consensus).toBe(false)
  })

  it("averages an even number of votes", () => {
    const stats = computeVoteStats(["2", "8"], ["2", "8"])
    expect(stats.average).toBe(5)
    expect(stats.median).toBe(5)
  })

  it("detects consensus", () => {
    expect(computeVoteStats(["5", "5", "5"], ["5"]).consensus).toBe(true)
    expect(computeVoteStats(["5"], ["5"]).consensus).toBe(false)
  })

  it("counts a coincidence among the votes cast, not the whole room", () => {
    // Two of four people voted and both said 5: the two who abstained are not
    // disagreement, so the room still celebrates.
    const state = roomOfFourWhereTwoVoted("5", "5")
    const revealed = createPublicRoomState(state)
    const votes = revealed.participants
      .map((p) => p.vote)
      .filter((v): v is PokerValue => v !== undefined)

    expect(votes).toEqual(["5", "5"])
    expect(computeVoteStats(votes, revealed.scale).consensus).toBe(true)
  })

  it("is not a coincidence when the votes cast disagree", () => {
    const state = roomOfFourWhereTwoVoted("5", "8")
    const revealed = createPublicRoomState(state)
    const votes = revealed.participants
      .map((p) => p.vote)
      .filter((v): v is PokerValue => v !== undefined)

    expect(computeVoteStats(votes, revealed.scale).consensus).toBe(false)
  })

  it("treats matching non-numeric votes as a coincidence too", () => {
    expect(computeVoteStats(["?", "?"], ["?"]).consensus).toBe(true)
  })

  it("builds a distribution in scale order", () => {
    const stats = computeVoteStats(["8", "1", "8"], ["1", "2", "8"])
    expect(stats.distribution).toEqual([
      { value: "1", count: 1 },
      { value: "8", count: 2 },
    ])
  })
})

describe("room codes", () => {
  it("generates valid, uppercase codes", () => {
    for (let i = 0; i < 50; i++) {
      expect(isValidRoomCode(generateRoomCode())).toBe(true)
    }
  })

  it("normalizes user input", () => {
    expect(normalizeRoomCode(" abc-123 ")).toBe("ABC123")
    expect(isValidRoomCode(normalizeRoomCode("abc123"))).toBe(true)
    expect(isValidRoomCode("ABC12")).toBe(false)
  })
})

describe("poker values", () => {
  it("recognizes only known values", () => {
    expect(isPokerValue("13")).toBe(true)
    expect(isPokerValue("☕")).toBe(true)
    expect(isPokerValue("100")).toBe(false)
    expect(isPokerValue(5)).toBe(false)
  })
})
