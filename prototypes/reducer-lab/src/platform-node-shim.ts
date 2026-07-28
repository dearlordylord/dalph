import { Layer } from "effect"

/**
 * Prototype-only proof of the current packaging gap: importing the pure
 * journal fold reaches a statically imported Node test layer through the
 * all-events schema. None of the reducer paths use it, so the browser lab
 * substitutes an empty layer until production exposes a browser-safe core.
 */
export const NodeServices = {
  layer: Layer.empty
}

export const NodeFileSystem = {
  layer: Layer.empty
}
