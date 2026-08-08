import { Layer } from "effect"

/** Node-only adapters are outside the browser Lab composition. */
const unavailableNodeLayer = Layer.empty

export const NodeCrypto = { layer: unavailableNodeLayer }
export const NodeFileSystem = { layer: unavailableNodeLayer }
export const NodeHttpClient = { layer: unavailableNodeLayer, layerUndici: unavailableNodeLayer }
export const NodePath = { layer: unavailableNodeLayer }
export const NodeServices = { layer: unavailableNodeLayer }
