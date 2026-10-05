import { runBoundedCommand } from "./run-bounded-command.mjs"
import { copyFileSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
await runBoundedCommand({
  executable: process.execPath,
  args: [
    fileURLToPath(new URL("../node_modules/@typescript/native/bin/tsc", import.meta.url)),
    "--noEmit",
    "--project",
    "packages/dalph/browser/tsconfig.json"
  ],
  cwd: root,
  name: "Running host browser typecheck",
  timeoutMilliseconds: 60_000,
  relayParentSignals: true
})
await runBoundedCommand({
  executable: "pnpm",
  args: ["--dir", "prototypes/reducer-lab", "exec", "vite", "build", "--config", "vite.live-host.config.ts"],
  cwd: root,
  name: "Running host browser bundle",
  timeoutMilliseconds: 60_000,
  relayParentSignals: true,
  environment: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
})
mkdirSync(new URL("../packages/dalph/dist/browser/", import.meta.url), { recursive: true })
copyFileSync(
  new URL("../packages/dalph/browser/index.html", import.meta.url),
  new URL("../packages/dalph/dist/browser/index.html", import.meta.url)
)
