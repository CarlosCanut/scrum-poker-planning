import {
  createRoomRequestSchema,
  type ApiErrorResponse,
  type CreateRoomResponse,
  type RoomInfoResponse,
  type ServerErrorCode,
} from "../shared/protocol"
import {
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from "../shared/room-code"
import { sanitizeRoomName } from "../shared/room-logic"
import {
  isForbiddenOrigin,
  preflightResponse,
  resolveAllowedOrigin,
  withCors,
} from "./cors"

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function apiError(
  code: ServerErrorCode,
  message: string,
  status: number
): Response {
  return json({ code, message } satisfies ApiErrorResponse, status)
}

/**
 * Everything under `/api/`. Rooms are addressed by their short code, which
 * always resolves to the same Durable Object instance.
 *
 * The app may be hosted on another origin (Vercel), so cross-origin access is
 * handled here rather than assumed away: this function owns the origin checks
 * and adds the CORS headers to whatever `route` returns, so the routing below
 * never has to think about them.
 */
export async function handleApiRequest(
  request: Request,
  env: Env
): Promise<Response> {
  const preflight = preflightResponse(request, env)
  if (preflight) return preflight

  if (isForbiddenOrigin(request, env)) {
    return new Response("Origin not allowed.", { status: 403 })
  }

  const segments = new URL(request.url).pathname.split("/").filter(Boolean)
  const roomId = normalizeRoomCode(segments[2] ?? "")

  // GET /api/rooms/:roomId/ws — the only WebSocket entry point, and the one
  // response that leaves untouched: a 101 cannot be copied, and upgrades are
  // not subject to CORS. Anything that is not a real upgrade falls through to
  // `route` below, which answers it as an ordinary error.
  const isUpgrade =
    request.headers.get("Upgrade")?.toLowerCase() === "websocket"
  if (
    isUpgrade &&
    segments[1] === "rooms" &&
    segments.length === 4 &&
    segments[3] === "ws" &&
    isValidRoomCode(roomId)
  ) {
    return env.POKER_ROOMS.getByName(roomId).fetch(request)
  }

  return withCors(
    await route(request, env, segments, roomId),
    resolveAllowedOrigin(request, env)
  )
}

/** The plain-HTTP routes. Every return value gets the CORS headers above. */
async function route(
  request: Request,
  env: Env,
  segments: string[], // ["api", "rooms", ...]
  roomId: string
): Promise<Response> {
  if (segments[1] !== "rooms") {
    return apiError("INVALID_MESSAGE", "Unknown endpoint.", 404)
  }

  // POST /api/rooms
  if (segments.length === 2) {
    return request.method === "POST"
      ? createRoom(request, env)
      : apiError("INVALID_MESSAGE", "Method not allowed.", 405)
  }

  if (!isValidRoomCode(roomId)) {
    return apiError("ROOM_NOT_FOUND", "That room code is not valid.", 404)
  }

  // A /ws path that reaches this far was not a WebSocket upgrade.
  if (segments.length === 4 && segments[3] === "ws") {
    return apiError("INVALID_MESSAGE", "Expected a WebSocket upgrade.", 426)
  }

  // GET /api/rooms/:roomId
  if (segments.length === 3 && request.method === "GET") {
    const snapshot = await env.POKER_ROOMS.getByName(roomId).snapshot()
    return json(
      {
        roomId,
        exists: snapshot !== null,
        ...(snapshot ? { name: snapshot.name } : {}),
      } satisfies RoomInfoResponse,
      snapshot ? 200 : 404
    )
  }

  return apiError("INVALID_MESSAGE", "Unknown endpoint.", 404)
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError("INVALID_MESSAGE", "Expected a JSON body.", 400)
  }

  // Both fields are re-validated here; whatever the form did is irrelevant.
  const parsed = createRoomRequestSchema.safeParse(body)
  if (!parsed.success) {
    return apiError(
      "INVALID_NAME",
      parsed.error.issues[0]?.message ?? "Invalid request.",
      400
    )
  }

  // The server issues the owner id — a client can never claim ownership.
  const participantId = crypto.randomUUID()
  // Normalized once, so the response and the room agree on one exact spelling.
  const roomName = sanitizeRoomName(parsed.data.roomName)

  // Codes are short, so retry on the (unlikely) collision with a live room.
  for (let attempt = 0; attempt < 5; attempt++) {
    const roomId = generateRoomCode()
    const created = await env.POKER_ROOMS.getByName(roomId).initialize({
      roomId,
      name: roomName,
      ownerId: participantId,
      ownerName: parsed.data.name,
    })
    if (created) {
      return json({
        roomId,
        roomName,
        participantId,
        isOwner: true,
      } satisfies CreateRoomResponse)
    }
  }

  return apiError(
    "INVALID_MESSAGE",
    "Could not allocate a room code. Please try again.",
    503
  )
}
