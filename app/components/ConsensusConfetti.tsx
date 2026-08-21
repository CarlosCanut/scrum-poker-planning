import type { Options as ConfettiOptions } from "canvas-confetti"
import { useEffect, useRef } from "react"

import { Confetti, type ConfettiRef } from "~/components/ui/confetti"

/** How long the fireworks keep going after a unanimous round. */
const DURATION_MS = 5000
const BURST_INTERVAL_MS = 220

/** Reads well on the dark table: brand blues, white, a couple of accents. */
const COLORS = [
  "#3b82f6",
  "#60a5fa",
  "#93c5fd",
  "#ffffff",
  "#a78bfa",
  "#22d3ee",
]

const BASE: ConfettiOptions = {
  spread: 360,
  startVelocity: 34,
  ticks: 90,
  gravity: 0.9,
  scalar: 1.05,
  colors: COLORS,
  disableForReducedMotion: true,
}

const randomBetween = (min: number, max: number) =>
  Math.random() * (max - min) + min

interface ConsensusConfettiProps {
  /** Part of the effect key, so each unanimous round celebrates exactly once. */
  round: number
  active: boolean
}

/**
 * Celebrates a unanimous round: two cannons for the initial hit, then
 * fireworks raining across the whole viewport.
 */
export function ConsensusConfetti({ round, active }: ConsensusConfettiProps) {
  const confettiRef = useRef<ConfettiRef>(null)

  // Deliberately no "already celebrated" ref: the effect only re-runs when the
  // round or the consensus changes, and a state re-broadcast changes neither.
  // A ref guard would also swallow the celebration under StrictMode, whose
  // mount/unmount/remount resets the canvas after the first burst.
  useEffect(() => {
    if (!active) return

    // canvas-confetti also honours this per burst, but skipping the timer
    // entirely avoids five seconds of pointless work.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const fire = (options: ConfettiOptions) =>
      void confettiRef.current?.fire({ ...BASE, ...options })

    fire({
      particleCount: 120,
      angle: 60,
      spread: 70,
      origin: { x: 0, y: 0.9 },
    })
    fire({
      particleCount: 120,
      angle: 120,
      spread: 70,
      origin: { x: 1, y: 0.9 },
    })

    const endAt = Date.now() + DURATION_MS
    const interval = window.setInterval(() => {
      const timeLeft = endAt - Date.now()
      if (timeLeft <= 0) {
        window.clearInterval(interval)
        return
      }

      // Thin out as the celebration winds down.
      const particleCount = 60 * (timeLeft / DURATION_MS)
      fire({
        particleCount,
        origin: { x: randomBetween(0.05, 0.4), y: Math.random() - 0.2 },
      })
      fire({
        particleCount,
        origin: { x: randomBetween(0.6, 0.95), y: Math.random() - 0.2 },
      })
      fire({
        particleCount: particleCount / 2,
        origin: { x: randomBetween(0.35, 0.65), y: Math.random() - 0.2 },
      })
    }, BURST_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [active, round])

  return (
    <Confetti
      ref={confettiRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 size-full"
    />
  )
}
