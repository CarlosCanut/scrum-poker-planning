interface RoomTitleProps {
  /** The room's own name, chosen when it was created. */
  roomName: string
  roomId: string
  round: number
}

/**
 * What the room is actually called, set front and center above the table —
 * the thing a team recognizes, not the code they typed to get here. The
 * header above it is chrome (code, round, actions); this is identity.
 */
export function RoomTitle({ roomName, roomId, round }: RoomTitleProps) {
  return (
    <div className="enter-fade flex flex-col items-center gap-1.5 text-center">
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
        {roomName}
      </h1>
      <p className="text-xs text-muted-foreground">
        Round {round} ·{" "}
        <code className="tracking-[0.15em] uppercase">{roomId}</code>
      </p>
    </div>
  )
}
