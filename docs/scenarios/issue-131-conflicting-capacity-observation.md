# Count one task once when executor outer invocation reports disagree

Issue: [Derive the runnable frontier and bounded admission](https://github.com/dearlordylord/dalph/issues/131)

## Boundary rule

Dalph starts and observes one opaque executor invocation for a task attempt.
The review-loop executor may internally start an implementer, capture evidence,
run technical and semantic reviews, return findings to the same implementer,
retry, restore, and decide convergence. Those are executor-internal operations.
Their `OperationId` values never enter Dalph's generic frontier, admission,
capacity, or outer-invocation correlation.

The outer invocation has its own `ExecutorOuterInvocationId`. It begins when
Dalph asks the executor to implement the task and ends only when the executor
reports an outer terminal result. The executor may query several internal
providers while producing that report; generic Dalph receives only the
normalized outer report.

## Mismatched outer report

No person directly triggers this behavior. Dalph has configured two task-work
positions. Its journal says task A has one unfinished outer executor invocation
with identity `outer-A-7`. Task B is independently runnable. Capacity itself is
process-local and is not journaled.

Dalph asks the executor for the current lifecycle of `outer-A-7`. The executor
reports task A active under `outer-A-8`. In order, the capacity controller:

1. stores one `ExecutorInvocationMismatch` for task A, containing expected
   `outer-A-7` and reported `outer-A-8`;
2. counts task A once;
3. keeps the mismatch visible for task A; and
4. admits task B into the second position.

The read-only task-position map is
`{ A: ExecutorInvocationMismatch, B: Reserved }`; its usage is two. At capacity
one, task B receives `CapacityWait`. Dalph must not manufacture a second task-A
position, silently release task A, or stop unrelated task B when another
position exists.

`outer-A-7` and `outer-A-8` are both outer identities. An executor-internal
implementer operation and reviewer operation can never create this mismatch,
because generic Dalph never receives either internal identity.

## Later reports and restart

Repeating the same active report does not change usage. A matching active report
for `outer-A-7` changes task A to `Working`. A matching terminal, interrupted,
or absent report for `outer-A-7` removes task A from the map.

A terminal report only for `outer-A-8` removes the reported side of the
mismatch but does not prove what happened to `outer-A-7`; task A returns to
`AwaitingExecutorReport` and still counts once. An unknown or unreadable report
keeps the existing position and cannot attach to a temporary `Reserved`
position that has no recorded outer identity.

After a coordinator crash, Dalph discards its old report and process-local map.
It reconstructs one `AwaitingExecutorReport` position from the unfinished outer
invocation and asks the executor again. The executor reconstructs its private
implementation/review state, checks any relevant internal providers, and emits
one new normalized outer report. Generic Dalph does not reconstruct or count
the executor's internal operations.

## Invalid generic history

Two unfinished outer executor invocations for task A are invalid generic
managed history and fail before frontier derivation or an executor call.
Several unfinished executor-internal operations inside one outer invocation are
not this error; the executor owns and validates that private history.

## Pre-invocation reservation

Before the outer invocation intent is recorded, Dalph may hold one temporary
`Reserved` position for task A. Recording the outer intent binds that position
to `ExecutorOuterInvocationId`. Recording an executor-internal operation never
binds or changes generic task capacity.

## Scenario-to-test mapping

- Capacity two: a mismatched outer report counts task A once and admits task B.
- Capacity one: task B waits behind task A's one unresolved position.
- Repeated report: the same outer report does not increase map size.
- Exact release: only a matching terminal, interrupted, or absent outer report
  releases the expected position.
- Crash: restart rereads the executor and recreates the exact outer mismatch.
- Invalid generic history: two unfinished outer invocations for one task fail
  before calling the executor.
- Valid private history: multiple review-loop internal operations remain one
  opaque outer responsibility and one capacity position.
- Identity firewall: emitted TypeScript rejects `OperationId` where
  `ExecutorOuterInvocationId` is required.
- Source firewall: generic frontier, admission, activation, and reconstruction
  code contains no implementer, evidence, reviewer, findings-handback, retry,
  restoration, or convergence operation vocabulary.
