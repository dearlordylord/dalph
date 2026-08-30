# First concrete executor: persistent Codex app-server threads

Status: accepted planning decision for issue 219. Runtime behavior remains
unimplemented until the focused tickets named below close.

## Selected implementation

The first concrete `PlannedAttemptExecutor` implementation launches the
user-installed Codex CLI in app-server mode. It uses the user's existing Codex
authentication, configuration, instructions, skills, MCP servers, and other
ambient harness choices. Dalph does not inject a skill, review loop, subagent
topology, model, or provider policy.

Generic Dalph still sees only one exact planned attempt and its normalized
`ExecutorWorkExecuting`, `ExecutorWorkSafelySuspended`, or terminal report.
Codex thread ids, turn ids,
JSON-RPC request ids, processes, terminal sessions, tools, and rollout files
remain private to this implementation.

The following implementation-private names make the chronology precise:

- **Codex application server** — the scoped child process through which the
  implementation starts, resumes, reads, interrupts, and observes Codex
  threads and turns.
- **Codex attempt thread** — the non-ephemeral Codex thread retained for one
  exact planned `(RunId, AttemptId)` after the implementation records their
  association.
- **Codex turn** — one task or continuation request inside that thread. A turn
  is not a Dalph attempt or workflow operation.
- **Attempt-thread association** — implementation-private durable state that
  relates one exact planned attempt to its Codex thread id. It is not a Dalph
  workflow-journal event and does not supplement the generic executor
  correlation.
- **Empty pre-turn thread allocation** — a thread returned by `thread/start`
  before any `turn/start` request has been sent for it. It contains no Dalph
  task turn and is not yet the retained attempt thread.
- **Codex server ownership observation** — the execution substrate's private
  exact `Absent`, `ExactLive`, `Unreadable`, or `Contradictory` observation for
  one recorded server-launch incarnation. It is the admission gate for a
  replacement app-server, not an executor report or workflow fact.

## Authority and retained state

Git continues to own the planned Base SHA, branch, worktree, commits, and
current worktree observations. Dalph creates or rediscovers the exact planned
worktree and proves it ready before calling the executor. The Codex
implementation receives that path as its working directory; it never creates,
selects, resets, repairs, moves, or deletes the planned worktree.

The task tracker owns the exact normalized task title and body. The executor
must receive the task-work specification whose fingerprint is bound by the
planned attempt. The current generic executor call omits those instructions;
issue 220 must repair that input before the Codex implementation begins.

Codex owns persisted conversation history. The execution substrate owns live
app-server, turn, terminal-session, and child-process observations. The
implementation owns only the exact attempt-thread association, its private
protocol state, and exact references to Codex and evidence-store state. The
Dalph Journal continues to store only the existing generic executor command,
projection, and report facts.

## Dalph starts the first Codex turn for one exact attempt

### Starting situation

No person directly triggers this automatic work. Dalph has planned exact
attempt P for task A, including A's original task-work-specification
fingerprint, Base SHA, branch, worktree, and the statically selected Codex
executor locator. Git has freshly proved that P's exact worktree is ready.
Dalph has recorded its generic `Begin` intent. No attempt-thread
association exists for P.

The application has acquired one scoped Codex application server and completed
its protocol initialization. If the executable or transport is absent or
unreachable, executor projection is `TemporarilyUnavailable` and no task turn
is sent. If a reachable app-server returns malformed or undecodable
initialization state, projection is `Unreadable`; an initialization identity or
protocol correlation conflict is `CorrelationContradiction`. None authorizes a
task turn.

### Ordered boundary calls

1. The implementation records private intent to establish P's Codex thread.
2. It calls `thread/start` with P's exact worktree as `cwd`, non-ephemeral
   history, and the ambient user configuration.
3. Codex returns a generated thread id while the thread is idle. The
   implementation durably records P's exact attempt-thread association.
4. Only after that record succeeds does the implementation send `turn/start`
   containing A's exact original task-work specification and the immutable
   planned-attempt facts needed by the task.
