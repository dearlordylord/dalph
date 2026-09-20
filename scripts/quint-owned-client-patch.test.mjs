import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname } from "node:path"
import { test } from "node:test"
import { runInNewContext } from "node:vm"

const quintRequire = createRequire(import.meta.url)
const load = ({
  artifacts = true,
  file = "apalache.js",
  javaExecutable = "/identified/java",
  javaUserHome = "/identified/home",
  marker = "127.0.0.1:40000",
  original = false,
  owned = true,
  ready = false
} = {}) => {
  const filename = quintRequire.resolve(`@informalsystems/quint/dist/src/${file}`)
  const require = createRequire(filename)
  let source = readFileSync(filename, "utf8")
  if (original) {
    const start = source.indexOf(
      "    const ownedEndpoint = process.env.DALPH_QUINT_OWNED_SERVER_ENDPOINT;",
      source.indexOf("async function connect(")
    )
    const end = source.indexOf("    // Try to connect to Shai", start)
    assert.ok(start > 0 && end > start)
    source = source.slice(0, start) + source.slice(end)
  }
  const launches = []
  const counts = { spawned: 0, downloaded: 0, closed: 0, reflected: 0, mutated: 0 }
  class Reflection {
    ServerReflectionInfo() {
      counts.reflected++
      const call = new EventEmitter()
      call.write = () =>
        queueMicrotask(() =>
          ready
            ? call.emit("data", { file_descriptor_response: { file_descriptor_proto: [Buffer.alloc(0)] } })
            : call.emit("error", new Error("fixture endpoint unavailable"))
        )
      call.end = () => {}
      return call
    }
    close() {
      counts.closed++
    }
  }
  const grpc = {
    credentials: { createInsecure: () => ({}) },
    loadPackageDefinition: () => ({ grpc: { reflection: { v1alpha: { ServerReflection: Reflection } } } })
  }
  const fs = {
    existsSync: () => artifacts,
    mkdirSync: () => {
      counts.mutated++
    },
    mkdtempSync: () => {
      counts.mutated++
      return "/tmp/controlled-tlc"
    },
    writeFileSync: () => {
      counts.mutated++
    },
    rmSync: () => {}
  }
  const overrides = {
    fs,
    "fs/promises": {
      stat: async () => {
        if (!artifacts) throw Object.assign(new Error("missing"), { code: "ENOENT" })
        return {}
      }
    },
    child_process: {
      spawn: (executable, args) => {
        counts.spawned++
        if (file !== "tlc.js") throw Error("negative control spawned a replacement")
        launches.push({ executable, args })
        const child = new EventEmitter()
        child.stdout = new EventEmitter()
        child.stderr = new EventEmitter()
        queueMicrotask(() => child.emit("close", 0))
        return child
      }
    },
    "@grpc/grpc-js": grpc,
    "@grpc/proto-loader": { loadSync: () => ({}), loadFileDescriptorSetFromObject: () => ({}) }
  }
  const env = owned
    ? {
        DALPH_QUINT_OWNED_SERVER_ENDPOINT: marker,
        DALPH_QUINT_JAVA_EXECUTABLE: javaExecutable,
        DALPH_QUINT_JAVA_USER_HOME: javaUserHome,
        PATH: "/unidentified/path"
      }
    : { PATH: "/unidentified/path" }
  const module = { exports: {} }
  const evaluate = runInNewContext(
    `(function(require,module,exports,__filename,__dirname){${source}\n})`,
    {
      process: { env, platform: process.platform },
      fetch: () => {
        counts.downloaded++
        throw Error("negative control downloaded an artifact")
      },
      queueMicrotask,
      console: { log() {} }
    },
    { filename }
  )
  const controlledRequire = (name) => overrides[name] ?? require(name)
  controlledRequire.resolve = require.resolve
  evaluate(controlledRequire, module, module.exports, filename, dirname(filename))
  return { api: module.exports, counts, launches }
}

void test("owned endpoint mismatch refuses reflection spawn and download", async () => {
  const f = load()
  const result = await f.api.connect({ hostname: "127.0.0.1", port: 8822 }, "0.56.1", 0)
  assert.equal(result.isLeft(), true)
  assert.deepEqual(f.counts, { spawned: 0, downloaded: 0, closed: 0, reflected: 0, mutated: 0 })
})

