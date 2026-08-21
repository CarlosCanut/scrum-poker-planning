import type {
  ApiErrorResponse,
  CreateRoomResponse,
  RoomInfoResponse,
} from "../../shared/protocol"

/**
 * Where the rooms API lives.
 *
 * Empty (the default, and always the case locally) means "same origin", so the
 * Cloudflare Worker serves both the app and the rooms. When the app is hosted
 * apart from the Worker — the app on Vercel, say — set `VITE_API_ORIGIN` to the
 * Worker's origin at build time.
 */
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/+$/, "")

function apiUrl(path: string): string {
  return `${API_ORIGIN}${path}`
}

export class RoomApiError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorResponse["code"]
  ) {
    super(message)
    this.name = "RoomApiError"
  }
}

async function readError(response: Response): Promise<never> {
  let body: Partial<ApiErrorResponse> = {}
  try {
    body = (await response.json()) as ApiErrorResponse
  } catch {
    // Non-JSON error response; fall back to a generic message.
  }
  throw new RoomApiError(
    body.message ?? "Something went wrong. Please try again.",
    body.code ?? "INVALID_MESSAGE"
  )
}

/** Creates the room server-side; the Worker assigns the code and owner id. */
export async function createRoom(input: {
  /** The room's display name. */
  roomName: string
  /** The creator's display name. */
  name: string
}): Promise<CreateRoomResponse> {
  const response = await fetch(apiUrl("/api/rooms"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!response.ok) await readError(response)
  return (await response.json()) as CreateRoomResponse
}

/** Looks a room up by code, returning its name when it is still alive. */
export async function findRoom(
  roomId: string
): Promise<{ exists: boolean; name?: string }> {
  const response = await fetch(apiUrl(`/api/rooms/${roomId}`))
  if (response.status === 404) return { exists: false }
  if (!response.ok) await readError(response)
  const info = (await response.json()) as RoomInfoResponse
  return { exists: info.exists, name: info.name }
}

/** One WebSocket per tab, addressed by room code. */
export function roomSocketUrl(roomId: string, participantId: string): string {
  const url = new URL(
    `/api/rooms/${roomId}/ws`,
    API_ORIGIN || window.location.origin
  )
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.searchParams.set("participantId", participantId)
  return url.toString()
}
