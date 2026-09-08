import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { arch, platform } from "node:os"

const require = createRequire(import.meta.url)
const { version: quintPackageVersion } = require("@informalsystems/quint/package.json")
const {
  getRustEvaluatorPath,
  QUINT_EVALUATOR_VERSION: evaluatorVersion
} = require("@informalsystems/quint/dist/src/rust/binaryManager.js")

/** Identify the exact evaluator bytes used by this gate, not only their mutable release tag. */
export const readQuintEvaluatorProvenance = async (evaluatorPath) => {
  const resolvedPath = evaluatorPath ?? (await getRustEvaluatorPath())
  const [artifact, metadata] = await Promise.all([readFile(resolvedPath), stat(resolvedPath)])
  if (!metadata.isFile() || artifact.byteLength === 0) {
    throw new Error(`Quint evaluator provenance requires a nonempty regular file: ${resolvedPath}`)
  }

  return Object.freeze({
    architecture: arch(),
    bytes: artifact.byteLength,
    evaluatorPath: resolvedPath,
    evaluatorVersion,
    platform: platform(),
    quintPackageVersion,
    sha256: createHash("sha256").update(artifact).digest("hex")
  })
}

export const renderQuintEvaluatorProvenance = (provenance) =>
  `Quint evaluator provenance: package=${provenance.quintPackageVersion} evaluator=${provenance.evaluatorVersion} platform=${provenance.platform} architecture=${provenance.architecture} bytes=${provenance.bytes} sha256=${provenance.sha256} path=${provenance.evaluatorPath}`
