import { createServer } from "vite"

const server = await createServer({
  appType: "custom",
  logLevel: "error",
  server: { hmr: false, middlewareMode: true }
})

try {
  await server.ssrLoadModule("/src/continuation-authorization-lab.test.ts")
  await server.ssrLoadModule("/src/cassette-lab.smoke.ts")
  console.log("Reducer Lab maintained-cassette scenarios passed.")
} finally {
  await server.close()
}
