import { SELF, env } from "cloudflare:test"
import { afterEach, describe, expect, it } from "vitest"

import type { CreateRoomResponse } from "../../shared/protocol"

const ORIGIN = "https://poker.test"
const APP_ORIGIN = "https://scrum-poker.vercel.app"

/**
 * Cross-origin access, used when the app is hosted apart from the Worker.
 *
 * ALLOWED_ORIGINS is injected per deployment and nothing sets it here, so the
 * test environment starts with no allowlist — "no restriction", the same setup
 * as local development.
 */
describe("CORS", () => {
  it("answers the preflight a JSON POST triggers", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/rooms`, {
      method: "OPTIONS",
      headers: {
        Origin: APP_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN)
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "POST"
    )
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "content-type"
    )
  })

  it("echoes the origin on a cross-origin room creation", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json", Origin: APP_ORIGIN },
      body: JSON.stringify({ name: "Carlos", roomName: "Sprint 42 planning" }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN)
    expect(response.headers.get("vary")).toBe("Origin")
    expect((await response.json<CreateRoomResponse>()).roomId).toMatch(
      /^[A-Z0-9]{6}$/
    )
  })

  it("echoes the origin on lookups, including 404s", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/rooms/ZZZZZZ`, {
      headers: { Origin: APP_ORIGIN },
    })
    expect(response.status).toBe(404)
    expect(response.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN)
  })

  it("adds no CORS headers to same-origin requests", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/rooms/ZZZZZZ`)
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
  })

  it("still upgrades WebSockets from another origin", async () => {
    const created = await SELF.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Carlos", roomName: "Sprint 42 planning" }),
    })
    const { roomId } = await created.json<CreateRoomResponse>()

    const response = await SELF.fetch(`${ORIGIN}/api/rooms/${roomId}/ws`, {
      headers: { Upgrade: "websocket", Origin: APP_ORIGIN },
    })

    expect(response.status).toBe(101)
    expect(response.webSocket).not.toBeNull()
    response.webSocket?.accept()
    response.webSocket?.close(1000, "done")
  })
})

describe("CORS with an allowlist configured", () => {
  // `env` is writable in tests, but declared read-only-ish by its bindings.
  const settable = env as unknown as { ALLOWED_ORIGINS: string }

  afterEach(() => {
    settable.ALLOWED_ORIGINS = ""
  })

  it("allows a listed origin", async () => {
    settable.ALLOWED_ORIGINS = `https://other.example, ${APP_ORIGIN}`

    const response = await SELF.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json", Origin: APP_ORIGIN },
      body: JSON.stringify({ name: "Carlos", roomName: "Sprint 42 planning" }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN)
  })

  it("refuses an origin that is not listed", async () => {
    settable.ALLOWED_ORIGINS = APP_ORIGIN

    const response = await SELF.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: "https://attacker.example",
      },
      body: JSON.stringify({ name: "Carlos", roomName: "Sprint 42 planning" }),
    })

    expect(response.status).toBe(403)
  })

  it("refuses a WebSocket upgrade from an origin that is not listed", async () => {
    const created = await SELF.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Carlos", roomName: "Sprint 42 planning" }),
    })
    const { roomId } = await created.json<CreateRoomResponse>()

    settable.ALLOWED_ORIGINS = APP_ORIGIN
    const response = await SELF.fetch(`${ORIGIN}/api/rooms/${roomId}/ws`, {
      headers: { Upgrade: "websocket", Origin: "https://attacker.example" },
    })

    expect(response.status).toBe(403)
  })

  it("keeps serving the Worker's own origin", async () => {
    settable.ALLOWED_ORIGINS = APP_ORIGIN

    const response = await SELF.fetch(`${ORIGIN}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ name: "Carlos", roomName: "Sprint 42 planning" }),
    })

    expect(response.status).toBe(200)
  })

  it("rejects a preflight from an origin that is not listed", async () => {
    settable.ALLOWED_ORIGINS = APP_ORIGIN

    const response = await SELF.fetch(`${ORIGIN}/api/rooms`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://attacker.example",
        "Access-Control-Request-Method": "POST",
      },
    })

    expect(response.status).toBe(403)
  })
})
