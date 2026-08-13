# Control-plane latency and responsiveness budgets

This page owns Dalph's control-plane timing vocabulary and policy. It is a
budget map, not a benchmark, service-level agreement, or promise of hard
real-time behavior. A duration below is meaningful only at the boundary that
owns it. Local computation is measured separately from tracker, Git, and
execution-substrate latency.

The chronology and acceptance mapping are in
[issue-104-control-plane-latency-and-responsiveness.md](../scenarios/issue-104-control-plane-latency-and-responsiveness.md).

## How to read a budget

Each boundary chooses one of five policies:

- **Target** — an engineering objective to measure and review; it does not
  reject work when exceeded.
- **Hard timeout** — a local lifecycle deadline after which Dalph reports a
  typed timeout or forced termination. It is not evidence that an outside
  system stopped.
- **Retry/backoff** — a bounded number of attempts, with any wait and
  reconciliation rule named by the owning protocol. A retry is never allowed
  to turn an ambiguous effect into an assumed failure.
- **Observation/cancellation bound** — a bound on Dalph's local observation or
  cancellation work. It does not bound the time an outside authority takes to
  respond.
- **Metrics only** — record the elapsed interval for diagnosis and capacity
  planning, but make no operator-visible promise and apply no timeout.

The word “fresh” means that the owning authority was read through the named
logical operation and its required coverage. It does not mean “younger than N
seconds” unless a future accepted boundary explicitly adds that contract.

## Budget table

| Phenomenon | Owning boundary and concrete fact | Policy | V1 value or bound | What this does not mean |
|---|---|---|---|---|
| Tracker snapshot freshness | The task tracker returns one complete normalized graph observation with the required coverage, completeness, consistency, and operation identity. | Metrics only for elapsed age; fresh-read requirement for decisions. | No wall-clock freshness TTL. A decision that requires current facts performs a new complete logical read. GitHub page/task limits remain `10` pages and `1,000` distinct tasks per bounded snapshot. | A cached graph is not current merely because it is younger than a guessed number of seconds; a slow GitHub response is not a local timeout. |
| Local DAG validation and frontier derivation | Dalph validates the already-received graph and derives graph-only eligibility/frontier values without calling GitHub, Git, the executor, or the Journal. | Metrics only. | No numeric latency SLA and no hard timeout. Measure local compute separately from the tracker read that supplied the graph. | Local computation does not authorize a remote mutation, and a measurement target does not reject a valid graph. |
| Claim and mutation admission | Dalph records the exact intent, checks local coordinator ownership, then asks the task tracker or Git to mutate; after uncertainty it rereads the owning system. | Retry/backoff at the owning protocol; local admission is an observation/cancellation bound. | Claim acquisition makes at most `3` complete observation/request attempts and uses no time-based backoff. Other mutations use their own declared attempt bound; no generic remote wall-clock timeout exists. One synchronous ownership check occurs before each mutation. | Three attempts do not promise three quick responses, and a lost response does not authorize an unexamined fourth request. |
| Execution start and stop observation | The execution substrate reports `Running`, `SafelySuspended`, or a terminal result for the exact `(RunId, AttemptId)`. | Observation/cancellation bound plus bounded command retries; remote execution latency is metrics only. | Start/continue and suspension each use the existing positive command limits (`3` by default). Only an exact safe/terminal report releases task-work capacity. No wall-clock timeout converts a missing report into quiescence. | A process timeout, missing session, or foreign report is not safe suspension and does not release a position. |
| Coordinator ownership contradiction | Dalph compares the held descriptor with the canonical Git common directory before each mutation and observes the same local filesystem identity in the background. | Observation/cancellation bound. | One synchronous comparison per state-changing mutation. While held, the next background comparison starts `1 second` after the previous comparison completes. A contradiction interrupts the affected mutation immediately and rejects later mutations. | This is local-host filesystem exclusion, not a remote lease TTL, distributed fencing interval, or network-filesystem guarantee. |
| Cancellation and application drain | The application lifecycle closes forward-progress admission, brings already-admitted local work to its accepted safe boundary, flushes produced Journal writes, and releases local resources. | Hard timeout. | One fixed `5 second` drain from the first Exit admission cutoff. Later Exit requests join the original deadline. At the limit Dalph reports typed timeout and requests forced nonzero process termination. | Five seconds does not bound an executor session, GitHub call, Git operation, verification process, Run stabilization, or durable cleanup. |
| Recovery and reconciliation | After a crash, lost response, or contradiction, the protocol reads the tracker, Git, executor, or Journal authority needed for the exact unfinished intent before retrying. | Retry/backoff at each named protocol; metrics only for wall-clock elapsed recovery. | No global recovery deadline. Existing bounds remain boundary-specific: tracker pages/tasks, claim attempts, executor commands, and each integration/completion request limit. | Recovery is not made responsive by dropping the exact identity, skipping the reread, or treating elapsed time as an authority observation. |

## Local versus outside latency

The following intervals are deliberately kept separate in traces and
diagnostics:

1. local Journal append, schema decode, DAG validation, frontier derivation,
   ownership comparison, and process-local admission;
2. task-tracker or Git request and response time;
3. executor or execution-substrate start, stop, and report time; and
4. application Exit's local drain and process-end decision.

Only the fourth interval has a V1 hard wall-clock deadline. The first is a
metrics-only engineering concern until an operator requirement supplies a
target. The second and third are outside-system observations whose elapsed
time may be measured but cannot be converted into deterministic local test
delays or false authority facts.

## Material values and deterministic tests

The one-second ownership observation interval and five-second application Exit
drain are finite, positive, branded `Duration` values at their source
boundaries. Task-work capacity is the existing branded value from one through
eight, with default two. Tracker page/task limits and executor/claim command
limits remain branded or schema-limited at their owning protocol boundaries.

Tests that exercise these local values use Effect `TestClock` and explicit
completion signals. They do not sleep for a GitHub response, Git result, or
executor session. Controlled ownership tests exercise contradiction handling;
the Node adapter takes its cadence from the branded one-second value.
Application Exit tests advance the branded five-second drain and verify that
repeated requests cannot reset the original deadline. Remote and substrate
latency is covered by controlled boundary outcomes and reconciliation tests,
not by a claimed local duration.

## Coordinator ownership scope

The ownership interval applies only to one coordinator's OS-backed lock on one
canonical Git common directory. It is intentionally not a lease stored in the
Journal, a tracker claim, an in-process semaphore, or a distributed lock. A
future multi-host fencing design would require a separate accepted scenario,
authority boundary, and budget; this page does not imply one.

## Non-goals and review triggers

These budgets do not benchmark or optimize Dalph, predict simulated dry-run
task durations, promise end-to-end responsiveness, or add a configurable
operator timeout where the accepted architecture currently has a fixed or
protocol-owned decision. A future change that adds a freshness TTL, remote
request timeout, executor session deadline, retry backoff, or configurable
drain must first add chronological scenarios naming the owning authority and
the visible result, then update this page and the relevant branded/configured
boundary together.
