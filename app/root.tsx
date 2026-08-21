import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router"

import spaceGroteskLatin from "@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?url"

import type { Route } from "./+types/root"
import { SITE_NAME, pageMeta } from "~/lib/meta"
import "./app.css"

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.ico", sizes: "any" },
  { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  { rel: "manifest", href: "/site.webmanifest" },
  // The splash is the first thing painted and it holds for two seconds, so
  // both halves of the mark have to be right in the first frame: without
  // these the logo pops in late and the wordmark visibly reflows when Space
  // Grotesk swaps in over the fallback.
  { rel: "preload", as: "image", href: "/logo_poker.webp" },
  {
    rel: "preload",
    as: "font",
    type: "font/woff2",
    href: spaceGroteskLatin,
    crossOrigin: "anonymous",
  },
]

/**
 * Publishes the request origin so route `meta` can build absolute URLs for
 * social crawlers. It never changes within a session, hence no revalidation.
 */
export function loader({ request }: Route.LoaderArgs) {
  return { origin: new URL(request.url).origin }
}

export function shouldRevalidate() {
  return false
}

/** Fallback for routes that do not define their own meta (e.g. errors). */
export function meta({ data }: Route.MetaArgs) {
  return pageMeta({ origin: data?.origin ?? "", title: SITE_NAME })
}

/**
 * The intro styles itself, inline and unlayered, rather than through Tailwind.
 *
 * The overlay is the very first thing painted, and it has to be right in that
 * first frame — if it waited for app.css the logo would flash unstyled at its
 * intrinsic size in the top-left corner before snapping into place. Values are
 * literals for the same reason: theme custom properties live in app.css and are
 * not defined yet at this point in the document.
 *
 * Consequence worth knowing: these values are duplicated from the theme.
 * `--background`, `--primary` and the heading font are the ones to keep in sync.
 */
const INTRO_CSS = `
.intro-overlay{position:fixed;inset:0;z-index:60;display:grid;place-items:center;pointer-events:none;
background:radial-gradient(38rem 26rem at 50% -6%,oklch(0.443 0.11 240.79/0.22),transparent 70%),oklch(0.141 0.005 285.823);
animation:intro-overlay 2200ms cubic-bezier(.23,1,.32,1) forwards}
.intro-mark{display:flex;flex-direction:column;align-items:center;
animation:intro-mark 2200ms cubic-bezier(.23,1,.32,1) forwards}
/* Sized to match the lobby's mark, so the splash reads as the same object
   settling into the page rather than a different one being swapped out. The
   source art carries roughly 22% transparent padding, so the negative margin
   is what actually sets the gap to the wordmark. */
.intro-mark img{width:9rem;height:9rem;margin-bottom:-1rem}
.intro-mark span{font-family:'Space Grotesk Variable',ui-sans-serif,system-ui,sans-serif;
font-size:1.875rem;line-height:2.25rem;font-weight:600;letter-spacing:-0.025em;color:oklch(0.985 0 0)}
.intro-mark span span{color:oklch(0.443 0.11 240.79)}
.app-reveal{animation:app-reveal 420ms cubic-bezier(.23,1,.32,1) 1800ms backwards}
/* Timeline, in one place — the percentages below are this table over 2200ms:
     0–380ms    mark fades up
     380–1750ms mark holds, fully legible (the "couple of seconds" of brand)
     1750ms     overlay starts dissolving
     1800ms     page fades in underneath it
     2200ms     overlay gone, page at full opacity */
@keyframes intro-overlay{0%,79.5%{opacity:1}99%{visibility:visible}100%{opacity:0;visibility:hidden}}
@keyframes intro-mark{0%{opacity:0;transform:scale(.96) translateY(4px)}
17.3%,79.5%{opacity:1;transform:none}
/* Drifts toward the viewer as the overlay dissolves, so the mark reads as
   receding into the page rather than simply switching off. */
100%{opacity:1;transform:scale(1.03) translateY(-2px)}}
/* The page is invisible but present for the whole hold, so it also has to be
   untouchable — otherwise a stray click lands on a control nobody can see.
   Discrete, so it flips back to interactive as the reveal crosses halfway;
   browsers that do not animate it just behave as they do today. */
@keyframes app-reveal{from{opacity:0;pointer-events:none}to{opacity:1}}
/* Reduced motion drops the splash entirely: it is motion that also holds the
   page back. Animations do not run when printing either, and an overlay that
   never fades would print as a page of logo on top of the room. */
@media (prefers-reduced-motion:reduce){.intro-overlay{display:none}
.app-reveal{animation:none}}
@media print{.intro-overlay{display:none}}
`

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    // The app is dark-only: the class is fixed rather than toggled so the
    // server-rendered HTML and the client always agree.
    <html lang="en" className="dark" style={{ colorScheme: "dark" }}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#09090b" />
        <Meta />
        <style dangerouslySetInnerHTML={{ __html: INTRO_CSS }} />
        <Links />
      </head>
      <body className="min-h-svh bg-background text-foreground antialiased">
        {/* Decorative and inert: the page underneath is the real content, and
            it is already in the DOM for anyone not watching the animation.
            Deliberately free of utility classes — INTRO_CSS above owns every
            pixel of this, so it cannot depend on app.css having loaded. */}
        <div className="intro-overlay" aria-hidden>
          <div className="intro-mark">
            <img src="/logo_poker.webp" alt="" width={500} height={500} />
            <span>
              Scrum<span>Poker</span>
            </span>
          </div>
        </div>

        <div className="app-reveal">{children}</div>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Something went wrong"
  let details = "An unexpected error occurred."
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "Page not found" : `Error ${error.status}`
    details =
      error.status === 404
        ? "That page does not exist. Check the room link and try again."
        : error.statusText || details
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message
    stack = error.stack
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-4 p-6">
      <h1 className="font-heading text-2xl font-semibold">{message}</h1>
      <p className="text-sm text-muted-foreground">{details}</p>
      <a className="text-sm text-primary underline underline-offset-4" href="/">
        Back to the lobby
      </a>
      {stack && (
        <pre className="w-full overflow-x-auto rounded-lg border bg-card p-4 text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  )
}
