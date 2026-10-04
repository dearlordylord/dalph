/* eslint-disable import/no-nodejs-modules -- Native aliases and missing directories are the boundary under test. */
import { mkdtemp, mkdir, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ConfigProvider, Effect } from "effect"
import { expect, it } from "vitest"
import { resolveChildCodexProviderHome, resolveCodexProviderHome } from "./codex-provider-home.js"

it("selects child homes with explicit overrides and disabled inheritance", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dalph-child-home-"))
  try {
    const parent = ConfigProvider.fromEnvRecord({ CODEX_HOME: path.join(root, "parent-codex"), HOME: root })
    const select = (environment: Readonly<Record<string, string>>, inherit: boolean) =>
      Effect.runPromise(resolveChildCodexProviderHome(environment, inherit, parent, root))
    expect(await select({ CODEX_HOME: path.join(root, "explicit") }, true)).toBe(path.join(root, "explicit"))
    expect(await select({ HOME: path.join(root, "child") }, true)).toBe(path.join(root, "parent-codex"))
    expect(await select({ HOME: path.join(root, "child") }, false)).toBe(path.join(root, "child", ".codex"))
    expect(await select({}, false)).toBe(path.join(root, ".codex"))
    expect(
      (
        await Effect.runPromise(
          resolveChildCodexProviderHome({ CODEX_HOME: "relative" }, true, parent, root).pipe(Effect.result)
        )
      )._tag
    ).toBe("Failure")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it("resolves home aliases and missing suffixes without creating or modifying the home", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dalph-home-namespace-"))
  try {
    const home = path.join(root, "home")
    const alias = path.join(root, "alias")
    await mkdir(home)
    await writeFile(path.join(home, "sentinel"), "unchanged")
    await symlink(home, alias)
    const canonical = await realpath(home)
    expect(await Effect.runPromise(resolveCodexProviderHome(alias))).toBe(canonical)
    expect(await Effect.runPromise(resolveCodexProviderHome(path.join(alias, "missing", "child")))).toBe(
      path.join(canonical, "missing", "child")
    )
    expect(await readdir(home)).toEqual(["sentinel"])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it("refuses dangling aliases and files instead of assigning an invented home namespace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dalph-home-invalid-"))
  try {
    const alias = path.join(root, "alias")
    await symlink(path.join(root, "missing-target"), alias)
    await writeFile(path.join(root, "file"), "unchanged")
    expect((await Effect.runPromise(resolveCodexProviderHome(alias).pipe(Effect.result)))._tag).toBe("Failure")
    expect((await Effect.runPromise(resolveCodexProviderHome(path.join(root, "file")).pipe(Effect.result)))._tag).toBe(
      "Failure"
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
