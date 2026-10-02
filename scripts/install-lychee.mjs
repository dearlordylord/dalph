import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const lycheeVersion = "0.24.2"

// SHA-256 digests published on the pinned release's GitHub asset records.
const releases = {
  "linux-x64": ["x86_64-unknown-linux-musl", "73657a111819a30c47c08352896796f23d64e4eb2b3ed39b6d32149241566fc5"],
  "linux-arm64": ["aarch64-unknown-linux-musl", "5d0b0e3aeab240f41920c633a6eaf97599be6eedda034b36e858ede7dba5e535"],
  "darwin-x64": ["x86_64-apple-darwin", "887503a9cff667d322b8d0892b40bf49976eb9507af8483220a3706cdad55978"],
  "darwin-arm64": ["aarch64-apple-darwin", "c9d3740ea2d891854d37116c9fba840f37b6e7c89d330e7db84ac333631c4977"]
}

/** Install the pinned verifier outside the checkout; no workspace dependency or build changes. */
export const ensureLychee = async () => {
  const platform = `${process.platform}-${process.arch}`
  const release = releases[platform]
  if (release === undefined)
    throw new Error(`Lychee provisioning supports Linux/macOS x64/arm64; unsupported ${platform}`)
  const root = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "dalph", "lychee", lycheeVersion, platform)
  const binary = join(root, "lychee")
  if (!existsSync(binary)) {
    mkdirSync(dirname(root), { recursive: true })
    const staging = mkdtempSync(`${root}-`)
    try {
      const [target, expectedDigest] = release
      const url = `https://github.com/lycheeverse/lychee/releases/download/lychee-v${lycheeVersion}/lychee-${target}.tar.gz`
      process.stderr.write(`Installing Lychee ${lycheeVersion} (${platform}); download timeout 30s.\n`)
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new Error(`Lychee download failed: HTTP ${response.status}`)
      const archive = Buffer.from(await response.arrayBuffer())
      if (createHash("sha256").update(archive).digest("hex") !== expectedDigest)
        throw new Error("Lychee release archive SHA-256 mismatch")
      const archivePath = join(staging, "lychee.tar.gz")
      writeFileSync(archivePath, archive)
      execFileSync("tar", ["-xzf", archivePath, "-C", staging, "--strip-components=1", `lychee-${target}/lychee`], {
        timeout: 10_000
      })
      chmodSync(join(staging, "lychee"), 0o755)
      rmSync(archivePath)
      // Concurrent installations may have already published the same pinned release.
      if (!existsSync(binary)) {
        try {
          renameSync(staging, root)
        } catch (error) {
          if (!new Set(["EEXIST", "ENOTEMPTY"]).has(error.code) || !existsSync(binary)) throw error
        }
      }
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  }
  const version = execFileSync(binary, ["--version"], { encoding: "utf8", timeout: 5_000 }).trim()
  if (version !== `lychee ${lycheeVersion}`) throw new Error(`Unexpected verifier version: ${version}`)
  return binary
}
