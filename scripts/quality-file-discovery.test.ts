import { expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

// @ts-expect-error The discovery implementation is an executable JavaScript module.
import { discoverQualityFiles } from "./quality-file-discovery.mjs"

it.effect("quality file discovery includes authored TS, TSX, MJS, and root configs", () =>
  Effect.gen(function* () {
    const files = yield* Effect.tryPromise(() => discoverQualityFiles({ rootDirectory: process.cwd() })).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.String)))
    )

    expect(files).toContain("packages/orchestrator/src/index.ts")
    expect(files).toContain("packages/orchestrator/src/coordination/application-exit/application-shell.test.ts")
    expect(files).toContain("scripts/project-memory.mjs")
    expect(files).toContain("vitest.config.ts")
    expect(files).toEqual([...files].toSorted((left, right) => left.localeCompare(right)))
    expect(files.some((file) => file.includes("node_modules"))).toBe(false)
    expect(files.some((file) => file.includes("/fixtures/") || file.startsWith("fixtures/"))).toBe(false)
  })
)

it.effect("quality file discovery can select an explicit staged subset", () =>
  Effect.gen(function* () {
    const files = yield* Effect.tryPromise(() =>
      discoverQualityFiles({
        explicitFiles: ["vitest.config.ts", "scripts/project-memory.mjs"],
        rootDirectory: process.cwd()
      })
    ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.String))))

    expect(files).toEqual(["scripts/project-memory.mjs", "vitest.config.ts"])
  })
)

it.effect("quality file discovery keeps TSX and root JavaScript configuration in scope", () =>
  Effect.acquireUseRelease(
    Effect.tryPromise(() => mkdtemp(join(tmpdir(), "dalph-quality-discovery-"))),
    (rootDirectory) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise(() => mkdir(join(rootDirectory, "packages", "fixture", "src"), { recursive: true }))
        yield* Effect.tryPromise(() => writeFile(join(rootDirectory, "packages", "fixture", "src", "view.tsx"), ""))
        yield* Effect.tryPromise(() => writeFile(join(rootDirectory, "vitest.config.mjs"), ""))

        const files = yield* Effect.tryPromise(() => discoverQualityFiles({ rootDirectory })).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.String)))
        )

        expect(files).toEqual(["packages/fixture/src/view.tsx", "vitest.config.mjs"])
      }),
    (rootDirectory) => Effect.promise(() => rm(rootDirectory, { force: true, recursive: true }))
  )
)