void test("owned endpoint connection failure cannot launch a replacement server", async () => {
  const f = load()
  const result = await f.api.connect({ hostname: "127.0.0.1", port: 40000 }, "0.56.1", 0)
  assert.equal(result.isLeft(), true)
  assert.equal(f.counts.reflected, 1)
  assert.equal(f.counts.closed, 1)
  assert.equal(f.counts.spawned, 0)
  assert.equal(f.counts.downloaded, 0)
})

void test("owned readiness uses one reflection call closes its client and never checks or starts tools", async () => {
  const f = load()
  assert.equal(typeof f.api.ownedServerReadiness, "function")
  const result = await f.api.ownedServerReadiness({ hostname: "127.0.0.1", port: 40000 })
  assert.equal(result.isLeft(), true)
  assert.equal(f.counts.reflected, 1)
  assert.equal(f.counts.closed, 1)
  assert.equal(f.counts.spawned, 0)
  assert.equal(f.counts.downloaded, 0)
})

void test("owned verification refuses missing prepared Apalache without filesystem mutation or download", async () => {
  const f = load({ artifacts: false })
  const result = await f.api.fetchApalache("0.56.1", 0)
  assert.equal(result.isLeft(), true)
  assert.equal(f.counts.downloaded, 0)
  assert.equal(f.counts.mutated, 0)
})

void test("owned verification refuses missing prepared Rust evaluator without downloading", async () => {
  const f = load({ file: "rust/binaryManager.js", artifacts: false })
  await assert.rejects(f.api.getRustEvaluatorPath(), /prepared Rust evaluator; downloading is disabled/u)
  assert.equal(f.counts.downloaded, 0)
  assert.equal(f.counts.mutated, 0)
})

void test("prepared Rust evaluator remains usable under owned marker", async () => {
  const f = load({ file: "rust/binaryManager.js" })
  assert.match(await f.api.getRustEvaluatorPath(), /quint_evaluator/u)
  assert.equal(f.counts.downloaded, 0)
})

void test("negative control detects the original automatic replacement launch", async () => {
  const f = load({ original: true })
  await assert.rejects(
    f.api.connect({ hostname: "127.0.0.1", port: 40000 }, "0.56.1", 0),
    /negative control spawned a replacement/u
  )
  assert.equal(f.counts.spawned, 1)
})

void test("successful owned readiness closes reflection client without constructing a checking client", async () => {
  const f = load({ ready: true })
  const result = await f.api.ownedServerReadiness({ hostname: "127.0.0.1", port: 40000 })
  assert.equal(result.isRight(), true)
  assert.equal(f.counts.reflected, 1)
  assert.equal(f.counts.closed, 1)
  assert.equal(f.counts.spawned, 0)
  assert.equal(f.counts.downloaded, 0)
})

void test("owned TLC uses identified Java rather than PATH and enforces observed user.home", async () => {
  const f = load({ file: "tlc.js" })
  const result = await f.api.verify({ moduleName: "fixture", tlaCode: "fixture" }, "0.56.1", {}, 0)
  assert.equal(result.isRight(), true)
  assert.equal(f.launches.length, 1)
  assert.equal(f.launches[0].executable, "/identified/java")
  assert.equal(f.launches[0].args[0], "-Duser.home=/identified/home")
})

void test("owned TLC refuses missing or relative Java identity before output or checker launch", async () => {
  for (const java of [
    { javaExecutable: null },
    { javaUserHome: null },
    { javaExecutable: "relative/java" },
    { javaUserHome: "relative/home" }
  ]) {
    const f = load({ file: "tlc.js", ...java })
    const result = await f.api.verify({ moduleName: "fixture", tlaCode: "fixture" }, "0.56.1", {}, 0)
    assert.equal(result.isLeft(), true)
    assert.match(result.value.explanation, /PATH fallback is disabled/u)
    assert.equal(f.counts.spawned, 0)
    assert.equal(f.counts.mutated, 0)
  }
})

void test("hosted TLC keeps its existing Java PATH route without local transport metadata", async () => {
  const f = load({ file: "tlc.js", owned: false })
  const result = await f.api.verify({ moduleName: "fixture", tlaCode: "fixture" }, "0.56.1", {}, 0)
  assert.equal(result.isRight(), true)
  assert.equal(f.launches[0].executable, "java")
  assert.ok(!f.launches[0].args.some((argument) => argument.startsWith("-Duser.home=")))
})
