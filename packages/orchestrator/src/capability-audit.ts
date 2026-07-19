import { Context, Effect, Layer, Ref, Schema } from "effect"

export const WriteAuthority = Schema.Literals([
  "Journal",
  "Filesystem",
  "Git",
  "TrackerMutation",
  "Process",
  "Evidence",
  "Cleanup",
  "Lock",
  "PolicyWrite"
])
export type WriteAuthority = typeof WriteAuthority.Type

export const CapabilityAuditEntry = Schema.TaggedUnion({
  TrackerGraphRead: {},
  WriteAttempted: { authority: WriteAuthority }
})
export type CapabilityAuditEntry = typeof CapabilityAuditEntry.Type

interface CapabilityAuditService {
  readonly trackerGraphRead: () => Effect.Effect<void>
  readonly writeAttempted: (authority: WriteAuthority) => Effect.Effect<void>
}

export class CapabilityAudit extends Context.Service<CapabilityAudit, CapabilityAuditService>()(
  "@dalph/CapabilityAudit"
) {}

interface CapabilityAuditTestService extends CapabilityAuditService {
  readonly entries: () => Effect.Effect<ReadonlyArray<CapabilityAuditEntry>>
}

export class CapabilityAuditTest extends Context.Service<
  CapabilityAuditTest,
  CapabilityAuditTestService
>()("@dalph/CapabilityAudit/Test") {}

export const capabilityAuditLayer = Layer.succeed(
  CapabilityAudit,
  CapabilityAudit.of({
    trackerGraphRead: Effect.fn("CapabilityAudit.trackerGraphRead")(function*() {
      yield* Effect.void
    }),
    writeAttempted: Effect.fn("CapabilityAudit.writeAttempted")(function*() {
      yield* Effect.void
    })
  })
)

export const capabilityAuditTestLayer = Layer.effectContext(
  Effect.gen(function*() {
    const recorded = yield* Ref.make<ReadonlyArray<CapabilityAuditEntry>>([])
    const append = (entry: CapabilityAuditEntry) => Ref.update(recorded, (entries) => [...entries, entry])
    const service = CapabilityAuditTest.of({
      entries: Effect.fn("CapabilityAudit.Test.entries")(function*() {
        return yield* Ref.get(recorded)
      }),
      trackerGraphRead: Effect.fn("CapabilityAudit.Test.trackerGraphRead")(
        function*() {
          yield* append(CapabilityAuditEntry.cases.TrackerGraphRead.make({}))
        }
      ),
      writeAttempted: Effect.fn("CapabilityAudit.Test.writeAttempted")(
        function*(authority) {
          yield* append(
            CapabilityAuditEntry.cases.WriteAttempted.make({ authority })
          )
        }
      )
    })

    return Context.empty().pipe(
      Context.add(CapabilityAudit, service),
      Context.add(CapabilityAuditTest, service)
    )
  })
)
