import { createServer } from "vite"

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true }
})

try {
  await server.ssrLoadModule("/src/lab-engine.smoke.ts")
  console.log("Reducer Lab smoke scenarios passed.")
} finally {
  await server.close()
}
