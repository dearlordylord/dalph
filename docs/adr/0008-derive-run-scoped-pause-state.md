# Derive run-scoped pause state from accepted user directions

Status: Revised by [issue #155](https://github.com/dearlordylord/dalph/issues/155)
and implemented at the application boundary by
[issue #166](https://github.com/dearlordylord/dalph/issues/166)

The current application boundary records a past-tense Operator-initiated event
only after it applies one exact run/task Pause or Unpause direction. An
ephemeral request may be lost if Dalph crashes before application; after the
event is appended, restart reconstructs its exact subject and direction. V1
records no authenticated operator or transport-command identity. Issues #134
and #135 own the later pausing, paused, and resuming progression from this
applied direction. The design still does not persist phase rollups or copy a
parent pause onto each child.

## Consequences

A task pause belongs to one `(RunId, TaskId)` and dynamically covers the task's
transitive grouping descendants. Grouping coverage neither creates dependency
edges nor pauses prerequisites, dependents, ancestors, or siblings. Pausing
waits for already-started bounded actions and shared integration to reach safe
release points, interrupts long-running agent work, preserves existing claims
and recoverable resources, and releases scoped execution capacity after the
provider confirms interruption. After Unpause, Dalph first rereads the
authorities needed by each preserved responsibility and reconciles changed
facts before selecting forward progress.

A confirmed pause is passive and survives coordinator restart through journal
reconstruction. A terminated run never reopens, and a new run does not inherit
an earlier run's pauses.
