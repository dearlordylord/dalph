import { createHash } from "node:crypto"

export const hostedFormalInputManifestPath = "scripts/hosted-formal-input-manifest.json"
export const hostedFormalInputManifestVersion = 1

const digestPaths = (paths) => createHash("sha256").update(JSON.stringify(paths)).digest("hex")
const isRepositoryPath = (path) =>
  typeof path === "string" &&
  path !== "" &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  !path.split("/").some((part) => part === "" || part === "." || part === "..")

export const createHostedFormalInputManifest = (paths) => {
  const normalized = [...new Set(paths)].sort((left, right) => left.localeCompare(right))
  if (normalized.length === 0 || normalized.some((path) => !isRepositoryPath(path)))
    throw new Error("Hosted formal input manifest requires canonical repository paths")
  return Object.freeze({
    version: hostedFormalInputManifestVersion,
    digest: digestPaths(normalized),
    paths: Object.freeze(normalized)
  })
}

export const parseHostedFormalInputManifest = (text) => {
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error("Hosted formal input manifest is not valid JSON", { cause: error })
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["digest", "paths", "version"]) ||
    value.version !== hostedFormalInputManifestVersion ||
    !Array.isArray(value.paths) ||
    value.paths.length === 0 ||
    value.paths.some((path) => !isRepositoryPath(path)) ||
    JSON.stringify([...value.paths].sort((left, right) => left.localeCompare(right))) !== JSON.stringify(value.paths) ||
    new Set(value.paths).size !== value.paths.length ||
    value.digest !== digestPaths(value.paths)
  )
    throw new Error("Hosted formal input manifest is malformed or internally inconsistent")
  return Object.freeze({ ...value, paths: Object.freeze([...value.paths]) })
}

export const serializeHostedFormalInputManifest = (manifest) => `${JSON.stringify(manifest, undefined, 2)}\n`
