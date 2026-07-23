# Let callers select a typed task-graph read policy

Status: Accepted

A task-tracker adapter may need several provider reads to assemble one
normalized task graph, and individual requests may fail while concurrent
provider changes can make the assembled reads detectably contradictory. Dalph
requires the calling workflow to select a bounded task-graph read policy. That
policy may first retry one failed page under a short Effect `Schedule` while
retaining already collected pages, then discard them and restart the complete
assembly under a separate bounded schedule if local recovery cannot finish a
valid result. The selected policy determines the complete Effect return type so
callers handle only possible outcomes; adapters neither retry secretly nor
access the workflow journal.

## Consequences

A detectable contradiction never becomes a valid normalized graph result. A
potentially mixed-time result with no detectable contradiction remains valid
and carries its temporal-consistency evidence. A single-attempt policy exposes
its first typed page failure or contradiction; a retrying policy consumes the
intermediate failures it handles and exposes a distinct exhaustion failure.
The workflow journal records the selected read intent and final result, not
individual provider requests, page retries, or adapter-internal assembly
attempts.

An exhausted read is an explicit failed workflow operation, not a failed
tracker task. Its requested graph area remains unavailable until a later manual
or automatic reconciliation policy selects a new read operation.

Task-graph read shapes form a closed, usage-earned set. Each shape identifies
the task subjects and fact families it reads and gives its matching successful
result precise empty-result semantics. New shapes are added only for concrete
workflow needs rather than anticipating a universal provider-independent query
language.
