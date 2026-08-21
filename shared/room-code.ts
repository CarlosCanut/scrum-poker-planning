/**
 * Short, human friendly room codes.
 *
 * The alphabet drops characters that are easy to confuse when read aloud or
 * typed from a screen share (0/O, 1/I/L).
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

export const ROOM_CODE_LENGTH = 6

/** ~31^6 ≈ 887M combinations, plenty for ephemeral rooms. */
export function generateRoomCode(length = ROOM_CODE_LENGTH): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let code = ""
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length]
  return code
}

/** Uppercases and strips anything that cannot appear in a code. */
export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "")
}

const ROOM_CODE_PATTERN = new RegExp(`^[A-Z0-9]{${ROOM_CODE_LENGTH}}$`)

export function isValidRoomCode(input: string): boolean {
  return ROOM_CODE_PATTERN.test(input)
}
