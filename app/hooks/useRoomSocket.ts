import { useCallback, useEffect, useRef, useState } from "react"

import type { PokerValue } from "../../shared/poker-scales"
import {
  CLOSE_GOING_AWAY,
  CLOSE_ROOM_EXPIRED,
  CLOSE_ROOM_NOT_FOUND,
  PING_MESSAGE,
  parseServerEvent,
  type ClientEvent,
  type ServerErrorCode,
} from "../../shared/protocol"
import type { PublicRoomState } from "../../shared/room-types"
import { roomSocketUrl } from "../lib/room-client"
import type { ParticipantIdentity } from "./useParticipantIdentity"

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"

export interface RoomError {
  code: ServerErrorCode
  message: string
}

/** Capped exponential backoff, in milliseconds. */
const BACKOFF_MS = [500, 1000, 2000, 4000, 5000]
const HEARTBEAT_MS = 25_000

/**
 * Owns the single WebSocket for this tab.
 *
 * The Durable Object is authoritative: this hook never derives room truth, it
 * just replaces its snapshot whenever ROOM_STATE arrives.
 */
export function useRoomSocket(
  roomId: string,
  identity: ParticipantIdentity | null
) {
  const [room, setRoom] = useState<PublicRoomState | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>("connecting")
  const [error, setError] = useState<RoomError | null>(null)
  const [myVote, setMyVote] = useState<PokerValue | undefined>(undefined)

  const socketRef = useRef<WebSocket | null>(null)
  const nameRef = useRef(identity?.name ?? "")
  nameRef.current = identity?.name ?? nameRef.current

  useEffect(() => {
    if (!identity) return

    const participantId = identity.id
    let disposed = false
    let retry = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined

    const connect = () => {
      if (disposed) return

      const socket = new WebSocket(roomSocketUrl(roomId, participantId))
      socketRef.current = socket

      socket.onopen = () => {
        retry = 0
        setStatus("connected")
        // Re-joining with the same id restores the existing participant
        // instead of creating a new one.
        socket.send(
          JSON.stringify({
            type: "JOIN",
            participantId,
            name: nameRef.current,
          } satisfies ClientEvent)
        )
        heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(PING_MESSAGE)
        }, HEARTBEAT_MS)
      }

      socket.onmessage = (message) => {
        const event = parseServerEvent(String(message.data))
        if (!event) return
        if (event.type === "ROOM_STATE") {
          setRoom(event.state)
          setMyVote(event.yourVote)
          setError(null)
        } else if (event.type === "ERROR") {
          setError({ code: event.code, message: event.message })
        }
      }

      socket.onclose = (closeEvent) => {
        clearInterval(heartbeat)
        if (disposed) return

        // The room is gone: reconnecting would only fail again.
        if (
          closeEvent.code === CLOSE_ROOM_NOT_FOUND ||
          closeEvent.code === CLOSE_ROOM_EXPIRED
        ) {
          setStatus("disconnected")
          return
        }

        setStatus("reconnecting")
        const delay = BACKOFF_MS[Math.min(retry, BACKOFF_MS.length - 1)]
        retry += 1
        reconnectTimer = setTimeout(connect, delay)
      }
    }

    // A tab that wakes from sleep should not wait out the backoff.
    const onVisible = () => {
      if (document.visibilityState !== "visible" || disposed) return
      const socket = socketRef.current
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        clearTimeout(reconnectTimer)
        retry = 0
        connect()
      }
    }
    document.addEventListener("visibilitychange", onVisible)

    setStatus("connecting")
    connect()

    return () => {
      disposed = true
      document.removeEventListener("visibilitychange", onVisible)
      clearTimeout(reconnectTimer)
      clearInterval(heartbeat)
      socketRef.current?.close(CLOSE_GOING_AWAY, "navigated away")
      socketRef.current = null
    }
  }, [roomId, identity?.id])

  const send = useCallback((event: ClientEvent) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(event))
    }
  }, [])

  // A rename is just another JOIN with the same participant id.
  const name = identity?.name
  const participantId = identity?.id
  useEffect(() => {
    if (!participantId || !name) return
    send({ type: "JOIN", participantId, name })
  }, [participantId, name, send])

  const vote = useCallback(
    (value: PokerValue) => {
      setMyVote(value) // Optimistic; the next ROOM_STATE confirms it.
      send({ type: "VOTE", value })
    },
    [send]
  )

  const reveal = useCallback(() => send({ type: "REVEAL" }), [send])
  const reset = useCallback(() => send({ type: "RESET" }), [send])
  const leave = useCallback(() => send({ type: "LEAVE" }), [send])
  const dismissError = useCallback(() => setError(null), [])

  const me = room?.participants.find((p) => p.id === identity?.id)

  return {
    room,
    me,
    isOwner: Boolean(room && identity && room.ownerId === identity.id),
    connectionStatus: status,
    error,
    myVote,
    vote,
    reveal,
    reset,
    leave,
    dismissError,
  }
}
