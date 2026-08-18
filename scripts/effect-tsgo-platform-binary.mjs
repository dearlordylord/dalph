import { chmodSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const rootRequire = createRequire(import.meta.url)

const resolvePlatformPackageJson = (platform, architecture) => {
  const effectTsgoPackageJson = rootRequire.resolve("@effect/tsgo/package.json")
  const effectTsgoRequire = createRequire(join(dirname(effectTsgoPackageJson), "dist", "effect-tsgo.js"))
  return effectTsgoRequire.resolve(`@effect/tsgo-${platform}-${architecture}/package.json`)
}

/** Ensure a clean pnpm install can execute Effect's platform diagnostics binary. */
export const ensureEffectTsgoPlatformBinaryExecutable = ({
  architecture = process.arch,
  chmod = chmodSync,
  platform = process.platform,
  resolvePackageJson = resolvePlatformPackageJson
} = {}) => {
  if (platform === "win32") return
  const packageJson = resolvePackageJson(platform, architecture)
  chmod(join(dirname(packageJson), "lib", "tsc"), 0o755)
}
