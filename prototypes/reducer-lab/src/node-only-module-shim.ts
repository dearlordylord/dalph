/** Production-only persistence and file-lock adapters are outside the browser Lab composition. */
export const flock = (): never => {
  throw new Error("Node file locking is unavailable in the browser cassette Lab")
}

export const MigrationError = Error

const unavailable = (): never => {
  throw new Error("A Node-only adapter was invoked in the browser cassette Lab")
}

export const constants = {
  O_APPEND: 0,
  O_CREAT: 0,
  O_EXCL: 0,
  O_NOFOLLOW: 0,
  O_RDONLY: 0,
  O_RDWR: 0
}

export const randomUUID = (): string => globalThis.crypto.randomUUID()
export const createHash = unavailable
export const execFile = unavailable
export const promisify = (_function: unknown) => unavailable
export const setTimeout = globalThis.setTimeout.bind(globalThis)

export const Buffer = {
  from: (value: string, encoding?: string): Uint8Array => {
    if (encoding !== "base64") return new TextEncoder().encode(value)
    const decoded = globalThis.atob(value)
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
  }
}

const nodeOnlyDefault = {
  constants,
  dirname: unavailable,
  join: (...parts: ReadonlyArray<string>) => parts.join("/"),
  open: unavailable,
  platform: "browser",
  readdir: unavailable,
  readFile: unavailable,
  realpath: unavailable,
  rename: unavailable,
  resolve: (...parts: ReadonlyArray<string>) => parts.join("/"),
  stat: unavailable,
  unlink: unavailable,
  writeFile: unavailable
}

export default nodeOnlyDefault

export const make = flock
export const open = flock
export const run = flock
