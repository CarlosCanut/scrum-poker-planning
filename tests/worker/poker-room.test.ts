import { SELF, env, runInDurableObject } from "cloudflare:test"
import { afterEach, describe, expect, it } from "vitest"

import type {
  ClientEvent,
  CreateRoomResponse,
  ServerEvent,
} from "../../shared/protocol"
import { ROOM_TTL_MS, type RoomState } from "../../shared/room-types"

const ORIGIN = "https://poker.test"

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** A connected test client with a queue of the events it has received. */
class TestClient {
  private queue: ServerEvent[] = []
  private waiters: Array<(event: ServerEvent) => void> = []

  private constructor(
    readonly socket: WebSocket,
    readonly participantId: string
  ) {}

  static async connect(
    roomId: string,
    participantId: string
  ): Promise<TestClient> {
    const response = await SELF.fetch(
      `${ORIGIN}/api/rooms/${roomId}/ws?participantId=${participantId}`,
      { headers: { Upgrade: "websocket" } }
    )
    expect(response.status).toBe(101)
    const socket = response.webSocket
    if (!socket) throw new Error("no websocket on the response")

    const client = new TestClient(socket, participantId)
    socket.accept()
    socket.addEventListener("message", (event) => {
      client.push(JSON.parse(String(event.data)) as ServerEvent)
    })
    return client
  }

  private push(event: ServerEvent) {
    const waiter = this.waiters.shift()
    if (waiter) waiter(event)
    else this.queue.push(event)
  }

  send(event: ClientEvent) {
    this.socket.send(JSON.stringify(event))
  }

  /** Resolves with the next event, failing the test if none arrives. */
  next(timeoutMs = 2000): Promise<ServerEvent> {
    const queued = this.queue.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for a server event")),
        timeoutMs
      )
      this.waiters.push((event) => {
        clearTimeout(timer)
        resolve(event)
      })
    })
  }

  /** Waits until an event satisfying `predicate` arrives. */
  async nextMatching(
    predicate: (event: ServerEvent) => boolean,
    timeoutMs = 2000
  ): Promise<ServerEvent> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const event = await this.next(Math.max(50, deadline - Date.now()))
      if (predicate(event)) return event
    }
  }

  async nextState(timeoutMs = 2000) {
    const event = await this.nextMatching(
      (candidate) => candidate.type === "ROOM_STATE",
      timeoutMs
    )
    if (event.type !== "ROOM_STATE") throw new Error("unreachable")
    return event
  }

  received(): ServerEvent[] {
    return [...this.queue]
  }

  async join(name: string) {
    this.send({ type: "JOIN", participantId: this.participantId, name })
    return this.nextState()
  }

  close() {
    try {
      this.socket.close(1000, "test over")
    } catch {
      // Already closed.
    }
  }
}

const openClients: TestClient[] = []

async function connect(roomId: string, participantId: string) {
  const client = await TestClient.connect(roomId, participantId)
  openClients.push(client)
  return client
}

