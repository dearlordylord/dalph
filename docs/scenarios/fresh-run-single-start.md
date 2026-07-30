# Fresh workflow Runs begin once

The user accepted these scenarios in the conversation that requested this
implementation. They define how Dalph distinguishes beginning a new durable
Run from recovering one that already began.

## A maintainer starts a new Run

### Starting situation

A maintainer has selected one exact task-tracker target and its Git common
directory. No workflow-journal record exists for the Run identity that Dalph
will allocate. No Dalph coordinator owns the target, and no executor work for
the new Run exists.

### Trigger and boundary calls

The maintainer starts production coordination for the target. Dalph acquires
exclusive coordinator ownership for the target, asks its cryptographic
allocator for Run identity `R`, and asks the workflow journal to record
`WorkflowRunBegan` for `R` and the exact target.

The journal commits that record at position one before Dalph reads the task
tracker, changes a task claim, invokes Git, or starts executor work. Dalph then
coordinates the target and records ordinary workflow intents and observations
under `R`.

If coordination reaches its normal no-more-runnable-work result, Dalph records
one `WorkflowRunTerminated` record for `R`. The maintainer sees successful
completion. Dalph must not record workflow actions before `WorkflowRunBegan`,
record two beginning or termination facts, or place records for another target
under `R`.

### Crash and retry

If Dalph crashes before the journal acknowledges `WorkflowRunBegan`, no Run
has begun and the next ordinary start allocates a new identity. No tracker,
Git, or executor call has occurred.

If Dalph crashes after the journal acknowledges `WorkflowRunBegan`, the
unterminated Run is recovered using `R`; it is not begun again. The journal
record makes this distinction even when no ordinary workflow intent had yet
been recorded.

### Acceptance-test mapping

- `starts a production Run by recording its identity before reading the task tracker`
  proves the first durable fact and boundary order.
- `recovers a Run that crashed immediately after its beginning was recorded`
  proves that an empty-but-begun Run is recoverable without another beginning.

## A retained fresh Run identity is submitted again

### Starting situation

The workflow journal already contains `WorkflowRunBegan` for `R` and target
`T`. The first coordinator has released process-local and operating-system
ownership, so no concurrent coordinator exists. This is a sequential second
request, not a lock-contention scenario. No person needs to edit GitHub or Git
to trigger it.

### Trigger and boundary calls

A caller asks the fresh production startup boundary to begin `R` again. The
journal rejects the request with `WorkflowRunAlreadyBegan` before Dalph reads
the task tracker, changes a task claim, invokes Git, starts executor work, or
adds another workflow record.

The caller sees the typed startup failure. Dalph must not treat the repeated
fresh request as recovery and must not merge actions from two fresh starts into
one workflow-journal history.

An immediate retry receives the same rejection. Recovery is a separately
named request that reads the existing beginning fact instead of trying to
create it.

### Acceptance-test mapping

- `rejects a second fresh start for the same Run before any tracker read`
  proves sequential one-start enforcement at the production startup seam.
- `the journal atomically rejects a second beginning for one Run identity`
  proves the durable boundary rule independently of the application
  composition.

## A caller tries to activate a terminated Run

### Starting situation

The workflow journal contains one `WorkflowRunBegan` and one
`WorkflowRunTerminated` record for `R`. The coordinator no longer owns the
target, and no Run responsibility remains unfinished.

### Trigger and visible result

An ordinary production start allocates a different Run identity. If a caller
instead explicitly asks to recover `R`, Dalph rereads the workflow journal and
returns `WorkflowRunAlreadyTerminated` before reading the task tracker or
performing another workflow action.

There is no applicable retry that can make `R` recoverable: termination is a
durable Dalph fact. The maintainer must begin a new Run with a newly allocated
identity. Dalph must not append records after termination.

### Acceptance-test mapping

- `rejects recovery of a terminated Run before any tracker read` proves that a
  completed Run cannot be reactivated.
- `rejects every workflow record after Run termination` proves the journal
  history remains closed.

## Scenario-to-test handoff contract

Implementation handoff must report each scenario above against its named
passing test. Repository-wide typechecking, coverage, and model checking are
additional evidence and do not replace these mappings.
