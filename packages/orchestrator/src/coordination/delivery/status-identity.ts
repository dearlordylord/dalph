type IdentityPart = string | number

/** Injective identity encoding: every typed component carries its own length. */
export const canonicalIdentity = (parts: ReadonlyArray<IdentityPart>): string =>
  parts
    .map((part) => {
      // Domain callers provide finite branded ordinals/positions; numeric zero has one identity.
      const value = typeof part === "number" ? String(part) : part
      return `${typeof part === "number" ? "n" : "s"}${value.length}:${value}`
    })
    .join("")
