import { DurableObject } from "cloudflare:workers"

import type { PokerValue } from "../../shared/poker-scales"
import {
  CLOSE_ROOM_EXPIRED,
  CLOSE_ROOM_NOT_FOUND,
  PING_MESSAGE,
  PONG_MESSAGE,
  parseClientEvent,
  type ServerErrorCode,
  type ServerEvent,
} from "../../shared/protocol"
import {
  createRoom,
  expiresAt,
  isExpired,
  join,
  leave,
  reset,
  reveal,
  setConnected,
  vote,
  type LogicResult,
} from "../../shared/room-logic"
import {
  createPublicRoomState,
  type RoomState,
  type PublicRoomState,
} from "../../shared/room-types"

const STORAGE_KEY = "room"

/**
 * Rescheduling the expiry alarm costs a storage write, so it is only pushed
 * forward when it drifts more than this far from the ideal time.
 */
const ALARM_SLACK_MS = 5 * 60 * 1000

/** Attached to every socket so a hibernated room can still identify it. */
interface SocketAttachment {
  participantId: string
}

/**
 * One Durable Object instance per room.
 *
 * It is simultaneously the room's state owner, state machine, WebSocket hub,
 * pub/sub topic, persistence layer and authorization boundary. Clients never
 * talk to each other — they only observe the state this object broadcasts.
 */
