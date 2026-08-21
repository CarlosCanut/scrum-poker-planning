# Scrum Poker

Real-time story point estimation for agile teams. Anonymous participants, named
rooms with short shareable codes, no accounts, no database.

```text
   Sprint 42 planning  ·  room 29UXGS  ·  round 1
   ┌─────────────────────────────────────────────┐
   │   ┌───┐      ┌───┐      ┌───┐      ┌───┐    │
   │   │###│      │###│      │###│      │ ? │    │
   │   └───┘      └───┘      └───┘      └───┘    │
   │    Alex       Bea       Chris       Dana    │
   └─────────────────────────────────────────────┘
             3 of 4 voted   ·   ▸ Reveal votes

   after the reveal:   8    8    8    —    consensus 🎉
```

Runs entirely on Cloudflare: **React Router** for the full-stack framework,
**Workers** for the runtime, and one **Durable Object per room** as the single
authoritative state owner. No separate backend, no external pub/sub.

---

## Features

- **Zero setup for players** — create a room, share the 6-character code. No
  sign-up, no install.
- **Real-time by default** — one WebSocket per tab; every change is broadcast to
  the whole room instantly.
- **Votes stay secret** — hidden votes never leave the server until someone
  reveals the round.
- **Anyone can run the round** — reveal and reset are open to every participant,
  because whoever runs the call is not always whoever opened the room.
- **Survives refreshes** — identity is stored locally, so a reload rejoins the
  same seat with the same vote.
- **Post-reveal stats** — average, median, low/high and a distribution chart,
  with confetti when the room agrees.
- **Self-cleaning** — rooms delete themselves after 12 hours of inactivity.
- **Two deploy shapes** — all-Cloudflare, or the UI on Vercel with the rooms
  still on Cloudflare.

## Requirements

| What | Version | Needed for |
| --- | --- | --- |
| Node.js | 20.19+ or 22+ | everything |
| pnpm | 9+ | everything |
| Cloudflare account | free plan is enough | deploying only |

No API keys, no database, no third-party services.

## Setup

```bash
git clone https://github.com/CarlosCanut/scrum-poker-planning.git
cd scrum-poker-planning
pnpm install
pnpm dev
```

Open **http://localhost:5173** — the app and the rooms both run on that one
origin, so there is nothing else to configure.

> The very first request after a cold start can fail while Vite optimizes
> dependencies. Reload once and it settles.

### Configuration

Nothing is required locally. Both values below are injected per deployment and
are never committed — `.dev.vars` is gitignored.

| Variable | Set on | What it does |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | the Worker | Comma-separated browser origins allowed to call the rooms API. Unset or empty means *no restriction*. |
| `VITE_API_ORIGIN` | the app build | Origin of the Worker that owns the rooms. Unset means *same origin*. |

```bash
cp .dev.vars.example .dev.vars   # local Worker values, if you need any
```

In production, set `ALLOWED_ORIGINS` on the Worker itself — never in the repo:

```bash
pnpm wrangler secret put ALLOWED_ORIGINS
```

## Usage

| Command | What it does |
| --- | --- |
| `pnpm dev` | App + rooms on http://localhost:5173 |
| `pnpm test` | Unit tests + Durable Object integration tests |
| `pnpm typecheck` | Route typegen, Worker typegen, then `tsc -b` |
| `pnpm build` | Production build (Cloudflare target) |
| `pnpm deploy:worker` | Build, then deploy the Worker |
| `pnpm format` | Prettier over `.ts` / `.tsx` |

A session looks like this:

```text
1. Create      name the room  →  get a code  →  share the link
2. Vote        everyone picks a card; the table only shows WHO has voted
3. Reveal      anyone flips the table over  →  stats + distribution
4. New round   anyone clears the votes and bumps the round counter
```

### Deploy

Rooms live in Durable Objects, which only exist on Cloudflare — so the Worker is
always part of the deployment. There are two supported shapes.

**A — All Cloudflare.** One origin, no CORS, nothing to configure.

```text
   browser ────► ┌────────────────────────────┐
                 │   Worker:  UI  +  rooms    │
                 └────────────────────────────┘
```

```bash
pnpm deploy:worker
```

That is the whole thing.

**B — App on Vercel, rooms on Cloudflare.** Two origins that have to know about
each other.

```text
   browser ────► ┌──────────────┐  https + wss  ┌────────────────┐
                 │  Vercel: UI  │ ─────────────►│  Worker: rooms │
                 └──────────────┘               └────────────────┘
                  VITE_API_ORIGIN                ALLOWED_ORIGINS
                  = the Worker's URL              = the Vercel domain(s)
```

1. **Deploy the Worker first** and note its URL:

   ```bash
   pnpm deploy:worker
   ```

2. **Point Vercel at it.** In Project → Settings → Environment Variables, add
   the variable below, then deploy. It is read at build time, so changing it
   later needs a redeploy.

   ```text
   VITE_API_ORIGIN = https://<worker>.<subdomain>.workers.dev
   ```

3. **Let the Worker accept that origin.** Include preview domains if you want
   previews to work:

   ```bash
   pnpm wrangler secret put ALLOWED_ORIGINS
   # → https://your-app.vercel.app,https://your-app-git-preview.vercel.app
   ```

Vercel sets `VERCEL=1` during builds, which is what switches the Vite and React
Router configs to the Vercel target — no separate build command. The Worker also
keeps serving its own copy of the UI, so it still works standalone as a fallback.