5. When Codex reports the turn active, the implementation returns exact
   `ExecutorWorkExecuting(P)`. Repeated passive `observe` calls while that same
   turn is active return its current projection; they do not start parallel
   turns.

### Crash and retry cuts

If Dalph or app-server dies before `thread/start` returns and before the
association is recorded, no task turn was authorized. A later instance may
create another empty thread allocation. Codex may already have loaded ambient
configuration, instructions, hooks, or MCP servers, so Dalph must not claim
that literally no user-configured startup activity occurred, reset the
worktree, or infer an outside result. The only retry claim is that no Codex
task turn crossed `turn/start`.

The same rule applies if `thread/start` returned a generated id but Dalph died
while writing the association. The implementation never sent `turn/start`, so
the unassociated thread is another empty pre-turn allocation. A later instance
may leave that unmaterialized orphan alone and establish one new associated
thread; it must not guess an association from cwd, recency, or another thread's
metadata.

If the association is recorded but no `turn/start` was sent, a later instance
first tries to read or resume that thread. A current Codex version may not
persist an empty no-turn rollout. If Codex proves the empty thread is absent,
the implementation may replace only that private empty association and create
another thread before the first turn. It does not replace P.

Once `turn/start` may have crossed the app-server boundary, the outcome is
ambiguous. Restart must read or resume the associated thread before any later
turn. Missing, unavailable, unreadable, or contradictory thread state cannot
authorize a new thread or another task turn.

### Visible and forbidden result

The maintainer sees P become executing through the existing generic executor
report. Dalph must not expose the thread id, create another attempt, send the
task before the association is durable, start two turns for P, infer completion
from an idle thread, or treat a lost `turn/start` response as proof that Codex
did nothing.

### Acceptance-test seam

- `records the Codex thread before sending the first task turn`
- `retries after thread start returns but the association write is lost without sending two task turns`
- `retries only an empty pre-turn allocation whose task turn was never sent`
- `reconciles a lost first-turn response without starting another thread or turn`
- `returns ExecutorWorkExecuting without starting a parallel turn for the same attempt`

## A later Dalph process resumes the same attempt thread

### Actor and trigger

No person triggers recovery. A later ordinary Run activation finds unfinished
P after the earlier Dalph or app-server process ended.

### Starting situation

P remains an unfinished planned-attempt executor responsibility. Its generic
workflow history and private attempt-thread association are durable. Codex has
persisted at least one turn for that non-ephemeral thread. The earlier Dalph or
app-server process is gone. Git still owns the exact planned worktree and
Dalph's ordinary Run entry has freshly read the current tracker graph, authored
specification, exact claim, and Git worktree facts. The journaled
`FocusedTaskWorkSpecificationFacts` whose fingerprint matches P's immutable
`TaskRevision` supplies the original prompt; the fresh reads remain authority
for whether current closure, claim, and Git facts permit continuation.

### Ordered boundary calls

1. The new application acquires and initializes a new Codex application-server
   process using the same selected Codex state location.
2. The implementation reads P's exact private association.
3. It calls `thread/read` or `thread/resume` with the recorded thread id and
   P's exact current planned worktree as `cwd`.
4. An active turn projects `ExecutorWorkExecuting(P)`. A persisted terminal turn is
   reconciled through the terminal scenario below. An idle interrupted thread
   remains the same resumable thread and receives a later continuation only
   after an accepted safe report and current facts authorize generic `Resume`.

If Codex is temporarily unreachable, the implementation returns the existing
normalized `TemporarilyUnavailable(P)`. If its stored history cannot be
decoded or correlated, it returns `Unreadable(P)` or a correlation
contradiction. It preserves P, the association, worktree, claim, and task-work
position and starts no replacement thread.

### Visible, forbidden, crash, and retry result

The maintainer sees P remain executing, safely suspended, terminal, or explicitly
unavailable/unreadable through the generic executor boundary. Dalph must not
replace P's materialized thread, infer a result from an idle thread, or use
fresh tracker text as the original prompt. A crash before the resume response
is ambiguous: the next activation repeats read/resume reconciliation for the
same association and sends no continuation until that state is conclusive.

