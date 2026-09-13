/* eslint-disable import/no-nodejs-modules -- Qualification validates exact artifact locations. */
import nodePath from "node:path"
import { Effect, FileSystem, Schema } from "effect"
import { encodeProductionCliRecord, type ProductionCliRecord } from "../application/production-cli.js"
import { QualificationEvidenceFailure, qualificationDigest } from "./qualification-provenance.js"

/** An absolute, normalized path for one immutable qualification artifact. */
export const QualificationArtifactLocator = Schema.NonEmptyString.check(
  Schema.makeFilter((value) =>
    nodePath.isAbsolute(value) && nodePath.normalize(value) === value
      ? undefined
      : "artifact locator must be normalized and absolute"
  )
).pipe(Schema.brand("QualificationArtifactLocator"))
export type QualificationArtifactLocator = typeof QualificationArtifactLocator.Type

/** The exact disposable qualification container that a published artifact must remain outside. */
export const QualificationPublicationContainer = Schema.NonEmptyString.check(
  Schema.makeFilter((value) =>
    nodePath.isAbsolute(value) && nodePath.normalize(value) === value
      ? undefined
      : "qualification container must be normalized and absolute"
  )
).pipe(Schema.brand("QualificationPublicationContainer"))
export type QualificationPublicationContainer = typeof QualificationPublicationContainer.Type

/** Exact accepted original LF bytes; parent framing rejects every alternative JSON representation. */
export const qualificationTranscriptDigest = (records: ReadonlyArray<ProductionCliRecord>) =>
  qualificationDigest(
    new TextEncoder().encode(records.map((record) => `${encodeProductionCliRecord(record)}\n`).join(""))
  )

/** A write failure never claims publication or retries completed qualification/cleanup work. */
export const writeQualificationArtifact = Effect.fn("Qualification.writeArtifact")(function* (
  container: string,
  locator: QualificationArtifactLocator,
  validatedJson: string
) {
  const relative = nodePath.relative(container, locator)
  if (
    relative === "" ||
    (!relative.startsWith(`..${nodePath.sep}`) && relative !== ".." && !nodePath.isAbsolute(relative))
  )
    return yield* new QualificationEvidenceFailure({ operation: "ArtifactLocation" })
  const fs = yield* FileSystem.FileSystem
  yield* fs
    .writeFileString(locator, `${validatedJson}\n`, { flag: "wx" })
    .pipe(Effect.mapError(() => new QualificationEvidenceFailure({ operation: "WriteArtifact" })))
  return { _tag: "ArtifactPublished" as const, locator }
})
