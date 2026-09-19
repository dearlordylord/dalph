import { createServer } from "vite"

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { hmr: false, middlewareMode: true }
})

try {
  await server.ssrLoadModule("/src/cassette-lab-url-state.test.ts")
  await server.ssrLoadModule("/src/cassette-lab-url-integration.test.ts")
} finally {
  await server.close()
}