> The script is `deploy:worker`, not `deploy`: pnpm has a built-in `pnpm deploy`
> for workspaces that would shadow it.

## How It Works

Each room code always resolves to the same Durable Object instance. That object
is the only thing that knows the truth; clients never synchronize with each
other, they just render the state it broadcasts.

```text
   Alex          Bea          Chris          one WebSocket per tab
     │            │             │
     └────────────┼─────────────┘
                  ▼
     ┌──────────────────────────┐
     │   Cloudflare Worker      │   /api/*  →  rooms
     │                          │   /*      →  React Router (SSR)
     └────────────┬─────────────┘
                  │  POKER_ROOMS.getByName("29UXGS")
                  ▼
     ┌──────────────────────────┐
     │   PokerRoom("29UXGS")    │   one Durable Object per room
     ├──────────────────────────┤
     │   · state owner          │
     │   · state machine        │
     │   · WebSocket hub        │
     │   · pub/sub topic        │
     │   · SQLite persistence   │
     │   · authorization        │
     │   · 12 h expiry alarm    │
     └──────────────────────────┘
```

### A round

```text
      ┌────────────┐    REVEAL    ┌──────────────┐
      │   VOTING   │ ───────────► │   REVEALED   │
      │            │ ◄─────────── │              │
      └────────────┘    RESET     └──────────────┘
   votes held server-side       values sent to clients
   clients see only WHO voted   + average / median / spread
```

A round is a **consensus** when every vote that was *cast* is identical, with at
least two votes — measured against the votes sent, not the size of the room. Two
matching votes in a room of four still count; people who abstained are not
treated as disagreement.

### The protocol

```text
   client ──► server                 server ──► client
   ───────────────────────────       ─────────────────────────────────────
   JOIN     register / reconnect     ROOM_STATE   full public snapshot,
   VOTE     pick a card                           sent after every change
   REVEAL   end the round            ERROR        code + human message
   RESET    start the next round     PONG         heartbeat reply
   LEAVE    remove me
   PING     heartbeat
```

Every inbound message is validated with Zod before it touches room state.

### Design notes

- **Hidden votes never leave the server.** `createPublicRoomState()` is the one
  place internal state becomes public, and it attaches vote values only in the
  `revealed` phase. The single per-recipient exception is `yourVote`, which
  echoes a participant's *own* vote so a refreshed tab can restore its card.
- **Validated once, enforced twice.** `shared/validation.ts` defines each field
  once; the forms use it before sending, and the Worker re-runs the same schemas
  on whatever actually arrives. The client-side pass is a courtesy, never a
  check the server relies on.
- **Hibernation-aware.** Sockets are accepted with `ctx.acceptWebSocket()` and
  identity lives in `serializeAttachment()`, so Cloudflare can evict the object
  from memory while clients stay connected. Heartbeats are answered by
  `setWebSocketAutoResponse()` without waking the room.
- **Pure state machine.** `shared/room-logic.ts` holds every transition as a
  pure function, so the rules are unit-testable without any Cloudflare runtime.

### Project structure

```text
.
├─ app/                      React Router app — the UI
│  ├─ routes/                / (lobby)  ·  /room/:roomId
│  ├─ components/            table, deck, results, header
│  ├─ hooks/                 useRoomSocket · useParticipantIdentity
│  └─ lib/                   API client, meta tags, utils
│
├─ shared/                   imported by BOTH sides — one definition each
│  ├─ room-logic.ts          the state machine (pure functions)
│  ├─ room-types.ts          internal state → public state
│  ├─ protocol.ts            WebSocket + HTTP message schemas
│  ├─ validation.ts          every user-supplied field
│  ├─ poker-scales.ts        card values + vote statistics
│  └─ room-code.ts           6-character room codes
│
├─ workers/                  the Cloudflare side
│  ├─ app.ts                 entry — /api/* → rooms, /* → React Router
│  ├─ api.ts                 REST routes
│  ├─ cors.ts                ALLOWED_ORIGINS allowlist
│  ├─ env.d.ts               injected bindings
│  └─ durable-objects/
│     └─ PokerRoom.ts        one instance per room
│
└─ tests/
   ├─ unit/                  state machine + vote secrecy (plain Vitest)
   └─ worker/                real workerd + real Durable Objects
```

## Troubleshooting

**The first page load after `pnpm dev` is unstyled or fails.**
Vite is still optimizing dependencies. Reload once.

**`403 Origin not allowed.` from the rooms API.**
`ALLOWED_ORIGINS` on the Worker does not list the origin the app is served
from. Add it (comma-separated, no trailing slash) and redeploy, or leave it
unset while developing.

**The app on Vercel cannot reach the rooms.**
`VITE_API_ORIGIN` is read at *build* time — set it, then redeploy. Check that
it has no trailing slash, and that the Worker's `ALLOWED_ORIGINS` lists the
Vercel domain.

**The room says it does not exist.**
Rooms are deleted after 12 hours without activity. Codes skip look-alike
characters (no `0`, `O`, `1`, `I`, `L`), so a mistyped code reads the same way.

**`pnpm deploy` does nothing useful.**
Use `pnpm deploy:worker`. pnpm's own workspace `deploy` command shadows the
script name.

**TypeScript complains about bindings after editing `wrangler.jsonc`.**
The Worker types are generated. Run `pnpm cf-typegen` (or `pnpm typecheck`,
which does it first).