### Manual activity is not a Dalph event

A user may separately inspect or alter the planned worktree or may use Codex's
own interfaces with a retained thread. Dalph does not record a human takeover,
manual turn, or manual worktree-edit event and does not promise to coordinate
unannounced concurrent activity. It preserves the thread and worktree so such
composition is possible, then relies only on later ordinary Git observations
and normalized executor projections. A manual edit or turn is never silently
converted into a Dalph command, safe-suspension proof, or terminal result.

### Acceptance-test seam

- `resumes the recorded Codex thread in the exact planned worktree whose registration Git proved after process loss`
- `maps missing unavailable unreadable and foreign Codex state to the normalized fail-closed projections`
- `starts no replacement thread when a task turn may already have run`
- `does not encode or infer manual worktree or Codex activity as a Dalph event`

## Dalph safely suspends and later resumes Codex work

### Starting situation and trigger

P has an associated thread and an active Codex turn. Alice applies a Task Pause
or Run Pause, or the application Exit protocol asks the executor to suspend P.
Dalph records its existing generic `Suspend(P)` intent before calling the
executor.

Alice is the affected person for Task Pause or Run Pause. For application Exit
there is no separate person at this boundary because the already-accepted Exit
protocol supplies the suspension request.

### Ordered boundary calls

1. The implementation sends `turn/interrupt` for P's exact active turn.
2. It waits for Codex to report that turn interrupted, Accepted, or Failed.
   An Accepted or Failed terminal turn enters the terminal-result chronology
   below and returns that exact terminal report; it is never downgraded to safe
   suspension.
3. It observes every app-server terminal session, tool execution, subprocess,
   and other implementation-owned activity that could still change P's
   worktree. It stops or waits for those activities according to the accepted
   bounded executor policy.
4. Only after the execution substrate proves that no owned activity for P
   remains running, and the associated thread remains resumable, does the
   implementation return `SafelySuspended(P)`.
5. A later generic `Resume(P)`, authorized by an accepted safe report and exact
   current selection facts, resumes the same associated thread and
   sends a continuation turn in the same exact planned worktree.

`turn/interrupt`, app-server process exit, a missing child process, or an idle
thread alone does not prove safe suspension. If the implementation cannot
complete its activity census or stop owned work, it returns `ExecutorWorkExecuting` or a
normalized unavailable/unreadable outcome and Dalph retains P's task-work
position.

### Visible, forbidden, crash, and retry result

Alice sees P become safely suspended, remain executing or uncertain, or finish
with its exact terminal result. Dalph must not report safe suspension while any
Codex-owned activity can still change the worktree, replace the thread, or
downgrade a terminal result observed during interruption. If Dalph dies after
the interrupt may have been delivered, the next activation resumes the same
thread and freshly rereads the turn and owned-process census before reporting
or retrying; it never sends a second interrupt merely because the first reply
was lost.

### Acceptance-test seam

- `reports safe suspension only after the interrupted turn and every owned activity stop`
- `keeps capacity while a background terminal or unreadable process observation remains`
- `resumes the same Codex thread and planned worktree after safe suspension`
- `does not equate app-server death or turn interruption with safe suspension`

## Codex returns one terminal result

### Actor and trigger

No person directly triggers this boundary. Codex finishes the active task turn
for P while Dalph is observing its exact associated thread.

### Starting situation and ordered boundary calls

P's associated Codex turn reaches a terminal app-server status. The
implementation first proves that no implementation-owned activity can still
change P's worktree.

For the MVP implementation:

- a conclusively unsuccessful Codex turn may become `Terminal(Failed)` only
  after that terminal seal;
- a successful task result becomes `Terminal(Accepted)` only after Git reports
  the exact result commit from P's worktree and the evidence store accepts and
  rereads P's exact content-addressed accepted-result evidence manifest; and
