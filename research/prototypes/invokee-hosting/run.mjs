#!/usr/bin/env node

import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const directory = dirname(fileURLToPath(import.meta.url))

const run = (script) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(directory, script)], { stdio: "inherit" })
    child.once("error", reject)
    child.once("exit", (code, signal) => resolve({ code, signal }))
  })

const smoke = await run("smoke.mjs")
if (smoke.code !== 0) process.exit(smoke.code ?? 1)
const seams = await run("source-seams.mjs")
if (seams.code !== 0) process.exit(seams.code ?? 1)