async function createRoom(
  name = "Carlos",
  roomName = "Sprint 42 planning"
): Promise<CreateRoomResponse> {
  const response = await SELF.fetch(`${ORIGIN}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, roomName }),
  })
  expect(response.status).toBe(200)
  return response.json<CreateRoomResponse>()
}

function uuid() {
  return crypto.randomUUID()
}

/** Lets queued WebSocket deliveries settle. */
function tick(ms = 60) {
  return scheduler.wait(ms)
}

afterEach(() => {
  while (openClients.length) openClients.pop()!.close()
})

/* -------------------------------------------------------------------------- */
/* HTTP API                                                                   */
/* -------------------------------------------------------------------------- */

describe("room creation", () => {
  it("issues a short code and an owner id", async () => {
    const room = await createRoom("Carlos")
    expect(room.roomId).toMatch(/^[A-Z0-9]{6}$/)
    expect(room.participantId).toMatch(/^[0-9a-f-]{36}$/)
    expect(room.isOwner).toBe(true)
    expect(room.roomName).toBe("Sprint 42 planning")
  })

  it("stores the room name and broadcasts it in the public state", async () => {
    const room = await createRoom("Carlos", "  Checkout   rewrite  ")
    const snapshot = await env.POKER_ROOMS.getByName(room.roomId).snapshot()
    // Whitespace is collapsed on the way in, so every client sees one form.
    expect(snapshot?.name).toBe("Checkout rewrite")
  })

  it("rejects an empty name", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "  ", roomName: "Sprint 42 planning" }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "INVALID_NAME" })
  })

  it("rejects a missing or empty room name", async () => {
    for (const body of [
      { name: "Carlos" },
      { name: "Carlos", roomName: " " },
    ]) {
      const response = await SELF.fetch(`${ORIGIN}/api/rooms`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: "INVALID_NAME" })
    }
  })

  it("rejects an over-long room name", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Carlos", roomName: "x".repeat(61) }),
    })
    expect(response.status).toBe(400)
  })

  it("reports whether a room exists, with its name", async () => {
    const room = await createRoom()
    const response = await SELF.fetch(`${ORIGIN}/api/rooms/${room.roomId}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      exists: true,
      name: "Sprint 42 planning",
    })
    expect((await SELF.fetch(`${ORIGIN}/api/rooms/ZZZZZZ`)).status).toBe(404)
  })

  it("routes the same code to the same Durable Object", async () => {
    const room = await createRoom("Carlos")
    const a = await env.POKER_ROOMS.getByName(room.roomId).snapshot()
    const b = await env.POKER_ROOMS.getByName(room.roomId).snapshot()
    expect(a?.roomId).toBe(room.roomId)
    expect(b?.createdAt).toBe(a?.createdAt)
  })
})

/* -------------------------------------------------------------------------- */
/* Presence                                                                   */
/* -------------------------------------------------------------------------- */

describe("joining", () => {
  it("shows both participants to both clients", async () => {
    const room = await createRoom("Carlos")

    const owner = await connect(room.roomId, room.participantId)
    await owner.nextState() // initial snapshot on connect
    await owner.join("Carlos")

    const bobId = uuid()
    const bob = await connect(room.roomId, bobId)
    await bob.nextState()
    const bobView = await bob.join("Bob")

    expect(bobView.state.participants.map((p) => p.name).sort()).toEqual([
      "Bob",
      "Carlos",
    ])

    // The owner is told about Bob without asking for anything.
    const ownerView = await owner.nextState()
    expect(ownerView.state.participants).toHaveLength(2)
    expect(ownerView.state.participants.every((p) => p.connected)).toBe(true)
  })

  it("keeps the creator as owner and nobody else", async () => {
    const room = await createRoom("Carlos")
    const bob = await connect(room.roomId, uuid())
    await bob.nextState()
    const view = await bob.join("Bob")

    expect(view.state.ownerId).toBe(room.participantId)
    expect(view.state.participants.filter((p) => p.isOwner)).toHaveLength(1)
  })

  it("refuses to serve a room that was never created", async () => {
    const client = await connect("ZZZZZZ", uuid())
    const event = await client.next()
    expect(event).toMatchObject({ type: "ERROR", code: "ROOM_NOT_FOUND" })
  })

  it("reuses the participant when the same id reconnects", async () => {
    const room = await createRoom("Carlos")
    const aliceId = uuid()

    const first = await connect(room.roomId, aliceId)
    await first.nextState()
    await first.join("Alice")
    first.close()
    await tick()

    const second = await connect(room.roomId, aliceId)
    await second.nextState()
    const view = await second.join("Alice")

    expect(view.state.participants).toHaveLength(2)
    expect(
      view.state.participants.find((p) => p.id === aliceId)?.connected
    ).toBe(true)
  })

  it("marks a participant offline when their last socket closes", async () => {
    const room = await createRoom("Carlos")
    const owner = await connect(room.roomId, room.participantId)
    await owner.nextState()
    await owner.join("Carlos")

    const aliceId = uuid()
    const alice = await connect(room.roomId, aliceId)
    await alice.nextState()
    await alice.join("Alice")
    await owner.nextState()

    alice.close()
    const view = await owner.nextState()
    const offline = view.state.participants.find((p) => p.id === aliceId)
    expect(offline).toMatchObject({ connected: false, name: "Alice" })
  })

  it("keeps a participant online while another tab is still open", async () => {
    const room = await createRoom("Carlos")
    const aliceId = uuid()

    const tabOne = await connect(room.roomId, aliceId)
    await tabOne.nextState()
    await tabOne.join("Alice")

    const tabTwo = await connect(room.roomId, aliceId)
    await tabTwo.nextState()
    await tabTwo.join("Alice")

    tabOne.close()
    await tick(120)

    const snapshot = await env.POKER_ROOMS.getByName(room.roomId).snapshot()
    expect(
      snapshot?.participants.find((p) => p.id === aliceId)?.connected
    ).toBe(true)
  })

  it("rejects actions from a socket that never joined", async () => {
    const room = await createRoom("Carlos")
    const client = await connect(room.roomId, uuid())
    await client.nextState()

    client.send({ type: "VOTE", value: "5" })
    const event = await client.next()
    expect(event).toMatchObject({
      type: "ERROR",
      code: "PARTICIPANT_NOT_FOUND",
    })
  })
})

