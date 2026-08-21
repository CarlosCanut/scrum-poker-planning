import { isbot } from "isbot"
import { renderToReadableStream } from "react-dom/server"
import { ServerRouter, type EntryContext } from "react-router"

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext
) {
  let shellRendered = false
  let statusCode = responseStatusCode

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      onError(error: unknown) {
        statusCode = 500
        // Errors thrown after the shell is sent cannot change the status.
        if (shellRendered) console.error(error)
      },
    }
  )
  shellRendered = true

  // Bots get the fully rendered document instead of a streamed shell.
  const userAgent = request.headers.get("user-agent")
  if (userAgent && isbot(userAgent)) {
    await body.allReady
  }

  responseHeaders.set("Content-Type", "text/html")
  return new Response(body, {
    headers: responseHeaders,
    status: statusCode,
  })
}