- the implementation does not emit `Terminal(Completed)`. That generic variant
  remains available to other implementations but has no selected Codex meaning
  in this specification.

The accepted-result manifest proves only that P accepted that exact commit. It
does not imply review and does not replace later result-commit qualification,
the outer Integrator, Git qualification of its reported candidate, promotion,
or tracker completion.

If Codex's final message is missing, malformed, contradictory, names a foreign
attempt, or claims a commit Git cannot establish, the implementation cannot
emit Accepted. It returns a typed private failure or an unreadable normalized
projection according to whether the outcome is conclusive; it preserves the
worktree and thread.

### Visible, forbidden, crash, and retry result

The maintainer sees exact Failed or Accepted through the generic executor
report. Dalph must not emit Completed, infer Accepted from prose, treat a
foreign commit as P's result, or release capacity before terminal sealing. If
the process dies after Codex reports terminal but before the generic report is
recorded, recovery rereads the same thread, Git commit, and content-addressed
manifest and records the same result; it does not run another task turn.

### Acceptance-test seam

- `returns Failed only after no Codex-owned activity can change the attempt`
- `returns Accepted only with the exact Git commit and reread accepted-result evidence manifest`
- `rejects a final message that names missing foreign or contradictory Git evidence`
- `never emits Completed from the selected Codex implementation`

## Application startup, graceful Exit, and process death

### Actor and trigger

Alice triggers graceful Exit through the existing application boundary; an
operating-system or process failure may instead end Dalph unexpectedly. Normal
application startup triggers ownership reconciliation before any Codex attempt
is admitted.

The Codex application server is one application-scoped resource. Application
startup acquires and initializes it before Codex executor work can be admitted.
All attempt threads remain distinct private resources beneath that process.

On graceful Exit, the existing application-lifecycle protocol first closes
forward-progress admission. It asks the executor to suspend exact running
attempts through the ordinary generic boundary. The app-server resource closes
only after every admitted executor owner has returned an exact safe or terminal
report, or after the existing five-second application drain selects forced
nonzero termination. Closing the app-server must not fabricate safe suspension
or a terminal report.

The scoped finalizer closes the app-server transport, waits for the direct
child, and accounts for implementation-owned descendants. A normal application
stop leaves non-ephemeral thread history available for later resume and does
not archive or delete attempt threads.

A sudden Dalph process death records no application or Run event. Before
launching app-server, Dalph durably records one private server-launch
incarnation and ownership intent; it does not persist the execution substrate's
process observation as authority. If Dalph dies but that stdio app-server or
one of its descendants survives, the next startup cannot reconnect to the lost
stdio transport. It reads the private launch record, asks the execution
substrate for a fresh `Absent | ExactLive | Unreadable | Contradictory`
ownership projection, and validates the exact process incarnation rather than
trusting a reused PID. For `ExactLive`, it requests that old owned process group
to stop and waits until a fresh observation reports `Absent`. Only then may it
launch the new application-scoped app-server and resume the recorded attempt
threads. If the old incarnation is unreadable or cannot be stopped, Codex
executor admission remains unavailable. A contradictory observation fails
application startup closed and preserves the launch record for diagnosis; it
cannot be treated as the old process being absent.

If the old app-server already died after losing its parent transport, the same
read proves it absent and permits one new process. Neither result is an
executor safe or terminal report. Dalph must not run two app-server owners
against the same private store or attempt association. The application-server
acquisition cannot register its new owner until the ownership observation is
`Absent` after any exact old-owner disposal.

### Visible and forbidden result

Alice receives the existing shared application Exit result. A successful Exit
means exact executor attempts were safe or terminal before app-server closure;
forced nonzero termination makes no invented executor claim. On later startup,
the maintainer sees Codex admission remain closed until the old launch is
freshly proved absent. Dalph must not retain two app-server owners, trust a
persisted process snapshot, reconnect a lost stdio transport, reset a planned
worktree, or convert process death into a Run event.

### Acceptance-test seam