/* -------------------------------------------------------------------------- */
/* Voting and reveal                                                          */
/* -------------------------------------------------------------------------- */

describe("voting", () => {
  it("never sends another participant's vote before the reveal", async () => {
    const room = await createRoom("Carlos")
    const aliceId = uuid()

    const alice = await connect(room.roomId, aliceId)
    await alice.nextState()
    await alice.join("Alice")

    const bob = await connect(room.roomId, uuid())
    await bob.nextState()
    await bob.join("Bob")
    await alice.nextState()

    alice.send({ type: "VOTE", value: "8" })

    const bobView = await bob.nextState()
    const aliceAsSeenByBob = bobView.state.participants.find(
      (p) => p.id === aliceId
    )!
    expect(aliceAsSeenByBob.hasVoted).toBe(true)
    expect(aliceAsSeenByBob.vote).toBeUndefined()
    // Not anywhere else in the payload either, and not as Bob's "own" vote.
    expect(JSON.stringify(bobView.state.participants)).not.toContain('"8"')
    expect(bobView.yourVote).toBeUndefined()

    // Alice still gets her own vote back, so a refresh can restore it.
    const aliceView = await alice.nextState()
    expect(aliceView.yourVote).toBe("8")
    expect(
      aliceView.state.participants.find((p) => p.id === aliceId)?.vote
    ).toBeUndefined()
  })

  it("rejects a value that is not in the room's scale", async () => {
    const room = await createRoom("Carlos")
    const owner = await connect(room.roomId, room.participantId)
    await owner.nextState()
    await owner.join("Carlos")

    owner.send({ type: "VOTE", value: "☕" })
    const event = await owner.nextMatching((e) => e.type === "ERROR")
    expect(event).toMatchObject({ type: "ERROR", code: "INVALID_VOTE" })
  })

  it("rejects malformed payloads", async () => {
    const room = await createRoom("Carlos")
    const client = await connect(room.roomId, uuid())
    await client.nextState()

    client.socket.send("not json at all")
    expect(await client.next()).toMatchObject({
      type: "ERROR",
      code: "INVALID_MESSAGE",
    })

    client.socket.send(JSON.stringify({ type: "TAKE_OVER", isOwner: true }))
    expect(await client.next()).toMatchObject({
      type: "ERROR",
      code: "INVALID_MESSAGE",
    })
  })
})

