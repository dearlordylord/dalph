/** Production-only persistence and file-lock adapters are outside the browser Lab composition. */
export const flock = (): never => {
  throw new Error("Node file locking is unavailable in the browser cassette Lab")
}

export const MigrationError = Error

export const make = flock
export const open = flock
export const run = flock