- `acquires one scoped app-server before admitting Codex executor work`
- `graceful Exit suspends exact attempts before closing app-server and preserves their threads`
- `forced Exit makes no safe or terminal executor claim for unresolved Codex work`
- `startup reconciles a surviving or dead prior app-server before admitting another owner`
- `after Dalph-only death stops the exact surviving stdio app-server before launching its replacement`
- `keeps Codex admission unavailable when prior process ownership is unreadable`
- `normal stop and restart resume the same non-ephemeral thread history`

## Scenario-to-ticket map

| Required behavior | Owning ticket |
| --- | --- |
| Supply the exact tracker-authored task specification bound to P through the generic executor request | #220 |
| Implement persistent Codex app-server process, attempt-thread association, turns, projections, suspension, terminal sealing, and accepted evidence | rewritten #58 |
| Qualify the real Codex CLI's process/session persistence, crash cuts, background-activity census, suspension, and cleanup on supported hosts | rewritten #75 |

## Scenario-to-test map

| Chronology | Production/conformance test owned by #58 | Real built-fixture qualification owned by #75 |
| --- | --- | --- |
| First thread and turn | Association is durable before `turn/start`; missing/unavailable/unreadable/contradictory initialization is fail-closed | Linux and macOS start a real built app-server against a deterministic local model endpoint and observe one materialized thread |
| `thread/start` returned but association write was lost | No task turn was sent; only the empty allocation is replaceable | Each supported host kills the process at the post-start/pre-association cut and proves no task turn or worktree change |
| Association durable before first turn | Restart resumes or replaces only a conclusively absent empty thread | Each supported host kills at the post-association/pre-turn cut and resumes the recorded identity without task duplication |
| First or later `turn/start` response lost | Reconciliation rereads the same associated thread and sends no parallel turn | Each supported host kills after task-turn admission and proves the same thread and worktree resume |
| Pause or Exit interrupts active work | Exact terminal wins; otherwise safe suspension waits for the complete owned-activity census | Each supported host exercises active turn, background child, terminal-during-interrupt, and unreadable-census fixtures |
| Failed or Accepted terminal result | Terminal seal; Accepted exact commit plus reread content-addressed manifest; no Completed | Each supported host obtains deterministic Failed and Accepted results without real OpenAI credentials |
| Graceful Exit | Admission closes, exact attempts suspend or finish, then app-server and descendants close | Each supported host proves real process cleanup and the existing fixed Exit result and deadline |
| Dalph-only process death | Fresh ownership projection disposes `ExactLive`, admits on `Absent`, and fails closed on unreadable/contradictory state | Each supported host kills Dalph at server launch, initialization, active turn, interruption, and terminal-result cuts and proves no second owner |

The #75 fixture uses the built Codex CLI/app-server protocol with an isolated
Codex state directory, a real temporary Git repository and registered planned
worktree, and a deterministic local fake model endpoint. It does not contact
OpenAI or require production credentials. Linux and macOS run the same named
matrix; host-specific process-group observations may differ, but the visible
executor and application outcomes may not.

Issue 58's historical review loop is not selected. Its old implementation is
research evidence only; #58 is rewritten around the actual simple Codex
implementation. No fresh reviewer session, findings handback, or semantic
review round belongs to the MVP.

## Out of scope

- A review loop, mandatory subagent, prescribed skill, or Dalph-controlled
  Codex harness.
- A dynamic executor registry, plugin loader, or user-authored executor
  pipeline.
- Encoding human worktree edits, manual Codex turns, or a human/automation
  handoff in Dalph's workflow history.
- Choosing a model, model provider, approval policy, sandbox profile, MCP
  server set, or user Codex configuration.
- Treating the Codex thread id as another generic executor identity.
- Remote WebSocket deployment or a Dalph user interface for Codex history.
- Deleting, archiving, forking, or replacing a materialized attempt thread.
  Explicit replacement of one purged owned turn inside that retained thread is
  separately governed by
  [issue #111](issue-111-replace-purged-codex-work-unit.md).
- Changing accepted-result integration, Integrator, promotion, or
  task completion semantics.
