/**
 * Poker values and scales.
 *
 * Shared by the client and the Durable Object so both sides agree on exactly
 * which values are legal.
 */

export const POKER_VALUES = [
  "0",
  "1",
  "2",
  "3",
  "5",
  "8",
  "13",
  "21",
  "?",
  "☕",
] as const

export type PokerValue = (typeof POKER_VALUES)[number]

export const DEFAULT_SCALE: PokerValue[] = [
  "1",
  "2",
  "3",
  "5",
  "8",
  "13",
  "21",
  "?",
]

export function isPokerValue(value: unknown): value is PokerValue {
  return (
    typeof value === "string" &&
    (POKER_VALUES as readonly string[]).includes(value)
  )
}

/** Values that carry a number, used for post-reveal statistics. */
const NUMERIC_VALUES: Partial<Record<PokerValue, number>> = {
  "0": 0,
  "1": 1,
  "2": 2,
  "3": 3,
  "5": 5,
  "8": 8,
  "13": 13,
  "21": 21,
}

export function numericValue(value: PokerValue): number | undefined {
  return NUMERIC_VALUES[value]
}

export interface VoteStats {
  /** How many participants voted at all (including "?" / "☕"). */
  total: number
  /** How many cast a numeric vote. */
  numeric: number
  average?: number
  median?: number
  min?: number
  max?: number
  /**
   * True when every vote that was *cast* is identical — the coincidence the
   * room celebrates.
   *
   * Deliberately measured against the votes sent, not the participant count:
   * in a room of four where only two people voted, two matching votes are a
   * coincidence. Abstainers are not counted as disagreement. A single vote is
   * not a coincidence, so at least two are required.
   */
  consensus: boolean
  /** Ordered [value, count] pairs following the scale order. */
  distribution: Array<{ value: PokerValue; count: number }>
}

export function computeVoteStats(
  votes: PokerValue[],
  scale: PokerValue[]
): VoteStats {
  const numbers = votes
    .map(numericValue)
    .filter((n): n is number => n !== undefined)
    .sort((a, b) => a - b)

  const counts = new Map<PokerValue, number>()
  for (const vote of votes) counts.set(vote, (counts.get(vote) ?? 0) + 1)

  let median: number | undefined
  if (numbers.length > 0) {
    const mid = Math.floor(numbers.length / 2)
    median =
      numbers.length % 2 === 0
        ? (numbers[mid - 1] + numbers[mid]) / 2
        : numbers[mid]
  }

  return {
    total: votes.length,
    numeric: numbers.length,
    average:
      numbers.length > 0
        ? numbers.reduce((sum, n) => sum + n, 0) / numbers.length
        : undefined,
    median,
    min: numbers.length > 0 ? numbers[0] : undefined,
    max: numbers.length > 0 ? numbers[numbers.length - 1] : undefined,
    consensus: votes.length >= 2 && counts.size === 1,
    distribution: scale
      .filter((value) => counts.has(value))
      .map((value) => ({ value, count: counts.get(value)! })),
  }
}
