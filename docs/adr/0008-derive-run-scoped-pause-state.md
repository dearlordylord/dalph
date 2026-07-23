# Derive run-scoped pause state from user commands

Status: Accepted

Dalph records distinct run/task pause and resume commands in one run's workflow
journal under branded control-command identities, then derives pausing, paused,
and resuming phases from those commands, ordinary workflow outcomes, grouping
coverage, and outstanding responsibilities. It does not persist phase rollups
or copy a parent pause onto each child.

## Consequences

A task pause belongs to one `(RunId, TaskId)` and dynamically covers the task's
transitive grouping descendants. Grouping coverage neither creates dependency
edges nor pauses prerequisites, dependents, ancestors, or siblings. Pausing
waits for already-started bounded actions and shared integration to reach safe
release points, interrupts long-running agent work, preserves existing claims
and recoverable resources, and releases scoped execution capacity after the
provider confirms interruption. Resume first rereads the authorities needed by
each preserved responsibility and reconciles changed facts before selecting
forward progress.

A confirmed pause is passive and survives coordinator restart through journal
reconstruction. A terminated run never reopens, and a new run does not inherit
an earlier run's pauses.
