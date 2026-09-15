# Release a dependant from fresh tracker success and audit exact owned resources

Issue: [Prove tracker release and exact cleanup](https://github.com/dearlordylord/dalph/issues/89)

Status: accepted by the owner on 2026-08-24 for the reliable-code and working-MVP frontier.

This scenario refreshes the stale ticket language. Accepted-result evidence is
immutable and successful attempt work remains inspectable. Neither is
“disposable evidence,” and successful resources do not acquire a cleanup
disposition merely because a Run terminates.

## A maintainer observes dependency release and the terminal resource ledger

### Starting situation

A maintainer runs the hermetic local journey with tasks A and B both ready and
D depending on both. The fixture owns one temporary root containing a source
repository, bare target repository, SQLite journal, filesystem evidence store,
and one exact worktree and task branch per attempt. It also owns one coordinator
lock, one child process per executor attempt, and one temporary transfer ref per
accepted commit. No live provider account is used.

A and B have each returned an accepted commit. Git promotion alone has not
changed their tracker lifecycle, so D is still blocked.

### Trigger and chronological behavior

1. Dalph promotes A, then asks the tracker to complete A under A's exact
   completion claim. A later tracker read reports A successful while B remains
   open. D remains blocked.
2. Dalph promotes and completes B under B's exact completion claim. Only a
   later complete tracker graph reports both A and B successful. The journal
   records that graph before Dalph starts D's executor or Integrator work.
3. Dalph completes D and deletes each exact completion claim. The SQLite
   journal ends with one completed Run termination.
4. Before fixture teardown, the audit reads every immutable accepted-result
   evidence object and verifies every successful task worktree and branch.
   Those resources remain because no superseded, quarantined, or abandoned
   cleanup disposition authorizes their removal. Every temporary transfer ref
   is absent, every child process has exited, and another coordinator can take
   the exact repository lock.
5. The test harness, which owns the temporary fixture rather than workflow
   cleanup authority, removes its one exact root. Its repository, target,
   worktrees, branches, SQLite file, evidence files, and other fixture files
   then disappear together. This harness teardown creates no workflow cleanup
   journal event.

Separately, the production cleanup qualification exercises a genuinely
superseded worktree and branch. It deletes only locators carried by a typed
cleanup authorization and preserves unrelated or unreadable Git facts.

There is no new crash or retry decision in this scenario. The post-promotion
crash and reconcile-before-retry chronology is owned by #88. The cleanup
protocol's lost-response retry is already qualified by its production SQLite
tests; this terminal audit only reads the resulting state and performs
harness-owned teardown.

### Visible result and forbidden result

The maintainer sees D start only after a fresh tracker graph proves A and B
successful, one completed Run, no live owned process or lock, no temporary
transfer ref, inspectable successful work and evidence before teardown, and no
fixture root afterward.

Dalph must not release D from Git promotion or an executor report, delete
successful attempt work or immutable evidence as terminal cleanup, delete an
unrelated ref, retry an ambiguous cleanup mutation without rereading its owning
authority, or infer that an absent fixture root proves an exited process or
released lock without checking those boundaries first.

### Acceptance-test mapping

- `runs two ready tasks concurrently, serializes same-target integration, and
  waits for a later complete graph before starting their dependant` proves the
  fresh tracker-release order, exact claims, preserved successful artifacts,
  absent transfer refs, exited processes, released lock, terminal SQLite
  history, and final exact-root census.
- `runs one task through real local production boundaries and tears down only
  its owned resources` proves the same terminal ledger for the smallest
  no-crash MVP journey.
- `restarts after Git promotes A without returning and does not repeat A
  integration or promotion` proves that the ledger remains correct after the
  #88 crash cut.
- `production Git cleanup removes only the authorized worktree and branch and
  leaves an unrelated task intact` and the production SQLite lost-response
  cleanup tests prove exact disposition authorization and
  reconcile-before-retry for resources that really are cleanup-eligible.
