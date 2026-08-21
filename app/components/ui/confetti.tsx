import confetti from "canvas-confetti"
import type {
  CreateTypes as ConfettiInstance,
  Options as ConfettiOptions,
} from "canvas-confetti"
import {
  useEffect,
  useImperativeHandle,
  useRef,
  type ComponentProps,
  type Ref,
} from "react"

export interface ConfettiRef {
  fire: (options?: ConfettiOptions) => void
}

type ConfettiProps = Omit<ComponentProps<"canvas">, "ref"> & {
  ref?: Ref<ConfettiRef>
}

/**
 * A canvas that fires confetti on demand.
 *
 * The canvas is scoped rather than global (`confetti.create`) so the effect
 * lives and dies with the component, and bursts are drawn off the main thread.
 * Nothing fires on mount: the caller decides when there is something to
 * celebrate, through the `fire` handle.
 */
export function Confetti({ ref, ...props }: ConfettiProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const instanceRef = useRef<ConfettiInstance | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return

    const instance = confetti.create(canvasRef.current, {
      resize: true,
      useWorker: true,
    })
    instanceRef.current = instance

    return () => {
      instance.reset()
      instanceRef.current = null
    }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      // Bursts are fire-and-forget; a rejected promise here would only mean the
      // canvas went away mid-animation.
      fire: (options) => void instanceRef.current?.(options)?.catch(() => {}),
    }),
    []
  )

  return <canvas ref={canvasRef} {...props} />
}
