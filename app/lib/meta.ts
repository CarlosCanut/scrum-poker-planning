import type { MetaDescriptor } from "react-router"

export const SITE_NAME = "Scrum Poker"

export const SITE_DESCRIPTION =
  "Real-time story point estimation for agile teams. No accounts, no setup — just share the room code."

/** Social preview, generated from the logo onto the app's dark background. */
const OG_IMAGE = "/og-image.png"

/** Route matches are sparse — ancestors can be undefined mid-navigation. */
type RootMatch = { id: string; data?: unknown } | undefined

/**
 * The origin of the current request, published by the root loader.
 *
 * Social crawlers need absolute URLs, and the origin differs per deployment
 * (Vercel production, Vercel previews, the Worker), so it is read from the
 * request rather than hard-coded.
 */
export function originFromMatches(matches: readonly RootMatch[]): string {
  const root = matches.find((match) => match?.id === "root")
  const data = root?.data as { origin?: string } | undefined
  return data?.origin ?? ""
}

export function pageMeta({
  origin,
  title,
  description = SITE_DESCRIPTION,
  path = "/",
  noindex = false,
}: {
  origin: string
  title: string
  description?: string
  path?: string
  noindex?: boolean
}): MetaDescriptor[] {
  const url = `${origin}${path}`
  const image = `${origin}${OG_IMAGE}`

  const tags: MetaDescriptor[] = [
    { title },
    { name: "description", content: description },

    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: image },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    {
      property: "og:image:alt",
      content: `${SITE_NAME} — a cat in glasses holding poker cards`,
    },

    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
  ]

  // Only emit URL-bearing tags once the origin is known.
  if (origin) {
    tags.push({ property: "og:url", content: url })
  }

  if (noindex) {
    tags.push({ name: "robots", content: "noindex, nofollow" })
  } else if (origin) {
    tags.push({ tagName: "link", rel: "canonical", href: url })
  }

  return tags
}
