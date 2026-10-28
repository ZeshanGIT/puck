import { httpActionGeneric, httpRouter } from "convex/server";

// HTTP endpoints, served at https://<deployment>.convex.site.
// Only a health check for now; the alert endpoints come next.
//
// Uses httpActionGeneric because convex/_generated/ does not exist yet:
// `convex codegen` needs a deployment. Once `bun run dev` has connected a
// deployment and generated it, switch to:
//   import { httpAction } from "./_generated/server";
const http = httpRouter();

http.route({
  path: "/health",
  method: "GET",
  handler: httpActionGeneric(async () => {
    return Response.json({ ok: true, service: "puck" });
  }),
});

export default http;
