# Review-loop executor source-boundary scenarios

Status: accepted during the executor source-boundary Wayfinder reconciliation.

These scenarios preserve the current single-executor workflow while making
source ownership truthful. The implementation may replace the unreleased
journal event shape; Dalph has no released product database whose bytes, tags,
or schema require migration compatibility.

## Dalph starts one opaque review-loop invocation

### Starting situation

No person directly triggers this scenario. A running Dalph coordinator has one
planned task attempt with its exact claim, Base SHA, worktree, and task-work
session. The review-loop executor is the only executor installed in the
application composition. The journal contains the generic task-attempt history
and any review-loop executor history already recorded for that attempt.

The generic orchestrator knows the attempt and its outstanding executor
invocation responsibility. It does not know whether the review-loop executor
will next capture evidence, ask a reviewer, return findings, retry a provider
request, or record convergence.

### Trigger and ordered actions

Activation asks the injected executor bundle to reconstruct and project the
attempt's executor-owned history. The review-loop executor returns an outer
invocation with exact correlation and a ready, waiting, interrupted, or
completed projection. Dalph separately supplies the task-work capacity
requirement. For example, the executor may report an invocation ready, but it
does not request a position.

If the invocation is ready and admitted, Dalph asks the review-loop executor
bundle to continue that exact outer invocation. The review-loop executor
records its exact internal intent before an ambiguity-crossing call, interprets
its internal operations, and calls the same Git, evidence-store, coding-agent,
or reviewer boundaries required by the existing protocol. Dalph receives the
normalized outer result and activates the generic frontier again.

No new person-facing command, provider request, retry bound, artifact,
disposition, or outcome is introduced by the source-boundary change.

### Crash, retry, and visible result

A coordinator crash before or after an ambiguity-crossing request keeps the
existing intent-before-effect and observe-before-retry behavior. The refactor
must not add a new retry or infer that an unrecorded result did not occur.

The operator sees the same task progress, waits, failures, and final outcome as
before the refactor. The operator does not see internal review-loop stage names
as generic Dalph stages.

Dalph must not let generic reconstruction, frontier derivation, admission, or
activation inspect evidence, reviewer, findings-handback, or convergence
payloads. It must not duplicate a provider request or treat an internal event
tag as generic scheduling authority.

### Acceptance-test mapping

- `generic activation continues an opaque review-loop invocation` proves the
  injected outer projection and continuation path.
- Existing review-loop evidence, review, handback, retry, and convergence tests
  prove that internal behavior remains unchanged.
- A checked import rule proves that generic reconstruction, frontier,
  admission, and activation cannot import the review-loop implementation or
  its internal types.

## Dalph restarts while a reviewer invocation is unresolved

### Starting situation

No person directly triggers the crash or restart. Dalph has recorded the exact
review-loop intent for a reviewer invocation, including its attempt,
operation, and reviewer-session identities. The reviewer provider may have
accepted the request, but Dalph has not recorded a final review result.

The coordinator process dies. The provider-owned reviewer process may stop,
remain active, or complete while Dalph is down. The journal remains available.

### Trigger and ordered actions

The Dalph process restarts and scans the complete journal in position order.
Journal storage validates each physical row, record key, and position. The
application composition gives review-loop payloads to the injected review-loop
codec and validator. The review-loop executor reconstructs the unresolved
internal invocation and returns only its outer correlation and projection to
generic reconstruction.

When activation continues the outer invocation, the review-loop executor asks
the reviewer provider to create, discover, or resume the exact recorded
reviewer session. It records the observed result through its internal protocol
and returns a normalized outer result.

### Crash, retry, and visible result

Another crash at any existing intent, request, observation, or outcome cut
repeats the same complete reconstruction and fresh provider observation. Dalph
does not allocate another semantic review round merely because the coordinator
restarted.

The operator sees either continued progress, the existing typed wait or
failure, or the same completed/non-convergent result. Generic Dalph must not
read a review manifest or internal event name to decide whether the reviewer is
running or finished.

### Acceptance-test mapping

- `restart delegates unresolved reviewer history to the review-loop executor`
  proves complete in-memory reconstruction without generic stage knowledge.
- The same scenario through a closed and reopened SQLite journal proves the
  production decoding and reconstruction composition.
- The stateful reviewer-provider test proves that a reviewer may complete
  during coordinator downtime and that restart reuses the exact invocation.

## A stage-name-free test executor drives generic orchestration

### Starting situation

This is controlled test evidence, not a second production executor. No person,
external provider, crash, or retry applies because the test bundle performs no
outside request and its internal state is process-local fixture data.

The test composition installs a minimal executor bundle whose private internal
name and payload do not contain review-loop vocabulary.

### Trigger and ordered actions

The test gives generic reconstruction an executor-owned history value. Generic
reconstruction asks the injected bundle for an outer projection. Frontier,
admission, and activation use only the returned correlation, provider
lifecycle, wait, continuation, and outcome. Dalph supplies any task-work
capacity requirement independently.

### Visible and forbidden result

The test observes the same generic transition sequence regardless of the
bundle's private stage name. No production configuration, executor registry,
protocol identity, or switching command is created.

Generic source, emitted declarations, traces, and snapshots must not contain
the test bundle's private stage name or review-loop internal names.

### Acceptance-test mapping

- `generic orchestration uses a stage-name-free executor bundle` proves the
  replaceability tracer bullet.
- The import-boundary check rejects any generic import from the
  `review-loop-executor` module tree.
- A composition test proves production installs exactly one review-loop
  executor bundle.

## Deferred multi-executor behavior

V1 has only one production executor, so changing executors during a run,
routing mixed executor histories, handling an unavailable old executor, and
authorizing an operator to restart under another executor do not occur in
these scenarios. Issue #127 owns that v2 design.

That design must preserve the accepted direction that executor ownership is
per planned task attempt. The first executor invocation for an attempt records
the owning executor protocol identity; later executor history for that attempt
uses the same identity. A clean restart may create a new attempt under another
executor only after exact old writers and resources are safely handled.
Existing issues #66, #69, and #83 remain the first reuse candidates for clean
restart, disposition-authorized cleanup, and visible operator state.