describe("reveal and reset", () => {
  it("lets a participant who is not the owner reveal", async () => {
    const room = await createRoom("Carlos")
    const bob = await connect(room.roomId, uuid())
    await bob.nextState()
    await bob.join("Bob")

    bob.send({ type: "VOTE", value: "5" })
    bob.send({ type: "REVEAL" })
    await bob.nextMatching(
      (e) => e.type === "ROOM_STATE" && e.state.phase === "revealed"
    )

    const snapshot = await env.POKER_ROOMS.getByName(room.roomId).snapshot()
    expect(snapshot?.phase).toBe("revealed")
  })

  it("refuses to reveal for a socket that never joined", async () => {
    const room = await createRoom("Carlos")
    const stranger = await connect(room.roomId, uuid())
    await stranger.nextState()

    stranger.send({ type: "REVEAL" })
    const event = await stranger.nextMatching((e) => e.type === "ERROR")
    expect(event).toMatchObject({
      type: "ERROR",
      code: "PARTICIPANT_NOT_FOUND",
    })

    const snapshot = await env.POKER_ROOMS.getByName(room.roomId).snapshot()
    expect(snapshot?.phase).toBe("voting")
  })

  it("shows every vote to every client at once when the owner reveals", async () => {
    const room = await createRoom("Carlos")
    const owner = await connect(room.roomId, room.participantId)
    await owner.nextState()
    await owner.join("Carlos")

    const aliceId = uuid()
    const alice = await connect(room.roomId, aliceId)
    await alice.nextState()
    await alice.join("Alice")

    owner.send({ type: "VOTE", value: "3" })
    alice.send({ type: "VOTE", value: "8" })
    await tick()

    owner.send({ type: "REVEAL" })

    const ownerView = await owner.nextMatching(
      (e) => e.type === "ROOM_STATE" && e.state.phase === "revealed"
    )
    const aliceView = await alice.nextMatching(
      (e) => e.type === "ROOM_STATE" && e.state.phase === "revealed"
    )
    if (ownerView.type !== "ROOM_STATE" || aliceView.type !== "ROOM_STATE") {
      throw new Error("unreachable")
    }

    for (const view of [ownerView, aliceView]) {
      const votes = Object.fromEntries(
        view.state.participants.map((p) => [p.name, p.vote])
      )
      expect(votes).toEqual({ Carlos: "3", Alice: "8" })
    }
  })

  it("refuses votes after the reveal", async () => {
    const room = await createRoom("Carlos")
    const owner = await connect(room.roomId, room.participantId)
    await owner.nextState()
    await owner.join("Carlos")
    owner.send({ type: "REVEAL" })
    await owner.nextMatching(
      (e) => e.type === "ROOM_STATE" && e.state.phase === "revealed"
    )

    owner.send({ type: "VOTE", value: "5" })
    const event = await owner.nextMatching((e) => e.type === "ERROR")
    expect(event).toMatchObject({ type: "ERROR", code: "ROOM_REVEALED" })
  })

  it("clears votes and increments the round on reset", async () => {
    const room = await createRoom("Carlos")
    const owner = await connect(room.roomId, room.participantId)
    await owner.nextState()
    await owner.join("Carlos")

    const alice = await connect(room.roomId, uuid())
    await alice.nextState()
    await alice.join("Alice")

    owner.send({ type: "VOTE", value: "3" })
    alice.send({ type: "VOTE", value: "8" })
    owner.send({ type: "REVEAL" })
    await tick()

    owner.send({ type: "RESET" })

    const aliceView = await alice.nextMatching(
      (e) => e.type === "ROOM_STATE" && e.state.round === 2
    )
    if (aliceView.type !== "ROOM_STATE") throw new Error("unreachable")

    expect(aliceView.state.phase).toBe("voting")
    expect(aliceView.state.participants.every((p) => !p.hasVoted)).toBe(true)
    expect(aliceView.yourVote).toBeUndefined()
  })

  it("lets a participant who is not the owner start a new round", async () => {
    const room = await createRoom("Carlos")
    const owner = await connect(room.roomId, room.participantId)
    await owner.nextState()
    await owner.join("Carlos")

    const bob = await connect(room.roomId, uuid())
    await bob.nextState()
    await bob.join("Bob")

    bob.send({ type: "REVEAL" })
    await tick()
    bob.send({ type: "RESET" })

    const ownerView = await owner.nextMatching(
      (e) => e.type === "ROOM_STATE" && e.state.round === 2
    )
    if (ownerView.type !== "ROOM_STATE") throw new Error("unreachable")
    expect(ownerView.state.phase).toBe("voting")
  })

  it("refuses to reset for a socket that never joined", async () => {
    const room = await createRoom("Carlos")
    const stranger = await connect(room.roomId, uuid())
    await stranger.nextState()

    stranger.send({ type: "RESET" })
    const event = await stranger.nextMatching((e) => e.type === "ERROR")
    expect(event).toMatchObject({
      type: "ERROR",
      code: "PARTICIPANT_NOT_FOUND",
    })
  })
})

