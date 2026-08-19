# Issue 142 complete-history generator audit

Status: deferred by the accepted #142 infrastructure bracket.

This is a test-evidence audit only. It changes no Dalph command, workflow
decision, provider request, journal event, retry rule, recovery rule, cleanup
action, or runtime-visible result.

## Evidence reviewed

The current subject-scoped executable models are the eight adapters named by
ADR 0010:

- `packages/dalph/test/conformance/task-fact-reconciliation.mbt.test.ts`
- `packages/dalph/test/conformance/git-reconciliation.mbt.test.ts`
- `packages/dalph/test/conformance/accepted-result-integration.mbt.test.ts`
- `packages/dalph/test/conformance/integration-finality.mbt.test.ts`
- `packages/dalph/test/conformance/control-direction-application.mbt.test.ts`
- `packages/dalph/test/conformance/planned-attempt-executor.mbt.test.ts`
- `packages/dalph/test/conformance/run-activation.mbt.test.ts`
- `packages/dalph/test/conformance/application-exit.mbt.test.ts`

The property-test lanes cover generated values and subject-local prefixes,
including `packages/orchestrator/src/coordination/reconstruction/reduce.property.test.ts`,
`packages/orchestrator/src/coordination/frontier/recovery.property.test.ts`,
`packages/orchestrator/src/workflow/task-tracker-facts/observation.property.test.ts`,
the task-claim, control-direction, attempt-choice, integration-finality,
evidence-store, and task-attempt-planning properties, and the Codex executor
policy properties. These tests do not construct one arbitrary chronology over
all subjects.

The maintained authored cassette catalog is
`packages/dalph/src/cassettes/catalog.ts` (`maintainedAuthoredCassetteCatalog`,
61 entries). Its recovery, pause, promotion, completion, and executor stories
provide concrete chronological evidence. The specialized Integrator,
promotion, completion-finality, application-Exit, and Codex cassette catalogs
remain subject-local as well. The recovery-prefix manifest and the tracker
completion tracer are the only #142 additions to this evidence inventory.

## Known cross-subject gap

No current subject MBT, property test, or maintained cassette composes all of
the following in one generated history: a current tracker graph change, task
capacity or Pause, an unfinished planned-attempt executor responsibility,
process loss, Git or Integrator ambiguity, and completion settlement. ADR 0010
deliberately leaves this composition outside exhaustive Quint authority. The
representative all-cut tracer covers tracker completion through fresh memory
and closed/reopened SQLite scopes; it does not claim to prove the other
families. Its scope is seven retained cuts in each store, not a complete
history generator.

No specific legal history shape is currently named that the existing subject
adapters, property tests, maintained cassettes, and representative tracer
cannot express through their own seams. A generator built now would therefore
invent a second workflow algebra and a new cross-subject fixture authority.

## Decision

Defer the complete-history generator. Reopen this decision only when a
maintainer names one legal cross-subject chronology, identifies the existing
seams that cannot express it, and accepts the additional fixture and shrinker
authority. Until then, preserve the subject-scoped models, maintained cassette
catalog, and representative dual-store tracer as separate evidence lanes.

## Scenario-to-test mapping

- `records the complete-history generator decision against current evidence`:
  this audit records the inventory, the concrete cross-subject gap, and the
  defer decision; `packages/dalph/test/conformance/recovery-prefix-manifest.test.ts`
  checks that the manifest evidence references remain current.
