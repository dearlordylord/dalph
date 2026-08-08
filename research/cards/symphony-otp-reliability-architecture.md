# OpenAI Symphony and Elixir/OTP reliability architecture

**Audit date:** 2026-07-30

## 1. Scope, pin, and evidence boundary

This card audits OpenAI Symphony at commit
[`f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7`](https://github.com/openai/symphony/tree/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7).
The evidence is the pinned Elixir source, Mix manifest, tests, `SPEC.md`, and the
repository's example `WORKFLOW.md`. No fault experiment was run.

The pinned repository describes the Elixir implementation as prototype software
for evaluation and recommends that users build a hardened implementation from
the specification
([Elixir README, lines 1-8](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/README.md#L1-L8)).
This card therefore distinguishes:

- behavior demonstrated by reachable source and tests;
- behavior delegated to operator-authored hooks and prompts; and
- goals stated by the specification but not made durable by the implementation.

The comparison assumes one active coordinator for one Dalph Git common
directory. Symphony's lack of active-active coordination is still recorded, but
it is not treated as a missing first-version Dalph requirement.

## 2. Plain-language architecture

Symphony is one scheduler process with a mailbox. On each tick it rereads active
tracker items, stops or updates workers whose tracker facts changed, and starts
new workers until its local limits are full. Each worker gets a deterministic
directory, runs optional shell hooks, opens one Codex app-server process, and
runs several turns on one new Codex thread. Worker updates return as messages to
the scheduler
([orchestrator startup and tick, lines 54-125](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L54-L125);
[agent runner, lines 21-98](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/agent_runner.ex#L21-L98)).

The process tree has two important levels:

1. The application supervisor independently supervises configuration,
   agent-runtime, HTTP, and dashboard children with `:one_for_one`
   ([application, lines 33-50](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir.ex#L33-L50)).
2. The agent-runtime supervisor groups the `Task.Supervisor` and Orchestrator
   under `:one_for_all`. If the Orchestrator or task supervisor fails, both are
   restarted, which also terminates the old worker tasks
   ([agent-runtime supervisor, lines 14-33](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/agent_runtime_supervisor.ex#L14-L33);
   [restart test, lines 416-471](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/test/symphony_elixir/core_test.exs#L416-L471)).

OTP therefore supplies a strong local ownership rule: there is one live
Orchestrator serializing scheduler state, and every locally supervised worker
belongs to the same reset boundary. It does **not** preserve the Orchestrator's
maps, timers, Codex process, or thread handle after that boundary restarts. The
spec explicitly defines restart recovery as fresh tracker polling plus preserved
directories, not restoration of timers, sessions, or workers
([SPEC, lines 1689-1703](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L1689-L1703)).

In user terms: when OTP restarts the agent-runtime subtree, the old supervised
worker is stopped and a new worker may open the same desk. If the whole BEAM or
host disappears abruptly, Symphony has no later process scan proving that every
local or remote OS child stopped. In either case, the old conversation is not
resumed.

## 3. State-owner table

| Fact | Owner at the pinned commit | Durable across restart? | Consequence |
|---|---|---:|---|
| Issue identity, state, labels, blockers, priority, and dependencies exposed by the adapter | Configured tracker | Yes, according to tracker retention | Symphony rereads these facts; it does not copy them into a durable scheduler database ([tracker boundary, lines 1-40](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/tracker.ex#L1-L40)). |
| Scheduler claim | Orchestrator `claimed` set | No | It prevents duplicate dispatch only inside the current Orchestrator lifetime ([state struct, lines 24-44](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L24-L44)). |
| Running/blocked/completed classification | Orchestrator maps and set | No | Restart forgets which item was running, blocked on input, or observed complete. The README specifically says blocked entries are memory-only ([Elixir README, lines 30-36](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/README.md#L30-L36)). |
| Global, per-state, and per-host capacity use | Count of entries in the current `running` map | No | A replacement process starts with zero observed use and rebuilds it only by launching fresh workers ([capacity functions, lines 1325-1374](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L1325-L1374)). |
| Retry attempt, error, selected host, due time, and timer | Orchestrator `retry_attempts` map plus BEAM timer | No | Backoff position resets; the next poll can dispatch immediately ([retry scheduling, lines 1034-1073](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L1034-L1073)). |
| Worker PID and monitor | Orchestrator `running` entry and OTP runtime | No | The monitor converts a task exit into one scheduler transition only while that Orchestrator is alive ([`DOWN` handling, lines 128-147](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L128-L147)). |
| Codex app-server PID, thread ID, turn ID, session ID, last event, tokens, and rate limits | Worker session plus Orchestrator running entry | No | The dashboard can show them while live, but a new worker does not read them back ([session start, lines 38-62 and 94-120](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/codex/app_server.ex#L38-L120); [snapshot, lines 1414-1484](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L1414-L1484)). |
| Workspace locator | Derived from configured root and sanitized issue identifier | Recomputable, not recorded as attempt identity | A changed root or identifier can select another directory; the old one is not reconciled as an owned attempt ([workspace key/path, lines 249-287](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workspace.ex#L249-L287)). |
| Workspace file and Git state | Filesystem, plus whatever Git repository hooks created | Yes until hooks, people, host loss, or cleanup alter it | Core workspace reuse leaves an existing directory untouched ([workspace ensure, lines 40-51](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workspace.ex#L40-L51)). |
| Git base, branch, commits, push, PR, and merge state | Git/hosting platform as manipulated by workflow hooks, skills, and the agent | Only to the extent those systems preserve it | Symphony core has no Git state record or integration state machine; the reference workflow assigns pull, push, and landing to agent skills ([example workflow, lines 99-105](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/WORKFLOW.md#L99-L105)). |
| Workflow configuration and prompt | `WORKFLOW.md`; WorkflowStore holds a last-known-good in-memory copy | File yes; cached copy no | A process restart must parse the current file. During one process lifetime, invalid reloads retain the previous valid copy ([workflow-store message handling, lines 65-105](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workflow_store.ex#L65-L105); [load and retain behavior, lines 157-179](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workflow_store.ex#L157-L179)). |
| Application logs | Rotating disk log | Bounded | Logs survive ordinary restart but rotate at 10 MiB across five files by default; they are observability, not replay state ([log defaults, lines 8-29](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/log_file.ex#L8-L29); [rotation configuration, lines 68-77](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/log_file.ex#L68-L77)). |

There is no authoritative Symphony run or attempt record. The tracker owns the
work item, the filesystem owns the directory, and the current BEAM process owns
the scheduling interpretation that connects them.

## 4. Scheduling and capacity

On each poll, Symphony first reconciles running and blocked entries, validates
the current workflow, fetches issues in configured active states, sorts them,
and fills slots
([dispatch loop, lines 256-307](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L256-L307);
[selection, lines 781-829](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L781-L829)).
The candidate is refreshed by ID immediately before launch, reducing—but not
eliminating—the time-of-check/time-of-use window
([dispatch refresh, lines 907-937](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L907-L937)).

Capacity has these scopes:

- **Global:** configured maximum minus `map_size(running)`.
- **Per tracker state:** configured state limit minus running entries whose
  refreshed tracker state matches.
- **Per SSH host:** optional maximum minus running entries assigned to that
  host; the scheduler chooses a least-loaded available configured host.
- **Local host:** only the global and per-state limits apply; the SSH per-host
  limit is not a general local-host limit.
- **Per agent/account:** no separate quota is modeled.
- **Integration:** no separate merge or integration capacity exists.

The implementation of those counts is in
[state limits, lines 816-851](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L816-L851),
[global limits, lines 1369-1374](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L1369-L1374),
and
[SSH host selection, lines 1281-1341](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L1281-L1341).

Only `running` consumes capacity. A worker waiting in retry backoff or blocked
for operator input retains its in-memory claim but consumes no worker slot
([blocked transition, lines 747-778](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L747-L778);
[available slots, lines 1369-1374](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L1369-L1374)).
That is a coherent “live processes only” resource model, not Dalph's stronger
rule that an ambiguous attempt may need to keep its responsibility slot.

The local claim is written only after `Task.Supervisor.start_child` returns
successfully. There is no tracker mutation, database compare-and-swap, lease, or
external claim token in this dispatch path
([spawn and claim, lines 940-1003](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L940-L1003)).
With the agreed single-coordinator assumption, this is adequate protection
against two local scheduler callbacks launching the same issue. It is not a
cross-process fence: a second Symphony process can independently read and start
the same tracker item.

### OTP messages and failure ordering

All scheduler mutations pass through one GenServer. Worker runtime information,
Codex events, task `DOWN` notifications, ticks, and retry messages are each
handled as mailbox messages
([handlers, lines 82-205](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L82-L205)).
This removes shared-memory races inside one Orchestrator.

The application relies on OTP mailbox and monitor behavior rather than adding a
durable event ordinal. It does add fresh reference tokens to poll and retry
timers, so a superseded timer message cannot consume a newer entry
([retry token check, lines 1052-1090](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L1052-L1090);
[tick token, lines 1582-1595](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L1582-L1595)).
There is no corresponding attempt token on worker updates. An update for an
issue absent from `running` is ignored, and updates from different workers have
no application-level total order
([worker update handlers, lines 150-188](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L150-L188)).
Most importantly, none of this ordering survives a BEAM restart.

## 5. Restoration layers

### Control-plane task/run

The tracker issue survives, but Symphony's claim, running entry, blocked entry,
completion cache, retry number, retry deadline, token totals, and chosen host do
not. Startup initializes all of them empty, removes workspaces for tracker
terminal items, and schedules a fresh poll
([state initialization, lines 24-75](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L24-L75)).
This is a fresh scheduler interpretation of the same tracker task, not
restoration of the same Symphony attempt.

### Agent session, context, and logs

Within one live worker, Symphony starts one new Codex thread and runs multiple
turns against it; continuation prompts deliberately rely on the prior thread
context
([thread start, lines 307-365](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/codex/app_server.ex#L307-L365);
[continuation turns, lines 101-153](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/agent_runner.ex#L101-L153)).
When that worker exits, its app-server port is closed. Every later worker calls
`thread/start`; the source does not call a thread-resume method or reload a
stored thread ID
([session lifecycle, lines 88-98](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/agent_runner.ex#L88-L98);
[thread request, lines 314-340](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/codex/app_server.ex#L314-L340)).

Therefore:

- same Codex process: no after runtime restart;
- same Codex thread/context: no source-visible resume path;
- same session ID: no, a new thread/turn pair creates a new ID;
- previous event/tool-call stream: bounded rotating application logs may retain
  some text, but Symphony does not feed those logs into the new agent;
- honest fresh continuation: yes, through tracker content, files, Git state,
  and the workflow prompt, if those artifacts were maintained.

### Complete Git worktree and file state

Symphony core manages a directory, not a Git worktree protocol. On reuse it
does not delete or reset an existing directory. A test writes changed,
untracked, build, dependency, and scratch files, recreates the workspace, and
asserts every file remains
([workspace reuse test, lines 112-142](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/test/symphony_elixir/workspace_and_config_test.exs#L112-L142)).

If an operator's `after_create` hook made that directory a Git clone, then on
ordinary active-issue reuse the directory preserves, as ordinary filesystem/Git
facts:

| Git/file condition | Core reuse behavior | Qualification |
|---|---|---|
| Committed changes and current `HEAD` | Preserved | No recorded planned Base SHA or expected branch is checked. |
| Staged changes | Preserved | Core never runs `git reset`; a `before_run` hook may. |
| Unstaged tracked changes | Preserved | Same qualification. |
| Untracked files | Preserved | Explicitly demonstrated by the workspace reuse test. |
| Conflicted index/worktree | Preserved | Core does not detect, classify, abort, or quarantine conflicts. |
| Stashes | Preserved when the `.git` storage remains | Core does not enumerate or associate them with an attempt. |
| Ignored local artifacts | Preserved | They may still be altered by hooks or the next agent. |

Those are preservation-by-non-interference, not validated restoration. The spec
allows workspace population and synchronization to be implementation-defined
and recommends that reused workspaces not be destructively reset on population
failure
([SPEC, lines 892-900](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L892-L900)).
The example configuration clones only on first creation, while the workflow
prompt later tells the agent to synchronize Git
([example hook, lines 20-29](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/WORKFLOW.md#L20-L29);
[workflow synchronization instruction, lines 149-169](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/WORKFLOW.md#L149-L169)).
Different installations can therefore preserve, merge, reset, or corrupt
different states while all remaining Symphony-conformant.

A terminal tracker item is different: startup cleanup recursively removes its
workspace after a best-effort `before_remove` hook
([startup cleanup, lines 1160-1174](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L1160-L1174);
[local removal, lines 159-162](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workspace.ex#L159-L162);
[remove hook, lines 331-353](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workspace.ex#L331-L353)).
All committed, staged, unstaged, untracked, conflicted, stashed, and ignored
state stored only there can then be lost. This cleanup is state-based, not a
typed proof that the exact directory is safe to delete for one attempt.

### Live process, container, VM, or remote host

For local work, the worker owns an OS port running `bash -lc ... exec codex`;
the normal worker cleanup path closes that port
([local app-server port, lines 192-227](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/codex/app_server.ex#L192-L227);
[port close, lines 966-979](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/codex/app_server.ex#L966-L979)).
The runtime restart test demonstrates that the old supervised worker dies
before the replacement worker is admitted, preventing local overlap
([restart test, lines 434-471](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/test/symphony_elixir/core_test.exs#L434-L471)).
That test kills the Orchestrator inside a still-live BEAM. It does not prove
that an OS child is gone after ungraceful loss of the whole BEAM or host.

For remote work, the owned port is an `ssh -T` subprocess whose remote command
executes Codex
([SSH port, lines 11-27 and 41-49](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/ssh.ex#L11-L49)).
The source contains no durable remote process identity, heartbeat/adoption
protocol, container or VM identity, or restart scan. Whether a remote child
dies when SSH disappears is an environment fact, not a Symphony guarantee. A
replacement coordinator assumes no live worker and can launch another.

## 6. Immediate restart

Chronologically, an immediate Orchestrator restart inside a live BEAM does
this:

1. `:one_for_all` stops the old task supervisor and its worker tasks.
2. A new Orchestrator initializes empty scheduler state.
3. Startup reads tracker-terminal items and deletes their workspaces.
4. It schedules an immediate poll.
5. An active and routable item can be dispatched as a new worker.
6. The deterministic directory is reused if it still exists.
7. `before_run` runs again, then a new Codex app-server and new thread start.

The source and restart test establish those steps
([runtime supervisor, lines 21-33](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/agent_runtime_supervisor.ex#L21-L33);
[orchestrator init, lines 54-75](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L54-L75);
[worker sequence, lines 38-50](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/agent_runner.ex#L38-L50)).

After a whole-service crash, the replacement still begins at step 2, but it
cannot use the old supervisor to prove step 1 completed. There is no startup
scan for surviving local or remote processes. The visible upside is quick,
simple convergence: users do not need a workflow database to restart. The
visible downside is that a ten-second backoff, an operator-input block, and a
nearly finished live turn all become indistinguishable from an undispatched
active issue. Work files may survive; run identity and conversation do not, and
an unproven survivor may overlap a replacement.

## 7. Restart after a week and external drift

After a week, Symphony performs the same startup algorithm, not a staleness- or
age-aware recovery algorithm
([SPEC restart behavior, lines 1689-1703](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L1689-L1703)).
Outcomes depend on external state:

- **Issue still active and routable:** a fresh worker can reuse the directory.
- **Issue now terminal:** startup removes matching workspaces.
- **Issue no longer active/routable:** it is not dispatched; non-terminal
  workspace files remain.
- **Target branch moved:** core has no recorded base or drift decision.
  The operator's hook or next agent decides whether to merge, rebase, reset, or
  continue stale work.
- **Workflow root changed:** the deterministic path is recomputed under the new
  root; Symphony does not discover or adopt the old directory.
- **Workflow instructions changed:** the new worker receives the current
  prompt, not necessarily the policy under which old files were produced.
- **Logs rotated:** historical event evidence may be incomplete because the
  default log is bounded.
- **Remote host changed or disappeared:** the selected-host preference stored
  in the old retry entry is gone; fresh least-load selection is computed from
  an empty/current running map.

The user may get a useful continuation if the workpad and files honestly
explain what happened. Symphony itself cannot prove that the directory belongs
to the same attempt, that its Git base remains acceptable, or that no old
remote worker is still mutating it.

## 8. Git starting-point and integration behavior

Symphony deliberately does not prescribe Git. The spec lists Git CLI only as
optional workspace population tooling
([SPEC, lines 143-150](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L143-L150)).
The sample `after_create` hook performs `git clone --depth 1 ... .`, which
selects whatever default-branch commit the remote advertises at first creation;
no exact starting SHA is stored in Orchestrator state
([example workflow, lines 20-27](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/WORKFLOW.md#L20-L27)).

The reference prompt tells Codex to inspect branch/`HEAD`, pull before editing,
create or reuse branches according to workflow policy, push, manage a PR, and
land approved work
([startup workflow, lines 131-169](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/WORKFLOW.md#L131-L169);
[execution workflow, lines 199-237](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/WORKFLOW.md#L199-L237)).
Those are agent instructions, not scheduler-side invariants.

Consequently the core has:

- no planned Base SHA;
- no durable branch/worktree ownership record;
- no check that reused `HEAD` or index matches the issue;
- no accepted-target-head compare-and-swap;
- no merge queue or separate integration slot;
- no intent/observation record around push or merge;
- no reconciliation after an ambiguous push or merge response; and
- no typed quarantine or recovery disposition before cleanup.

This flexibility is valuable for a small orchestrator embedded into an existing
team process. It also means “Symphony completed the task” does not imply one
portable Git safety or integration guarantee. Users must inspect the configured
hooks, prompt, and agent skills to learn what happens.

## 9. Code organization by layers and end-to-end slices

The source has recognizable layers matching its spec:

- `Workflow`/`WorkflowStore` and Ecto-backed config schemas parse policy.
- `Tracker` and provider adapters normalize external tasks.
- `Orchestrator` owns coordination.
- `Workspace`, `SSH`, `AgentRunner`, and `Codex.AppServer` own execution.
- Logger and Phoenix modules expose observability.

The spec itself names policy, configuration, coordination, execution,
integration, and observability layers
([SPEC, lines 118-141](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L118-L141)).
The boundaries are small enough that a maintainer can trace a dispatch:
poll in `Orchestrator` → tracker adapter → `Task.Supervisor` →
`AgentRunner` → `Workspace` → `Codex.AppServer`.

The end-to-end slices are less uniform:

- **Claim one item:** entirely inside the Orchestrator map after task launch.
- **Retry one item:** Orchestrator timer plus a tracker reread and fresh worker.
- **Prepare workspace:** concrete filesystem/SSH calls plus arbitrary shell
  hooks.
- **Mutate tracker:** the Codex session calls a provider-native dynamic tool;
  the scheduler sees later tracker reads, not the mutation intent/result.
- **Commit/push/merge:** prompt and repository skills, outside the core
  orchestration state machine.
- **Recover:** startup terminal cleanup plus fresh polling; there is no shared
  reducer over prior effects.

The architecture is easy to read partly because it stops short of owning the
hardest Git and external-effect slices. Adding durable attempt identity,
ambiguous-effect reconciliation, pause, or accepted-head integration would
cross modules that currently share no common operation record.

## 10. Production, test, fake, and dry-run dependency seams

Strong seams:

- `Tracker` defines a behaviour for candidate and ID reads plus optional agent
  tools, with production adapters and an in-memory adapter
  ([tracker behaviour and adapter map, lines 13-31](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/tracker.ex#L13-L31);
  [memory adapter, lines 1-41](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/tracker/memory.ex#L1-L41)).
- A tracker adapter and its effective configuration are bound once per Codex
  session, preventing a workflow reload from switching tools mid-session
  ([tracker binding, lines 43-73](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/tracker.ex#L43-L73)).
- Agent continuation accepts an injected issue fetcher; app-server turns accept
  injected message and tool-executor callbacks
  ([agent test seam, lines 13-18](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/agent_runner.ex#L13-L18);
  [injected issue fetcher, lines 88-94](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/agent_runner.ex#L88-L94);
  [app-server callbacks, lines 71-94](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/codex/app_server.ex#L71-L94)).
- Supervisor and registered-process names are injectable, enabling isolated OTP
  restart tests
  ([runtime supervisor options, lines 8-29](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/agent_runtime_supervisor.ex#L8-L29)).

Weak or partial seams:

- `Config`, `Workspace`, `AgentRunner`, and `AppServer` are called as concrete
  global modules rather than injected capabilities.
- Filesystem, clock, timers, process monitor, shell, SSH, and logger are direct.
- Provider adapter selection is a compile-time module map, although several
  adapter clients are replaced in tests through application environment.
- The in-memory tracker is a fake read source, not an interpreter of tracker
  mutations or the entire workflow.
- There is no production/test/dry-run implementation of one shared workflow
  algebra. Dry-run is not a source-visible mode.

Effect `Service`/`Layer` substitution could improve the second group by making
clock, tracker, Git, workspace, executor, journal, and logging capabilities
explicit and by letting the same workflow be interpreted with production,
fake, and dry-run layers. It would not improve the first group's core
single-owner property merely by changing language: the GenServer already gives
clear local ownership.

## 11. Verification inventory

| Technique | Evidence | Assessment |
|---|---|---|
| Example-based unit and integration tests | ExUnit test tree and CI run `mix test --cover`; CI also runs format, Credo, spec checks, and Dialyzer ([Makefile, lines 20-45](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/Makefile#L20-L45); [CI, lines 9-38](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/.github/workflows/make-all.yml#L9-L38)) | Broad, conventional coverage. |
| Real OTP supervision/restart test | Kills the Orchestrator, observes replacement Orchestrator and task supervisor, proves the first worker dies, and asserts at most one replacement ([restart test, lines 351-471](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/test/symphony_elixir/core_test.exs#L351-L471)) | Strong evidence for reset-without-overlap inside one runtime. |
| Retry/message stale-event tests | Tests progressive retry, first backoff, stale retry-token rejection, and coalesced refresh tokens ([core tests, lines 1062-1208](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/test/symphony_elixir/core_test.exs#L1062-L1208)) | Good local interleaving coverage; not durable crash recovery. |
| Filesystem preservation tests | Reused workspace retains changed and additional files ([workspace test, lines 112-142](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/test/symphony_elixir/workspace_and_config_test.exs#L112-L142)) | Demonstrates non-destructive reuse, not Git coherence. |
| Fake tracker/process/SSH seams | Memory tracker, shell-script Codex fakes, and fake SSH executable are used in tests ([memory adapter, lines 1-41](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/tracker/memory.ex#L1-L41); [app-server launch seam exercised in source, lines 192-218](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/codex/app_server.ex#L192-L218)) | Useful protocol tests, but assembled ad hoc rather than one fake runtime. |
| Live end-to-end tests | README documents opt-in real tracker/Codex tests ([Elixir README, lines 307-320](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/README.md#L307-L320)) | Valuable external compatibility evidence, not part of ordinary CI. |
| Coverage threshold | Manifest declares 100%, but excludes Orchestrator, AgentRunner, AppServer, Workspace, Application, tracker clients, and other runtime modules ([mix manifest, lines 11-45](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/mix.exs#L11-L45)) | The headline threshold should not be read as 100% runtime coverage. |
| Property-based testing | No StreamData, PropCheck, PropEr, or equivalent dependency appears in the pinned dependency list ([mix manifest, lines 69-86](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/mix.exs#L69-L86)) | Not found. |
| Model-based/state-machine testing | No library or suite was found; state tests directly manipulate/observe GenServer state | Not found. |
| Formal specification/model checker | `SPEC.md` is a normative prose specification with pseudocode, not an executable Quint/TLA+/Alloy model ([SPEC state machine, lines 635-731](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L635-L731)) | No formal model or model checker found. |
| Deterministic clock | Production code directly calls `System.monotonic_time`, `DateTime.utc_now`, `Process.send_after`, and `:timer.send_after` ([retry scheduling, lines 1034-1053](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L1034-L1053); [poll scheduling, lines 1582-1600](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L1582-L1600)) | No common fake-clock seam found. |
| Boundary fault injection | One real Orchestrator-kill test exists; no suite systematically kills before/after tracker, workspace, app-server start, push, or merge boundaries | Partial, not comprehensive. |

## 12. Chronological failure table

| Chronological case | What persists and what restart reads | Outcome | User-visible result |
|---|---|---|---|
| 1. Process stops before claiming a task | Tracker item and any old directory persist; no local claim exists | Fresh poll may dispatch it | Usually only a delay. |
| 2. Stops after local claim but before workspace creation | The claim and running PID map are lost; tracker still appears active | An in-BEAM Orchestrator failure makes `:one_for_all` remove the worker; a whole-BEAM crash has no subsequent process proof. Fresh poll dispatches a new worker | No exact attempt continuity; no durable evidence that preparation began or that every OS child stopped. |
| 3. Creates workspace and then stops | Directory persists if issue remains non-terminal; scheduler state does not | New worker reuses the directory and reruns `before_run` | Partial files survive, but their completeness and Git base are not checked. |
| 4. Starts the agent but loses the start response | App-server/thread facts exist only in the dying worker and Orchestrator messages | Old supervised local worker is stopped; replacement starts a new app-server/thread | A tool call or edit near the boundary may have happened, but Symphony has no intent record to explain it. |
| 5. Agent finishes but control plane stops before recording result | Files, commits, tracker writes, PRs, and logs may persist externally; completion/continuation timer does not | Fresh poll uses current tracker state; active issue starts again, terminal issue workspace is cleaned | Correctness depends on the agent having recorded completion externally before the crash. |
| 6. Branch push succeeds but response is lost | Remote branch may prove success; Symphony core recorded neither intent nor observation | Behavior belongs to the agent/skill; after restart a fresh agent must inspect Git hosting | Possible duplicate push/retry is usually Git-idempotent for the same ref, but divergent retry policy is workflow-defined. |
| 7. Integration succeeds but response is lost | Target branch/PR/tracker may show success; no Symphony integration record exists | Fresh agent or human must reconcile hosting facts | Symphony cannot itself distinguish successful merge from failed merge or serialize concurrent accepted results. |
| 8. User closes and immediately reopens | Tracker, workspace, bounded logs, Git/hosting facts persist; all runtime maps, timers, and Codex context reset. No startup scan proves old OS children are absent | Fresh dispatch in reused directory | Looks like continuation in files, but is a new session and run interpretation; an abnormal prior shutdown can leave process status unknown. |
| 9. User returns after a week and tracker/target moved | Current tracker and directory are read; old retry/session/base/host facts are absent | Terminal deletes workspace; active starts fresh; Git drift is delegated to hooks/agent | Work may continue, conflict, be reset, or be deleted depending on external state and workflow policy. |

Cases 2–5 follow from the launch sequence and memory-only claim
([spawn and claim, lines 940-1003](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L940-L1003))
plus the documented restart reset
([SPEC, lines 1689-1703](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L1689-L1703)).
Cases 6–7 are outside the core because tracker writes and Git workflow are
intentionally performed by the coding agent rather than the Orchestrator
([SPEC, lines 39-44 and 60-66](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L39-L66)).

## 13. Maintenance risks

1. **Reset is easy to reason about but can erase distinctions users care
   about.** A retry waiting for backoff, a blocked agent, and an undispatched
   issue all return as fresh active candidates.
2. **A reusable path stands in for attempt identity.** It can contain valuable
   work or stale/wrong work; neither case is classified before launch.
3. **Hooks contain control-plane policy without typed observations.** Git
   selection, synchronization, cleanup salvage, and tool installation can
   change behavior materially while the Elixir scheduler remains unchanged.
4. **External writes bypass the scheduler state machine.** The Codex tool can
   mutate tracker state and the agent can push or merge, but the Orchestrator
   learns through later reads, so ambiguous effects require prompt-level repair.
5. **Remote execution weakens the local supervision story.** OTP owns the SSH
   port, not a durable remote process identity; restart cannot prove adoption or
   termination.
6. **Global modules narrow substitution.** Tracker reads have a behaviour, but
   workspace, executor, time, filesystem, SSH, and configuration are concrete
   calls across the end-to-end slice.
7. **Cleanup is broader than evidence.** Terminal state is sufficient to
   recursively delete the deterministic directory; no attempt ownership or
   dirty-worktree disposition is required.

## 14. Ideas Dalph should consider

### Borrow

- **One local scheduling owner.** Symphony demonstrates how much race reasoning
  disappears when one process owns admission and state transitions.
- **A deliberate supervisor reset boundary.** Restart scheduler and workers
  together when scheduler memory cannot safely describe surviving workers.
  Dalph should retain this as one valid disposition even if it can sometimes
  adopt a proven executor.
- **Token stale timers.** Fresh opaque tokens for ticks and retries are a small,
  effective defense against superseded mailbox messages.
- **Revalidate immediately before dispatch.** Tracker facts can change between
  the frontier read and worker launch.
- **Keep non-terminal workspaces by default.** Non-destructive reuse is a good
  preservation default, provided Dalph adds exact attempt/base validation.
- **Last-known-good live configuration.** During one process lifetime, a bad
  edit does not destroy the running configuration.
- **Small readable scheduler kernel.** Symphony's policy is traceable despite
  its limitations.

### Strengthen rather than copy

- Persist a Dalph attempt identity, intended effects, observations, retry
  position, exact Base SHA, and owned workspace locator in the journal.
- Distinguish `same agent session`, `fresh agent in preserved worktree`, and
  `fresh attempt from clean base`; never label all three “resume.”
- Require an executor identity before adopting a surviving local or remote
  process; otherwise stop/quarantine it and keep responsibility accounted for.
- Inspect committed, staged, unstaged, untracked, conflicted, stashed, and
  ignored-but-required state before reuse or cleanup.
- Put Git start, push, accepted-head integration, and cleanup disposition behind
  typed boundaries with reread-after-ambiguity.
- Keep execution capacity separate from integration serialization.

### What Effect could improve, and what it would merely reimplement

An Effect implementation could technically improve Symphony's maintainability
where its current seams are global:

- explicit `Service`/`Layer` boundaries for tracker, Git, workspace, executor,
  journal, clock, logging, and remote host;
- Schema decoding and branded identities for issue, attempt, session,
  workspace, host, revision, and duration;
- tagged failures instead of nested arbitrary terms and log strings;
- scoped child process/SSH lifetimes and structured interruption;
- deterministic clock/retry tests; and
- production, fake, and dry-run interpreters over one workflow algebra.

Effect would mostly **reimplement**, not surpass, OTP's current in-process
strengths: one serialized scheduler owner, supervised child lifetimes,
monitoring, bounded concurrency, timers, and cancellation. Replacing a GenServer
with a fiber or queue does not itself improve restart behavior.

Neither Effect nor OTP automatically persists a workflow, proves whether a
tracker/Git effect happened, restores a Codex thread, validates an exact Git
base, or adopts a remote process. Those improvements require an explicit
durable protocol and authoritative rereads. Effect Workflow might supply
durable workflow/step/timer mechanics later, but only if Dalph keeps tracker,
Git, and executor authority external and avoids creating a second conflicting
workflow authority.

## 15. Confirmed unknowns and negative-claim search record

### Confirmed unknowns

- Whether every supported Codex app-server version durably retains threads that
  could be resumed. The pinned Symphony implementation does not attempt resume,
  so provider capability would not change its current behavior.
- Whether an SSH-launched Codex process always terminates when the local SSH
  port closes. This depends on SSH server, shell, process-group, and host policy;
  Symphony has no observation/adoption protocol.
- How a particular installation handles dirty Git state, conflict, branch drift,
  push ambiguity, or merge ambiguity. These are hook/prompt/skill-defined.
- Whether an issue identifier can change in every adapter and, if so, how an old
  directory should be found. The path is identifier-derived; no migration path
  was found.
- Whether a terminal workspace's `before_remove` hook successfully preserves
  every valuable Git/file condition. Hook failure is ignored before recursive
  removal
  ([remove hook failure handling, lines 331-395](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workspace.ex#L331-L395)).

### Negative-claim X-ray

Searches covered `mix.exs`, `mix.lock`, all `lib/`, all `test/`, `.github`
workflows, `SPEC.md`, both READMEs, docs, skills, and the example workflow.

- No database, durable queue, event store, or scheduler journal dependency was
  found; the spec explicitly calls scheduler state intentionally in-memory
  ([SPEC, lines 1689-1699](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L1689-L1699)).
- No `thread/resume` call or durable thread-handle store was found; reachable
  app-server startup always sends `thread/start`
  ([app server, lines 307-340](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/codex/app_server.ex#L307-L340)).
- No Git module, base-SHA record, branch lease, merge queue, accepted-head
  protocol, or push/merge reconciliation code was found in the core; Git is
  optional population tooling in the spec
  ([SPEC, lines 143-150](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L143-L150)).
- No leader election, distributed lock, tracker claim callback, or external
  lease was found in the tracker behaviour or dispatch path
  ([tracker callbacks, lines 22-31](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/tracker.ex#L22-L31);
  [spawn path, lines 940-1003](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L940-L1003)).
- No property-testing dependency, property suite, executable state-machine/model
  suite, formal model, model checker, or deterministic clock service was found.
  The manifest's dependency list supports the dependency part of that result
  ([mix manifest, lines 69-86](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/mix.exs#L69-L86)).
- No complete crash-boundary suite was found. The real Orchestrator-kill test is
  strong but tests reset-without-overlap, not every external-effect ambiguity
  ([restart test, lines 351-471](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/test/symphony_elixir/core_test.exs#L351-L471)).

These are statements about the pinned source tree, not claims that the authors
have never explored those techniques elsewhere.

## 16. Technical and user-visible consequences

| Finding | Technical consequence | What the user notices |
|---|---|---|
| OTP single-owner scheduler | Local scheduling mutations are serialized and supervised worker ownership is clear | One running service does not normally start the same issue twice. |
| `:one_for_all` reset | Orchestrator failure also clears supervised worker tasks, avoiding a locally invisible survivor | Restart is clean, but a healthy near-finished agent is stopped too. |
| Memory-only claims/timers | Retry, blocked, and capacity facts vanish; restart may dispatch immediately | Backoff and “waiting for input” disappear from the dashboard, and work starts as a fresh run. |
| New `thread/start` on every worker | Same-thread context lasts only across turns in one worker | Reopened work may see files and workpad notes, but not the old conversation. |
| Non-destructive directory reuse | All ordinary filesystem/Git states can remain, including unsafe or conflicted ones | Valuable partial work often survives, but the user cannot infer that it is safe or based on the intended commit. |
| Terminal recursive cleanup | Simple garbage collection, but no dirty-state disposition | Moving an issue terminal can delete the only copy of unpushed or uncommitted work. |
| Hook-defined Git | Small generic core; correctness varies by deployment | Starting commit, sync, branch, push, review, and merge behavior must be learned from local workflow files. |
| No integration protocol | Symphony avoids owning repository acceptance | Humans/agents/hosting still decide ordering and ambiguous merge recovery. |
| Remote execution through SSH port | Easy multi-host fan-out with in-memory per-host caps | A coordinator restart cannot prove an old remote worker stopped before launching another. |
| Effect versus OTP | Effect can improve typed seams, test interpreters, and explicit resources; it cannot create durability by itself | Users benefit only if Dalph uses those seams to implement stronger attempt, workspace, session, and ambiguity protocols—not from the library choice alone. |

The central conclusion is narrow: Symphony is a strong example of **simple
single-process supervision and scheduling**, not durable orchestration. For the
agreed one-coordinator Dalph target, OTP's lack of distributed coordination is
not the important difference. The important difference is that Symphony
intentionally resets the attempt/session interpretation and relies on tracker
facts plus an unvalidated directory to make fresh progress. Dalph can be
technically stronger only if its Effect architecture is used to persist and
reconcile those missing phenomena; reproducing the same maps, timers, and child
supervision in Effect would mainly be a language-level rewrite.
