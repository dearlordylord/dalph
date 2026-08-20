import { spawn } from "node:child_process"
import { createServer as createHttpServer } from "node:http"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const labRoot = fileURLToPath(new URL("..", import.meta.url))
const browserSmoke = fileURLToPath(new URL("browser-smoke.mjs", import.meta.url))
const host = "127.0.0.1"

const viteServer = await createServer({
  appType: "spa",
  root: labRoot,
  server: { middlewareMode: true }
})
const httpServer = createHttpServer(viteServer.middlewares)

try {
  await new Promise((resolve, reject) => {
    httpServer.once("error", reject)
    httpServer.listen(0, host, resolve)
  })
  const address = httpServer.address()
  if (address === null || address === undefined || typeof address === "string") {
    throw new Error("Reducer Lab browser check could not determine its HTTP port")
  }
  const labUrl = `http://${host}:${address.port}/`
  const child = spawn(process.execPath, [browserSmoke], {
    cwd: labRoot,
    env: { ...process.env, REDUCER_LAB_URL: labUrl },
    stdio: "inherit"
  })
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (signal !== null) reject(new Error(`Reducer Lab browser smoke ended from ${signal}`))
      else resolve(code ?? 1)
    })
  })
  if (exitCode !== 0) {
    throw new Error(
      `Reducer Lab browser smoke failed with exit ${exitCode}. `
        + "If Chromium could not launch, run `pnpm --dir prototypes/reducer-lab browser:install` as a user with system-package privileges."
    )
  }
} finally {
  if (httpServer.listening) {
    await new Promise((resolve, reject) => httpServer.close((error) => error === undefined ? resolve() : reject(error)))
  }
  await viteServer.close()
}
