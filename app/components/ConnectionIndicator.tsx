import { LoaderCircle, WifiOff } from "lucide-react"

import type { ConnectionStatus } from "~/hooks/useRoomSocket"
import { cn } from "~/lib/utils"

const LABELS: Record<ConnectionStatus, string> = {
  connecting: "Connecting",
  connected: "Live",
  reconnecting: "Reconnecting",
  disconnected: "Disconnected",
}

export function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-xs",
        status === "connected" ? "text-muted-foreground" : "text-foreground"
      )}
      title={LABELS[status]}
    >
      {status === "connected" ? (
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
      ) : status === "disconnected" ? (
        <WifiOff className="size-3.5 text-destructive" />
      ) : (
        <LoaderCircle className="size-3.5 animate-spin" />
      )}
      <span className="hidden sm:inline">{LABELS[status]}</span>
    </span>
  )
}
