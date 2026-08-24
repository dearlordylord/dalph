# Run one task through a hermetic no-crash Dalph lifecycle

Issue: [Build the hermetic no-crash lifecycle fixture](https://github.com/dearlordylord/dalph/issues/86)

Status: accepted by the owner on 2026-08-24 for the reliable-code and working-MVP frontier.

This scenario qualifies the existing production composition with real local
resources. It does not define a second workflow or expose private executor or
Integrator stages.

## A maintainer runs one deterministic task from discovery through cleanup

### Starting situation

The test harness owns one temporary directory and records every resource it
creates. Inside it, a local Git repository and a bare remote both point their
`master` refs at the same initial commit. The deterministic task tracker reports
one open task A with no prerequisites and no claim. No Run journal, evidence
object, task worktree, task branch, Integrator candidate, child agent process,
or coordinator lock exists yet.

No person performs each workflow step. A maintainer starts the test, and the
running Dalph coordinator selects task A from the deterministic tracker.

### Trigger and chronological behavior

1. Dalph begins one exact Run in SQLite, reads the complete tracker graph and
   task specification, and records those observations.
2. Dalph creates the exact tracker claim, records one immutable planned attempt
   at the initial Base commit, and asks real Git to create its exact branch and
   worktree.
3. The deterministic planned-attempt executor starts one real child process in
   that worktree. The child writes the task result and commits it. The executor
   stores immutable evidence in the filesystem EvidenceStore and reports one
   accepted result containing that exact commit and evidence reference.
4. Dalph records the accepted integration obligation. The injected outer
   Integrator creates one explicit candidate commit whose ordered parents are
   the current bare-remote `master` head followed by the accepted result, then
   reports that candidate. Dalph asks real Git to prove those parents.
5. Dalph asks real Git to replace the bare remote's `master` only if it still
   has the expected old commit. Git applies that compare-and-set once.
6. After promotion, Dalph asks the deterministic tracker to replace A's exact
   active claim with the exact completion claim bound to the promoted attempt.
   It then asks the tracker to complete A, reads A again, sees it completed
   successfully, and deletes that exact completion claim.
7. Dalph records the completed Run termination in SQLite. A successful
   terminal attempt does not yet carry an
   accepted workflow-disposition occurrence that authorizes Dalph to delete its
   worktree or branch; issue #89 owns that terminal cleanup behavior. Dalph
   therefore leaves those resources and the immutable evidence untouched.
8. The fixture closes the application scope, verifies that the coordinator
   lock and child process are gone, and then removes only the temporary root it
   owns, including the still-preserved task resources, bare remote, SQLite
   database, and evidence store.

There is no crash or retry in this ticket: issue #88 owns crash cuts and
reconciliation for this same fixture. The deterministic tracker and executor
stand in for remote providers so this test does not contact or mutate GitHub or
an agent service. Git commands, worktree registration, the bare target ref,
SQLite, filesystem evidence, the OS lock, and the child process are real local
boundaries.

### Visible result and forbidden result

The maintainer sees one passing production-shaped MVP journey. The bare
remote's `master` contains the task result; the tracker reports A completed;
SQLite ends with one completed `WorkflowRunTerminated`; the evidence bytes can
still be read; the successful worktree and branch are not deleted without a
workflow disposition; and the harness leaves no owned temporary root, lock, or
child process after teardown.

Dalph must not use the historical implementation/reviewer/handback stages,
promote a commit that Git did not qualify, complete the tracker before
promotion, delete immutable evidence, invent terminal cleanup authority, leak
a process or lock, delete an unrelated Git resource, or infer success from
fixture-side state.

### Acceptance-test mapping

- `runs one task through real local production boundaries and tears down only its owned resources`

The test observes behavior through `runWorkflow` composed by
`productionWorkflowInterpreterLayer`, plus the public Journal, EvidenceStore,
tracker, Git, process, and filesystem boundaries. It does not test private
delivery helpers.
