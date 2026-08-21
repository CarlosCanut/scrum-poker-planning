/**
 * Every field the app accepts, in one place.
 *
 * The same schemas run on both sides: the client uses them to validate forms
 * before anything is sent, and the Worker/Durable Object re-runs them on the
 * untrusted payload that actually arrives. Client-side validation is only a
 * courtesy — the server never trusts it.
 */

import { z } from "zod"

import {
  ROOM_CODE_LENGTH,
  isValidRoomCode,
  normalizeRoomCode,
} from "./room-code"
import { MAX_NAME_LENGTH, MAX_ROOM_NAME_LENGTH } from "./room-types"

/* -------------------------------------------------------------------------- */
/* Fields                                                                     */
/* -------------------------------------------------------------------------- */

export const participantIdSchema = z.uuid()

// The schema-level `error` covers the missing/wrong-type case; the per-check
// messages below still win for their own issues.
export const displayNameSchema = z
  .string({ error: "Enter a display name." })
  .trim()
  .min(1, "Enter a display name.")
  .max(MAX_NAME_LENGTH, `Names are limited to ${MAX_NAME_LENGTH} characters.`)

export const roomNameSchema = z
  .string({ error: "Give the room a name." })
  .trim()
  .min(1, "Give the room a name.")
  .max(
    MAX_ROOM_NAME_LENGTH,
    `Room names are limited to ${MAX_ROOM_NAME_LENGTH} characters.`
  )

/**
 * Accepts whatever the user typed and normalizes it first, so "abc-123" and
 * "ABC123" are the same code.
 */
export const roomCodeSchema = z
  .string({ error: "Enter the room code." })
  .transform(normalizeRoomCode)
  .pipe(
    z
      .string()
      .min(1, "Enter the room code.")
      .refine(
        isValidRoomCode,
        `Room codes are ${ROOM_CODE_LENGTH} characters, like ABC123.`
      )
  )

/* -------------------------------------------------------------------------- */
/* Forms                                                                      */
/* -------------------------------------------------------------------------- */

export const createRoomFormSchema = z.object({
  roomName: roomNameSchema,
  name: displayNameSchema,
})

export const joinRoomFormSchema = z.object({
  code: roomCodeSchema,
  name: displayNameSchema,
})

export const nameFormSchema = z.object({ name: displayNameSchema })

export type CreateRoomForm = z.infer<typeof createRoomFormSchema>
export type JoinRoomForm = z.infer<typeof joinRoomFormSchema>

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Flattens a Zod error into `{ field: firstMessage }`.
 *
 * Only the first message per field is kept: showing a stack of complaints
 * under one input is noise, and fixing the first usually clears the rest.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if (typeof key === "string" && !(key in errors)) {
      errors[key] = issue.message
    }
  }
  return errors
}