export class PokerRoom extends DurableObject<Env> {
  private room: RoomState | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Reload authoritative state before serving anything, including after the
    // object has been evicted or hibernated.
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<RoomState>(STORAGE_KEY)) ?? null
    })

    // Heartbeats are answered by the runtime, so keepalive traffic alone never
    // wakes a hibernating room.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(PING_MESSAGE, PONG_MESSAGE)
    )
  }

  /* ---------------------------------------------------------------------- */
  /* RPC surface (called by the Worker)                                      */
  /* ---------------------------------------------------------------------- */

  /** Initializes the room. Returns false if the code is already in use. */
  async initialize(input: {
    roomId: string
    name: string
    ownerId: string
    ownerName: string
    scale?: PokerValue[]
  }): Promise<boolean> {
    await this.expireIfStale()
    if (this.room) return false

    this.room = createRoom({ ...input, now: Date.now() })
    await this.persist()
    console.log({
      event: "room_created",
      roomId: input.roomId,
      ownerId: input.ownerId,
    })
    return true
  }

  async exists(): Promise<boolean> {
    await this.expireIfStale()
    return this.room !== null
  }

  /** Public snapshot, used by tests and by HTTP callers. Never leaks votes. */
  async snapshot(): Promise<PublicRoomState | null> {
    await this.expireIfStale()
    return this.room ? createPublicRoomState(this.room) : null
  }

  /* ---------------------------------------------------------------------- */
  /* WebSocket lifecycle                                                     */
  /* ---------------------------------------------------------------------- */

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade.", { status: 426 })
    }

    await this.expireIfStale()

    const { 0: client, 1: server } = new WebSocketPair()

    // The id in the query string is only a routing hint for tagging; nothing is
    // authorized from it. Registration still requires a JOIN message.
    const hint = new URL(request.url).searchParams.get("participantId")
    const tags = ["players"]
    if (hint && /^[0-9a-f-]{36}$/i.test(hint)) tags.push(`participant:${hint}`)

    // Hibernation-aware accept: Cloudflare may evict this object from memory
    // while the socket stays open.
    this.ctx.acceptWebSocket(server, tags)

    if (!this.room) {
      this.send(server, {
        type: "ERROR",
        code: "ROOM_NOT_FOUND",
        message: "This room does not exist or has expired.",
      })
      server.close(CLOSE_ROOM_NOT_FOUND, "ROOM_NOT_FOUND")
    } else {
      // Give the client something to render immediately; JOIN follows.
      // No `yourVote` here: the socket has not proven an identity yet.
      this.send(server, {
        type: "ROOM_STATE",
        state: createPublicRoomState(this.room),
      })
    }

    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    const parsed = parseClientEvent(
      typeof message === "string" ? message : null
    )
    if (!parsed.ok) {
      this.send(ws, {
        type: "ERROR",
        code: "INVALID_MESSAGE",
        message: parsed.message,
      })
      return
    }

    const event = parsed.event
    if (event.type === "PING") {
      ws.send(PONG_MESSAGE)
      return
    }

    await this.expireIfStale()
    if (!this.room) {
      this.send(ws, {
        type: "ERROR",
        code: "ROOM_NOT_FOUND",
        message: "This room does not exist or has expired.",
      })
      this.closeQuietly(ws, CLOSE_ROOM_NOT_FOUND, "ROOM_NOT_FOUND")
      return
    }

    const now = Date.now()

    if (event.type === "JOIN") {
      const result = join(this.room, {
        participantId: event.participantId,
        name: event.name,
        now,
      })
      if (!result.ok) return this.sendFailure(ws, result)

      // Identity is bound to the socket by the server, not by later messages.
      ws.serializeAttachment({
        participantId: event.participantId,
      } satisfies SocketAttachment)

      console.log({
        event: "participant_joined",
        roomId: this.room.roomId,
        participantId: event.participantId,
      })
      return this.commit(result)
    }

    const participantId = this.participantIdOf(ws)
    if (!participantId) {
      this.send(ws, {
        type: "ERROR",
        code: "PARTICIPANT_NOT_FOUND",
        message: "Join the room before sending other actions.",
      })
      return
    }

    let result: LogicResult
    switch (event.type) {
      case "VOTE":
        result = vote(this.room, { participantId, value: event.value, now })
        break
      case "REVEAL":
        result = reveal(this.room, { participantId, now })
        if (result.ok && result.changed) {
          console.log({
            event: "round_revealed",
            roomId: this.room.roomId,
            round: this.room.round,
          })
        }
        break
      case "RESET":
        result = reset(this.room, { participantId, now })
        if (result.ok && result.changed) {
          console.log({
            event: "round_reset",
            roomId: this.room.roomId,
            round: result.state.round,
          })
        }
        break
      case "LEAVE":
        result = leave(this.room, { participantId, now })
        await this.commit(result)
        this.closeQuietly(ws, 1000, "left")
        return
    }

    if (!result.ok) return this.sendFailure(ws, result)
    await this.commit(result)
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.closeQuietly(ws, 1000, "closing")

    const participantId = this.participantIdOf(ws)
    if (!participantId || !this.room) return

    // A participant may have several tabs open; they only go offline once the
    // last of their sockets is gone. Identity comes from the server-set
    // attachment, never from the (client-supplied) socket tag.
    const stillOpen = this.ctx
      .getWebSockets()
      .some(
        (other) => other !== ws && this.participantIdOf(other) === participantId
      )
    if (stillOpen) return

    console.log({
      event: "participant_disconnected",
      roomId: this.room.roomId,
      participantId,
    })
    await this.commit(
      setConnected(this.room, {
        participantId,
        connected: false,
        now: Date.now(),
      })
    )
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws)
  }

  /* ---------------------------------------------------------------------- */
  /* Expiration                                                              */
  /* ---------------------------------------------------------------------- */

  override async alarm(): Promise<void> {
    if (!this.room) {
      await this.ctx.storage.deleteAll()
      return
    }

    if (!isExpired(this.room, Date.now())) {
      await this.ctx.storage.setAlarm(expiresAt(this.room))
      return
    }

    await this.destroy()
  }

  /** Lazy expiry, so a room that is touched after its TTL is already gone. */
  private async expireIfStale(): Promise<void> {
    if (this.room && isExpired(this.room, Date.now())) {
      await this.destroy()
    }
  }

  private async destroy(): Promise<void> {
    const roomId = this.room?.roomId
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, {
        type: "ERROR",
        code: "ROOM_NOT_FOUND",
        message: "This room expired after a long period of inactivity.",
      })
      this.closeQuietly(ws, CLOSE_ROOM_EXPIRED, "ROOM_EXPIRED")
    }
    this.room = null
    await this.ctx.storage.deleteAll()
    console.log({ event: "room_expired", roomId })
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                               */
  /* ---------------------------------------------------------------------- */

  private participantIdOf(ws: WebSocket): string | undefined {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null
    return attachment?.participantId
  }

  /** Applies a successful transition: persist, reschedule expiry, broadcast. */
  private async commit(result: LogicResult): Promise<void> {
    if (!result.ok || !result.changed) return
    this.room = result.state
    await this.persist()
    await this.scheduleExpiry()
    this.broadcast()
  }

  private async persist(): Promise<void> {
    if (this.room) await this.ctx.storage.put(STORAGE_KEY, this.room)
  }

  private async scheduleExpiry(): Promise<void> {
    if (!this.room) return
    const target = expiresAt(this.room)
    const current = await this.ctx.storage.getAlarm()
    if (current === null || current < target - ALARM_SLACK_MS) {
      await this.ctx.storage.setAlarm(target)
    }
  }

  /**
   * The Durable Object *is* the pub/sub topic: every open socket is a
   * subscriber, and the whole (public) state is the message.
   */
  private broadcast(): void {
    const room = this.room
    if (!room) return
    const state = createPublicRoomState(room)

    for (const ws of this.ctx.getWebSockets()) {
      // Everyone gets the same public state; the only per-socket addition is
      // the recipient's own vote, so a refreshed tab can restore its selection.
      const participantId = this.participantIdOf(ws)
      const yourVote = participantId
        ? room.participants[participantId]?.vote
        : undefined
      this.send(ws, { type: "ROOM_STATE", state, yourVote })
    }
  }

  private send(ws: WebSocket, event: ServerEvent): void {
    try {
      ws.send(JSON.stringify(event))
    } catch {
      // Ignore sends to sockets that are already gone.
    }
  }

  private sendFailure(
    ws: WebSocket,
    result: Extract<LogicResult, { ok: false }>
  ): void {
    this.send(ws, {
      type: "ERROR",
      code: result.code satisfies ServerErrorCode,
      message: result.message,
    })
  }

  private closeQuietly(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason)
    } catch {
      // Already closed.
    }
  }
}
