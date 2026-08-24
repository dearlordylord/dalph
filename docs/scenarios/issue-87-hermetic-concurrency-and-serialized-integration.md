# Two ready tasks overlap while one target integrates in journal order

Issue: [Prove concurrency, serialized integration, and handback](https://github.com/dearlordylord/dalph/issues/87)

Status: accepted by the owner on 2026-08-24 after freshness review for the
reliable-code and working-MVP frontier.

This scenario qualifies the current outer-Integrator composition through the
public `runWorkflow` seam. “Handback” is historical issue wording: Dalph does
not expose an implementation, reviewer, or handback stage. The opaque
Integrator call is the only integration boundary; its returned candidate is
qualified by Git and then promoted by the target-ref compare-and-set protocol.

## A maintainer runs two ready tasks and observes a dependant wait for both

### Starting situation

The test harness owns one exact temporary root containing a source repository,
a bare target repository, a SQLite workflow journal, a filesystem evidence
store, and the coordinator's Git common directory. The source and target
`master` refs point to the same base commit H0. The deterministic tracker
reports open tasks A and B with no prerequisites and an open task D whose
prerequisites are A and B. No task has a claim, worktree, branch, accepted
result, integration responsibility, Integrator session, candidate, target
promotion, or completion claim. No child process or coordinator lock exists
before the application scope starts.

The maintainer starts one production-shaped `runWorkflow` activation with task
capacity two. No person directly triggers an individual task. Dalph's
coordinator reads the complete graph and chooses A and B; D is not eligible
because both prerequisites are unfinished.

### Trigger and chronological behavior

1. Dalph records one Run beginning and the complete tracker observations that
   establish A and B as ready and D as blocked. It creates the exact active
   claims, plans A and B against H0, and creates their exact Git worktrees and
   branches. The two task-work positions are distinct and both are admitted.
2. Dalph starts one real child process for A and one for B through the opaque
   planned-attempt executor boundary. Each child writes its result, commits it,
   and remains held at a deterministic barrier until the other child has also
   reached the barrier. The test observes both children alive at the same time,
   then releases them. Each accepted terminal result stores immutable evidence
   and is recorded in SQLite before its exact accepted-result responsibility.
   A's result and responsibility are recorded before B's result and
   responsibility even though B's child finishes first and B's persisted task
   identity sorts first. The responsibility journal position—not task name,
   completion time, or enumeration order—is the same-target integration order.
   This preserves issue #56's accepted per-result chronology; it does not invent
   a batch-drain barrier across otherwise independent executor reports.
3. After both accepted reports and responsibilities are durable, Dalph reads
   current tracker facts. It uses the responsibilities themselves as the queue,
   without another queue store. It admits A first, acquires the one target
   resource, and invokes the opaque outer
   Integrator once for A. While A's Integrator call is held at a barrier, B
   remains queued and no second same-target Integrator call is active. After A
   returns its candidate, Dalph records the exact session and candidate facts,
   asks Git to prove that the candidate is a commit with direct parents
   `[H0, A-accepted-commit]`, and promotes it only if the target still points at
   H0. The promotion compare-and-set occurs once. A's target resource is then
   released.
4. Dalph admits B next, invokes the outer Integrator once for B, and never
   overlaps it with A's call. Git qualifies B's candidate with direct parents
   `[A-promoted-head, B-accepted-commit]`, and one compare-and-set promotes B.
   A and B's integration sessions, candidate parents, and promotion attempts
   remain tied to their exact planned attempts and expected target heads.
5. After A's first focused completion and a complete graph observation that
   still reports B unfinished, D remains blocked. Dalph does not start D merely
   because A is promoted or because the first complete graph was later in the
   journal. It performs no focused read that can substitute for the required
   later complete graph.
6. After B's promotion and focused completion, a later complete tracker graph
   reports both A and B successfully completed. Only then does Dalph admit D,
   start D's child, record its accepted result, and finish the ordinary
   completion path. The final target head contains the expected D result, the
   tracker reports A, B, and D completed, the journal retains A then B then D
   responsibility order and exactly one completed Run termination, and the
   immutable evidence for all accepted results remains readable.
7. The fixture closes the application scope, verifies that every child process
   and the coordinator lock are gone, and removes only the exact temporary root
   it owns. Successful task worktrees and branches are not deleted here because
   no terminal workflow-disposition occurrence authorizes that cleanup; issue
   #89 owns the terminal resource disposition.

There is no crash or ambiguous mutation in this scenario. Issue #88 owns crash
cuts and reconciliation for the same two-task fixture. There is no provider
retry: the deterministic tracker and executor are local controlled boundaries,
and the real Git calls are exercised once with deterministic local repositories.

### Visible result and forbidden result

The maintainer sees A and B executing concurrently, one same-target outer
Integrator call at a time in A-then-B journal order, D waiting until a later
complete graph confirms both prerequisites, and a final working target with
all three results. SQLite, Git, the tracker, evidence store, process table, and
coordinator lock provide the final observations described above.

Dalph must not start only one of A or B, count the serialized integration
resource against the two task-work positions, invoke two same-target Integrator
calls concurrently, reorder A and B by task name or child completion timing,
qualify or promote a candidate with the wrong direct parents, complete D after
only A succeeds, infer the later graph from a focused completion read, duplicate
an Integrator session or promotion, delete immutable evidence, leak a child or
lock, or delete a resource outside the owned temporary root.

### Acceptance-test mapping

- `runs two ready tasks concurrently, serializes same-target integration, and
  waits for a later complete graph before starting their dependant` exercises
  the public `runWorkflow` composed by `productionWorkflowInterpreterLayer`.
  It observes child overlap, SQLite responsibility FIFO, one active
  same-target Integrator call, exact session/candidate parent facts, Git
  promotion, the focused-completion blocker, the later complete-graph release,
  final tracker/Git/journal/evidence/process/lock/root state, and the deliberate
  #89 cleanup deferral.
- Existing `acceptedResultIntegration` and `integrationFinality` conformance
  suites remain the protocol-level evidence for the exact candidate and
  completion boundaries; this scenario adds their real production-shaped
  composition rather than changing their Quint model.
