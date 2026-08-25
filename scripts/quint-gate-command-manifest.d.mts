export type QuintManifestCommandKind = "typecheck" | "test" | "sampled-run" | "verify"

export interface QuintManifestCommand {
  readonly kind: QuintManifestCommandKind
  readonly name: string
}

export declare const quintGateCommandManifest: ReadonlyArray<QuintManifestCommand>
