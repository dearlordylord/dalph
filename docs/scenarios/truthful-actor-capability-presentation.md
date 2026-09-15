# Issue #84 — truthful actor and capability presentation

This scenario file is the accepted implementation record for [GitHub issue
#84](https://github.com/dearlordylord/dalph/issues/84). It replaces the older
actor-span wording with the current production vocabulary. Alice is the person
affected: she asks Dalph to inspect one committed Run through either the
console or the Reducer Lab. The systems in scope are the read-only
`TraceReader`, the committed workflow journal, the shared
`WorkflowOccurrence` classification, the console renderer, the Reducer Lab,
and a separate passive current-status source. The tracker, Git, executor, and
Integrator mutation boundaries are not called by presentation.

## Scenario 1: Alice reads one immutable historical snapshot

### Starting facts

Run `R` has a valid beginning and a contiguous committed journal prefix through
`JournalPosition 12`. The prefix contains a Dalph-coordinator initiated action,
one non-action observation, and two distinct target-promotion attempt
occurrences. Each projected item already carries its exact `(RunId,
JournalPosition)` identity. A later journal position may exist, but Alice has
selected position 12. Executor and Integrator implementation details are not
workflow occurrences in this prefix.

### Trigger and ordered boundary calls

Alice chooses Run `R` and the exact cursor `(R, 12)` in the console or Reducer
Lab. The presentation boundary calls `TraceReader.readAt` over the committed
journal source. The reader validates the Run beginning, contiguous positions,
causal links, and occurrence classification, then returns one immutable
`TraceAtCursor` value. The renderer reads only that value and writes a
human-readable history. It does not append a journal record or contact GitHub,
Git, an executor process, or the Integrator.

The renderer uses the occurrence's exhaustive classification. A past-tense
initiated action names only the actor carried by that occurrence (for example,
“Dalph coordinator initiated target-promotion attempt”). A non-action outcome
states that no actor is proven (for example, “target-promotion result observed;
no actor proven”). It does not infer an actor from an operation name, causal
predecessor, UI command, executor report, or Integrator result.

### Crash, retry, and visible result

If Alice's output sink or browser loses the response after the read, the next
read of `(R, 12)` uses the same committed prefix and returns the same cursor,
items, and identities. No transcript is resumed because presentation has no
continuous-stream capability. A retry may render the snapshot again, but it
does not append a presentation event or invent a missing session/turn.

Alice sees a labelled historical snapshot through position 12. The two
promotion attempts remain individually inspectable and retain their original
`TraceItemIdentity` values, even when they concern the same target. Executor
and Integrator internals remain opaque; only generic workflow occurrences and
the evidence Dalph recorded are shown.

### Forbidden result

Presentation must not call a provider, rewrite the selected prefix with later
history, turn array indexes into identities, merge repeated attempts into one
“loop” row, create transcript/session/turn events, or attribute a non-action to
the actor of a related action.

## Scenario 2: Alice sees passive current status beside fixed history

### Starting facts

Alice has the same selected `TraceAtCursor` from Run `R`. A process-local
current-status source may report `Waiting`, `Running`, a settled delivery or
accepted cancelled/stopped executor standing, or an explicit unavailable state.
That source is observational only and has no journal append, tracker, Git,
executor, or Integrator capability.

### Trigger and ordered boundary calls

The console or Lab composes the selected historical value with the separate
passive status source. Status may change or reconnect while Alice remains on
the selected cursor. Presentation does not reread or rewrite the historical
prefix merely because status changes.

### Crash, retry, and visible result

If the status source disconnects, Alice sees the status as unavailable while
the same historical cursor and item identities remain visible. Reconnecting the
status source updates only the passive status region. A history read retry
still reads the named committed cursor and has no streaming/transcript
continuation to recover.

Every settled status item has one canonical `Settlement` entry whose nested
settlement fact is distinctly tagged as `DeliverySettlement`,
`CancelledAttemptSettled`, or `StoppedAttemptSettled`. Alice's task and attempt
identity used to distinguish the settlement come from that nested delivery fact
or its exact workflow responsibility. The task-scoped subject remains the view
scope; the status item does not add top-level `taskId` or `attemptId`
compatibility copies beside it and the nested fact.

### Forbidden result

The renderer must not use current status as a new workflow occurrence, move
the selected cursor, claim that status proves an executor or Integrator action,
add top-level `taskId` or `attemptId` compatibility fields beside the subject
and authoritative nested settlement fact, collapse cancelled and stopped
standings under one indistinguishable nested tag, or expose a live transcript
capability that the `TraceReader` does not provide.

## Acceptance-test mapping

| Scenario | Focused evidence |
| --- | --- |
| 1 — immutable snapshot, truthful actors, opaque internals, and individually inspectable promotion attempts | `occurrence-projection.test.ts` exhaustive classification/presentation test; `workflow-trace.production.test.ts` human-readable console rendering and retry snapshot test; `cassette-lab.smoke.ts` history/legend smoke test with exact repeated promotion identities |
| 2 — passive current status beside fixed history | `delivery-status.test.ts` canonical nested settlement shape and identity tests; `delivery-status.property.test.ts` delivery/cancelled/stopped settlement ordering test; `trace-reader.test.ts` fixed-history/current-status composition tests; `workflow-trace.production.test.ts` console capability test; `cassette-lab.smoke.ts` Lab status/history separation test |

The scenario intentionally does not add actors, sessions, transcript events,
workflow events, TraceReader facets, or history folding. Large navigation and
folding remain owned by issue #85.
