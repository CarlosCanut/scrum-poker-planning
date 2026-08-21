import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  index("routes/_index.tsx"),
  route("room/:roomId", "routes/room.$roomId.tsx"),
] satisfies RouteConfig
