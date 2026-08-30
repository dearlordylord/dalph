# Reactivate incomplete Runs from non-authoritative hints

Issue: [#218](https://github.com/dearlordylord/dalph/issues/218)

Status: accepted implementation scenario. These chronologies describe the
application-level process-local owner that keeps one exact unterminated Run
eligible for another ordinary establishment and activation. A hint is a
request to check current facts; it is never evidence that work exists.

The task tracker owns task identity, lifecycle, dependencies, grouping, and
claims. Git owns refs, worktrees, and lineage. The executor owns session and
process observations. The Run Journal owns only accepted workflow history.
The reactivation owner persists none of its wake, timer, frontier, or UI
state; its queue, fibers, cooldown, and one-owner registration disappear on
application exit or process loss. The supported production entry is the
scoped `productionRunReactivationLayer` composition. The configured CLI host
entry is `makeConfiguredProductionCliApplication`, which invokes a host-owned
production callback for `dalph run <target>`; `bin/dalph.ts` still installs
only the documented dry-run host. The accepted-fact publication boundary is
wired through the reactive delivery publication observer. `TrackerGraphReader`
currently exposes reads but no provider notification stream, so the bounded
timer remains the honest tracker-notification recovery adapter rather than an
invented live source.

## A lost tracker notification is recovered by the bounded timer

### Starting situation

No person directly triggers this chronology. Dalph has already established
exact Run R for tracker target T and one bounded activation has returned
`RunMustRemainActive`. The Journal contains R's valid beginning and all
accepted facts from that activation, but no termination. Its process-local
activation owner and any delivery positions have been released. The task
tracker's last complete read says no currently legal work exists; Git,
executor, and worktree boundaries are idle because no accepted proposal
selected them. The reactivation owner is attached to R and has not stored a
wake row or derived frontier.

### Outside event, trigger, and ordered boundary calls

The task tracker changes T so that a task becomes legal, but the tracker
notification is dropped before Dalph receives it. The application-level
timer reaches its configured bounded interval. The owner first checks that R
is still unterminated and not paused or exiting, then invokes the same public
Run establishment boundary for `(R, T)` used for a first call. Establishment
reads R's Journal history and reconstructs the accepted policy and authority
facts; activation then performs ordinary current tracker reads and any Git or
executor calls selected by those fresh facts. The timer and the tracker do
not authorize work directly.

If Dalph crashes before the timer fires, only process-local timer and owner
state disappear. If it crashes after a Journal read or an external read, the
next application starts with the same ordinary establishment/reconciliation
rules; no timer outcome is durable. A timer wake arriving while an activation
is already running is retained as at most one trailing current check.

The maintainer sees the newly legal work eventually considered, or the
ordinary typed failure/unfinished result. Dalph must not leave changed T
dormant while polling is configured, start a second Run, reuse an old
observation, or infer work from the missing notification.

### Acceptance-test mapping

- `rechecks after a lost notification when TestClock fires, with no Run read
  per timer` proves the timer recovery and that the timer
  consults the local projection rather than polling the Run Journal.
- `uses current-first control state: paused restart is passive and accepted
  Unpause activates once` proves a restart observes a durable Pause before the
  first timer and that an accepted Unpause requests one fresh activation.
- `production composition wires current-first tracker notifications and fresh checks`
  proves the supported production Layer wires one exact Run owner and that an
  injected current-first tracker notification, timer tick, and accepted-fact
  publication each cause an ordinary fresh check.
- `routes the configured production CLI command into its host-owned application
  boundary` proves the exact configured CLI command composes the production
  Layer and reaches its startup activation; the repository binary remains
  dry-run-only by configuration.

## Several hints produce one activation and one optional trailing check

### Starting situation

No person is required for the tracker notification or accepted-fact
publication. Operator Alice may also press Wake for exact Run R. R is
unterminated and not paused or exiting; its last activation has returned
`RunMustRemainActive`. The Journal is the accepted source for R's history and
the task tracker and Git remain the sources for current facts. There is no
second tracker lifecycle and no durable wake/frontier/UI record.

### Trigger and ordered boundary calls

The tracker notification, accepted-fact publication, and Alice's Wake arrive
close together. Each calls the owner's hint boundary with a different
non-authoritative hint kind. The owner atomically coalesces them. If no
activation is live, it invokes fresh Run establishment and activation once and
keeps that fiber as the one process-local owner for R. If an activation is
live, it offers at most one coalesced refresh opportunity to that activation's
bridge: the existing tracker-observation coordinator serializes the read, the
existing graph traversal performs it, and normalized facts enter the existing
graph relation. This is not a second activation and this owner does not
implement the tracker-read protocol. If the activation cannot accept the
opportunity or finishes during handoff, the owner retains at most one trailing
establishment/activation. Duplicate hints after that marker is consumed form
the next coalesced request.

If Alice sends Wake while the application Exit cutoff is closed, the owner
does not acquire a new forward-progress owner. If Alice Pauses R, the owner
finishes only the already admitted activation boundary, suppresses timer and
hint-driven Run-specific polling, and resumes fresh checks only after an
accepted Unpause and ordinary current reads. If the Run terminates, the owner
marks it closed and discards later hints.

The maintainer sees one activation's ordinary result and, when a hint raced
with it, at most one later current check. Dalph must not perform one
activation per hint, run concurrent Journal establishment, let a hint
authorize work, continue polling while paused, or reactivate a terminated Run.

### Acceptance-test mapping

- `coalesces concurrent hints behind one activation` proves the
  tracker/publication/Operator hints coalesce and never overlap.
- `routes a hint into one serialized refresh while the activation remains live`
  proves the in-activation bridge uses the existing read stack and starts no
  second activation.
- `publishes an accepted delivery fact through the bootstrap's attached Run
  observer` proves the repository's accepted-fact publication adapter invokes
  the attached owner hint after the runtime publication boundary.
- `replays durable Pause between observer attachment and the mandatory current
  read` proves a Pause accepted at the attach/read race is current before
  Startup or timer scheduling.
- `stops the Run-specific timer on accepted Pause and starts one fresh timer on
  Unpause` proves Pause schedules no Run-specific timer and Unpause schedules
  exactly one new timer.
- `uses current-first control state: paused restart is passive and accepted
  Unpause activates once` proves accepted Pause/Unpause behavior without a
  local pause command.
- `keeps one owner per exact Run composition and lets Exit stop after the
  active boundary` proves one scoped owner, race-safe Exit shutdown, and that
  a retained late Pause/Unpause callback cannot restart its timer.
- `registers its drain before Exit can pass a blocking tracker-source
  attachment` proves the application cutoff cannot miss a partially starting
  owner or allow that owner to schedule work after Exit succeeds.
- `treats terminated history as closure and never schedules a fresh
  activation` proves that already-terminated history is not endlessly
  observed as a retryable failure.

## Alice edits instructions while executor work remains active

### Starting situation, trigger, and ordered boundary calls

Alice maintains Task B. B's exact planned attempt is autonomously executing
from fingerprint F1 and holds one task-work position. One activation of Run R
is live. Alice edits B's title or body, so the tracker derives F2.

The tracker notification, or the configured bounded timer if that notification
is lost, gives this owner one non-authoritative refresh opportunity. The owner
coalesces it and uses the live activation bridge. The existing tracker-read
stack records and performs one complete refresh; linked focused reads for the
bounded active-attempt set prove whether any authored fingerprint changed.
Only B's focused F2 result selects the existing exact suspension protocol.
Executor reports prove executor state and may use the generic publication hint
stream as a latency optimization, but they neither trigger the graph read nor
define its coverage.

If the refresh is incomplete, contradictory, failed, or unreadable, Dalph
exposes the typed result, starts no work from it, and does not suspend healthy
executing B from uncertainty. A later independent notification or timer reads
freshly after the existing cooldown. The explicit cost is that obsolete work
may continue until a later successful ordinary refresh.

Pause suppresses later Run polling and refresh opportunities under its existing
contract. Exit admits no new owner; an already-admitted interruptible tracker
boundary follows the existing cutoff and ambiguity rules.

### Visible and forbidden result

Alice eventually sees B safely suspended with F1/F2 preserved, or sees the
typed refresh failure while B continues. Dalph must not start a second
activation, create one poller per executor, derive freshness from report
frequency, hot-loop a failed read, or replace the later post-quiescence read.

### Acceptance-test mapping

- `coalesces notification timer and publication without a second activation`
- `does not make executor reports graph authority`
- `failed live refresh neither starts nor suspends work`
- `suspends only the exact active attempt whose focused fingerprint changed`

## A transient tracker or Git read failure backs off without a hot loop

### Starting situation

No person directly triggers the timer case; Alice can send a Wake for the
Operator case. R has one valid beginning and no termination. The previous
activation released its process-local owner. A current tracker or Git read
may fail with a typed provider error; no outside mutation has been requested,
so Git refs, worktrees, task claims, executor sessions, and Journal facts are
unchanged.

### Trigger and ordered boundary calls

The owner receives a hint or a bounded timer tick. It invokes fresh Run
establishment and activation. The first tracker/Git boundary returns a typed
failure. The owner reports that failure through its required typed observation
seam and waits on one explicit finite cooldown. The failure itself never
authorizes replay; a later timer tick or hint starts a fresh
establishment/activation and therefore rereads Journal, tracker, and Git as
required by ordinary activation. Successful current facts can then select
work; a terminal proof can close R.

If the process crashes before the cooldown elapses, the failed observation and
the process-local cooldown disappear; a later start performs the normal fresh
read. If it crashes after a boundary has returned but before the owner records
its result, the owning tracker/Git protocol's existing intent/reconciliation
rules decide whether a read may be retried. Executor calls do not apply unless
fresh accepted facts select an executor responsibility.

The maintainer sees a bounded typed failure or later progress, never an
unbounded retry storm. Dalph must not reuse a failed snapshot, replay without
a later hint/timer check, append a durable wake/frontier row, or terminate R
just because a read failed.

### Acceptance-test mapping

- `observes one typed activation failure, cools down, and waits for a later
  hint` proves fresh tracker/Git reads after each later hint, no whole-
  activation retry, and no mutation replay.
- `stops on an activation-observed terminated Run instead of cooling down for
  replay` proves an already-terminated activation result closes the owner and
  stops its timer rather than entering cooldown.
- `stops its timer when activation returns RunMayTerminate` proves the normal
  finality decision closes the process-local owner without a later timer turn.

## A normal finality result stops or retains the exact Run

### Starting situation and trigger

No person is needed for a timer or accepted publication; Alice may send Wake
while R is active. R has one exact Journal beginning and an unterminated
history. The owner invokes the ordinary establishment/activation boundary,
which reconstructs Journal and authority facts before current tracker, Git,
or executor decisions. No process-local state from a prior activation is
treated as durable authority.

### Ordered result, crash, and visible outcome

If activation returns `RunMustRemainActive`, the owner keeps R registered and
allows the bounded timer/hints to request another fresh activation. If it
returns `RunMayTerminate`, the existing bootstrap termination protocol owns
the accepted termination append; the reactivation owner closes R and ignores
later hints. A process crash before either result leaves no durable wake state;
the next ordinary entry reads the Journal and reconciles any accepted
intent. A crash after termination is observed returns the existing typed
terminated result on a later entry and starts no activation.

Alice or the maintainer sees either continued bounded progress, a typed wait,
or a closed Run. Dalph must not persist a derived frontier, release or reopen
an external claim from an in-memory hint, append a second beginning or
termination, or use a notification as proof of legal work.

### Acceptance-test mapping

- `rechecks after a lost notification when TestClock fires, with no Run read
  per timer` proves the retained active branch, while
  `treats terminated history as closure and never schedules a fresh
  activation` proves the terminal branch.
- `production composition wires current-first tracker notifications and fresh checks`
  proves the application path installs the same ordinary
  establishment/activation owner. The integration scenario
  `publishes each accepted executor report before continuing and stops after
  Terminal` uses the actual `TrackerGraphReader`, Journal, and Git target
  lineage boundaries across two ordinary activations: it asserts a fresh
  tracker read after the first typed Git read failure and the later ref update,
  and observes the corresponding accepted Git lineage fact.

## Authority and ownership boundaries

| Concern | Owner | Reactivation treatment | Acceptance seam |
|---|---|---|---|
| Run history and termination | Run Journal/bootstrap | Fresh establishment reads accepted facts; only bootstrap may terminate | active/terminal finality tests |
| Task identity and current legality | Task tracker | An injected current-first notification adapter or bounded timer requests a new ordinary read; notification never proves work | lost-notification, production composition, and transient-read tests |
| Git refs/worktrees/lineage | Git boundary | Fresh activation chooses Git reads only from accepted facts | transient-read and production composition tests |
| Executor session/process state | Executor boundary | No executor call on a hint alone; existing executor protocol decides any selected work | production/Run integration tests |
| Wake/timer/duplicate markers | Process-local reactivation owner | Queue, refs, fibers, and cooldown are never journaled or reused after process loss | coalescing/Exit/Pause tests |
| Operator control and application Exit | Operator/application lifecycle | Pause suppresses polling; Exit closes admission and stops later wakes | Pause and Exit tests |

Aggregate typecheck, coverage, or model totals cannot replace this
scenario-to-test mapping; handoff must report each named seam separately.