/* -------------------------------------------------------------------------- */
/* Persistence and lifecycle                                                  */
/* -------------------------------------------------------------------------- */

describe("persistence", () => {
  it("writes room state to Durable Object storage, not just memory", async () => {
    const room = await createRoom("Carlos")
    const owner = await connect(room.roomId, room.participantId)
    await owner.nextState()
    await owner.join("Carlos")
    owner.send({ type: "VOTE", value: "13" })
    await tick()

    const stored = await runInDurableObject(
      env.POKER_ROOMS.getByName(room.roomId),
      (_instance, state) => state.storage.get<RoomState>("room")
    )

    expect(stored).toMatchObject({
      roomId: room.roomId,
      ownerId: room.participantId,
      phase: "voting",
      round: 1,
    })
    expect(stored?.participants[room.participantId].vote).toBe("13")
  })

  it("rebuilds the room from storage after the object is dropped", async () => {
    const room = await createRoom("Carlos")
    const owner = await connect(room.roomId, room.participantId)
    await owner.nextState()
    await owner.join("Carlos")
    owner.send({ type: "VOTE", value: "21" })
    owner.send({ type: "REVEAL" })
    await tick()
    owner.close()
    await tick()

    // Force a fresh instance: abort the object so the next call constructs it
    // again and reloads state from storage.
    await runInDurableObject(
      env.POKER_ROOMS.getByName(room.roomId),
      (_instance, state) => {
        state.abort("dropped for test")
      }
    ).catch(() => {
      // `abort()` rejects the in-flight call by design.
    })

    const snapshot = await env.POKER_ROOMS.getByName(room.roomId).snapshot()
    expect(snapshot).toMatchObject({ phase: "revealed", round: 1 })
    expect(
      snapshot?.participants.find((p) => p.id === room.participantId)?.vote
    ).toBe("21")
  })

  it("schedules an expiry alarm", async () => {
    const room = await createRoom("Carlos")
    const owner = await connect(room.roomId, room.participantId)
    await owner.nextState()
    await owner.join("Carlos")
    await tick()

    const alarm = await runInDurableObject(
      env.POKER_ROOMS.getByName(room.roomId),
      (_instance, state) => state.storage.getAlarm()
    )
    expect(alarm).not.toBeNull()
    expect(alarm! - Date.now()).toBeGreaterThan(ROOM_TTL_MS - 60_000)
  })

  it("deletes a room that has been inactive past its TTL", async () => {
    const room = await createRoom("Carlos")
    const stub = env.POKER_ROOMS.getByName(room.roomId)
    expect(await stub.exists()).toBe(true)

    // Backdate the last activity, in storage and in the live instance.
    await runInDurableObject(stub, async (instance, state) => {
      const stored = await state.storage.get<RoomState>("room")
      stored!.lastActivityAt = Date.now() - ROOM_TTL_MS - 1000
      await state.storage.put("room", stored)
      ;(instance as unknown as { room: RoomState }).room = stored!
    })

    expect(await stub.exists()).toBe(false)
    const leftovers = await runInDurableObject(stub, (_instance, state) =>
      state.storage.list()
    )
    expect(leftovers.size).toBe(0)
  })
})
