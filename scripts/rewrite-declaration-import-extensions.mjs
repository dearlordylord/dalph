import fs from "node:fs"
import path from "node:path"

const [packageDirectory] = process.argv.slice(2)
if (packageDirectory === undefined) {
  throw new Error("usage: rewrite-declaration-import-extensions.mjs <package-directory>")
}

const distDirectory = path.resolve(packageDirectory, "dist")

const visit = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      visit(absolutePath)
      continue
    }
    if (!entry.name.endsWith(".d.ts")) continue

    const declaration = fs.readFileSync(absolutePath, "utf8")
    const rewritten = declaration.replace(/((?:from\s+|import\()["'][^"']+)\.ts(["'])/gu, "$1.js$2")
    if (rewritten !== declaration) fs.writeFileSync(absolutePath, rewritten)
  }
}

visit(distDirectory)
