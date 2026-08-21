import { cn } from "~/lib/utils"

/**
 * The message under an input, tied to it with `aria-describedby`.
 *
 * Renders nothing when there is nothing to say, so a valid form carries no
 * empty rows — and announces politely rather than interrupting, since the
 * message appears in response to the user's own submit.
 */
function FieldError({
  id,
  children,
  className,
}: {
  id: string
  children?: string
  className?: string
}) {
  if (!children) return null

  return (
    <p
      id={id}
      role="alert"
      className={cn("swap-fade text-xs text-destructive", className)}
    >
      {children}
    </p>
  )
}

export { FieldError }
