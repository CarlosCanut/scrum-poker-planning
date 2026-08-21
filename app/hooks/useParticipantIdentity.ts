import { useCallback, useEffect, useState } from "react"

const STORAGE_KEY = "scrum-poker:identity"

export interface ParticipantIdentity {
  /** Authoritative, stable id. Survives refreshes so reconnects reuse it. */
  id: string
  /** Display name only — never used to authorize anything. */
  name: string
}

function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function read(): ParticipantIdentity | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ParticipantIdentity>
    if (typeof parsed.id !== "string" || typeof parsed.name !== "string") {
      return null
    }
    return { id: parsed.id, name: parsed.name }
  } catch {
    return null
  }
}

function write(identity: ParticipantIdentity): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity))
  } catch {
    // Private browsing with storage disabled: identity lasts for this tab only.
  }
}

/**
 * True once the app has mounted in this browser tab.
 *
 * Only the very first client render has to match the server's markup; every
 * mount after that is a client-side navigation, where storage can be read
 * synchronously. Without this, arriving at a room from the lobby paints a
 * full-page spinner for one frame — long enough to show up in the middle of
 * the route fade — for a read that takes no time at all.
 *
 * Module scope is safe on the server: nothing there ever sets it.
 */
let hydrated = false

/**
 * Persistent anonymous identity.
 *
 * On the first render of the document `ready` stays false until the browser
 * value has been read, which keeps the server-rendered markup and the first
 * client render identical. Later mounts start ready.
 */
export function useParticipantIdentity() {
  const [identity, setIdentity] = useState<ParticipantIdentity | null>(() =>
    hydrated ? read() : null
  )
  const [ready, setReady] = useState(hydrated)

  useEffect(() => {
    if (hydrated) return
    hydrated = true
    setIdentity(read())
    setReady(true)
  }, [])

  /** Sets the display name, keeping (or creating) the participant id. */
  const saveName = useCallback((name: string): ParticipantIdentity => {
    const next = { id: read()?.id ?? randomId(), name: name.trim() }
    write(next)
    setIdentity(next)
    return next
  }, [])

  /** Adopts a server-issued identity, e.g. the owner id from room creation. */
  const adopt = useCallback((next: ParticipantIdentity) => {
    write(next)
    setIdentity(next)
  }, [])

  return { identity, ready, saveName, adopt }
}
