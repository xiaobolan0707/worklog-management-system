import fp from "fastify-plugin";

// CSRF secrets are stored in server-side sessions and checked by AuthService.
// This plugin marks the application-level protection as an explicit dependency.
export const csrfPlugin = fp(async () => undefined, {
  name: "csrf",
  dependencies: ["authenticate"]
});
