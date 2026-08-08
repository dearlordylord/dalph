# OpenAI Symphony crash-experiment specification

**Status:** design only; blocked from execution
**Product revision:** [`f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7`](https://github.com/openai/symphony/tree/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7)
**Common protocol:** [control-plane crash experiment protocol](../control-plane-crash-experiment-protocol.md)

This document prepares a credential-free experiment for the pinned Elixir
implementation. It does not contain an approved runnable harness, and no fault
case may be executed from it. The preflight gate below must first turn each
candidate lifecycle action into a reviewed, source-matched harness action and
record the validated invocation in an experiment manifest.

The specification is intentionally narrower than Symphony's full production
surface. It uses the built-in memory tracker, local directories, disposable
Git, an app-server protocol fake, unique OTP names, and loopback-only
observability. It never connects to Linear, GitHub, GitLab, Asana, Jira, a model
provider, a package registry, or an SSH server.

## 1. Source-backed product boundary

Symphony's active scheduler state is an Orchestrator GenServer. Its `running`,
`claimed`, `blocked`, retry, timer, token, and capacity facts are BEAM memory;
startup creates them empty and schedules a fresh poll
([Orchestrator state and initialization](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L24-L75)).
The memory tracker reads `Issue` structs from application environment and has
no mutation callback or durable store
([memory tracker](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/tracker/memory.ex#L1-L50)).

The local agent-runtime supervisor places the task supervisor and Orchestrator
under `:one_for_all`. Killing only the Orchestrator inside a live BEAM therefore
restarts the task supervisor and terminates its worker tasks
([runtime supervisor](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/agent_runtime_supervisor.ex#L14-L33)).
The existing test demonstrates this exact reset and rejects overlapping
replacement workers
([restart fixture](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/test/symphony_elixir/core_test.exs#L351-L471)).

A worker creates or reuses its deterministic issue directory, reports the path
to the Orchestrator, runs `before_run`, starts one app-server session, and
always tries `after_run`
([worker sequence](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/agent_runner.ex#L21-L98)).
For a new local directory, `after_create` runs before `create_for_issue`
returns; an existing directory is left in place
([workspace creation](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workspace.ex#L13-L51),
[hook decision](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workspace.ex#L289-L305)).

The app-server adapter launches the configured command through a local
`bash -lc ... exec`, records the OS PID exposed by the port, sends
`initialize`, then always sends `thread/start`
([local launch](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/codex/app_server.ex#L192-L227),
[thread start](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/codex/app_server.ex#L307-L340)).
A session ID is formed only after `turn/start` returns a turn ID, and it is
reported to the Orchestrator as a live update
([turn/session reporting](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/codex/app_server.ex#L71-L120)).

These boundaries define what this experiment may claim. It can test OTP
reset, whole-BEAM loss, fresh app-server/thread creation, directory reuse, and
capacity reconstruction. It cannot manufacture a durable Symphony claim, base
SHA, push receipt, merge receipt, or integration lock that the product does not
own.

## 2. Disposable fixture

One launcher creates an explicit root with `mktemp -d`. Before any child starts,
the launcher resolves the root to an absolute path and writes an ownership
manifest containing a random experiment ID, creator PID, pinned product SHA,
creation time, and the root's device/inode pair. Every path below is a child of
that root:

```text
<root>/
  owner.json
  workflow/WORKFLOW.md
  tracker/issues.term
  git/remote.git
  git/seed/
  workspaces/
  fake-bin/fake-codex
  fake-bin/ssh                 # only for an isolated fake-SSH qualification
  control/
    phase.fifo
    commands.fifo
  state/
    agent/
    pids/
    otp/
  logs/
  evidence/
```

`issues.term` is harness input, not a Symphony database. On every BEAM start,
the harness decodes it into `SymphonyElixir.Tracker.Issue` structs and sets the
memory tracker's application environment before starting the isolated runtime.
That mirrors the adapter's actual read seam while making the same task fixture
re-creatable after whole-BEAM death
([issue representation](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/tracker/issue.ex#L1-L46),
[memory source](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/tracker/memory.ex#L36-L41)).
The file must contain only the four synthetic tasks and must be schema-checked
by the preflight harness; Erlang terms from an untrusted source must not be
evaluated.

The task graph is:

```text
A ──► C
B ──► C
D
```

A and B are active, dispatchable, and higher priority. C is active but
non-dispatchable while A or B remains incomplete. D is active, dispatchable,
and lower priority. The harness changes C's fixture to dispatchable only after
A and B are marked terminal; it does not pretend that the memory adapter itself
implements tracker writes. `Issue` exposes `priority`, `blocked_by`, and
`dispatchable`, while Orchestrator selection sorts by priority and admits only
routable active candidates
([issue fields](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/tracker/issue.ex#L12-L46),
[selection](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L781-L868)).
`agent.max_concurrent_agents` is two. The fake app servers for A and B block,
so D exposes whether reconstructed capacity starts replacement work while an
old executor may still exist.

The workflow uses:

- `tracker.kind: memory`;
- the disposable workspace root;
- capacity two;
- a short but nonzero poll interval whose exact validated value is recorded;
- one turn per worker unless a scenario explicitly observes same-thread
  continuation;
- the fake app-server command under `<root>/fake-bin`;
- no SSH hosts for the primary matrix;
- no provider or tracker API key;
- hooks whose scripts are generated under `<root>` and whose only Git remote is
  `<root>/git/remote.git`;
- a loopback server host and dynamically allocated loopback port, or the
  server disabled when the harness can inspect the named Orchestrator directly.

The test support already constructs memory-tracker workflow files with
overridable workspace, concurrency, Codex command, hook, timeout, and server
settings
([workflow fixture builder](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/test/support/test_support.exs#L90-L205)).
The production CLI accepts an explicit workflow path, logs root, and port, but
requires a guardrail acknowledgement
([CLI parsing](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/cli.ex#L1-L81)).
The experiment must not select between an isolated ExUnit harness and a
separate CLI-launched BEAM until preflight proves that memory issues, unique
names, observation, and shutdown work in that mode.

## 3. Disposable Git and full worktree evidence

Preflight creates a local bare remote, a seed clone, and commits `B0`. It
records the literal object ID of `B0`, creates target branch `experiment-target`
at that object, then creates `B1` only for C9. No branch is named or resolved by
an implicit default after fixture construction.

The `after_create` hook performs the local clone/population step and checks out
a deterministic task branch from the recorded `B0`. This is deliberately
experiment policy, not a claim about Symphony core: the product treats Git as
optional workspace population and delegates synchronization to hooks and agent
instructions
([optional Git boundary](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L143-L150),
[example clone hook](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/WORKFLOW.md#L20-L29)).
The hook writes its resolved source, target branch, `B0`, worktree path, and
experiment ID into the evidence timeline.

At each barrier, the observer captures without mutating the repository:

- `HEAD`, current symbolic branch, upstream, all local and remote refs;
- `git status --porcelain=v2 --branch --untracked-files=all`;
- cached and unstaged binary-safe diffs;
- `git ls-files --stage --debug`;
- unmerged index entries from `git ls-files -u`;
- stash list and each stash object ID;
- worktree list in porcelain form;
- merge/rebase/cherry-pick/revert/bisect marker existence;
- submodule status if the synthetic repository later adds a submodule;
- hashes, modes, and relative paths for tracked, untracked, and explicitly
  allowlisted ignored evidence;
- remote ref object IDs from the disposable bare repository; and
- repository common-directory and object-format identity.

The fake agent's ordinary C4 phase creates, in order, `C1` containing
`committed.txt`, stages `staged.txt`, modifies tracked `unstaged.txt`, creates
`untracked.txt`, and writes ignored
`.agent-local/required-state.json`. Stash and conflict variants are separate.
The fake must never run a cleanup, reset, checkout, stash-pop, merge-abort, or
push unless the active scenario calls for that exact phase.

## 4. Fake app-server and agent evidence

The fake executable is derived from the shell-script app-server fixtures, which
already answer Symphony's `initialize`, `thread/start`, and `turn/start`
requests and emit `turn/completed`
([protocol fake example](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/test/symphony_elixir/app_server_test.exs#L79-L128)).
It must be rewritten as a dedicated experiment fixture rather than copied
blindly because the experiment needs deterministic barriers, process evidence,
and Git phases.

For every invocation it appends JSON Lines containing:

- experiment, task, invocation, fake-process, thread, turn, and synthetic
  provider-session identities;
- parent PID, process group, workspace, `HEAD`, and start time;
- each request method received and response boundary crossed;
- each Git/file phase completed;
- every continuation prompt hash;
- FIFO command received;
- EOF, signal, port close, and controlled exit reason.

It responds with a new thread ID to every `thread/start`. It never implements
`thread/resume`. This permits the experiment to distinguish a new thread from
reuse of the directory and agrees with Symphony's source-visible startup path
([thread request](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/codex/app_server.ex#L314-L340)).
For a continuation qualification, it records multiple `turn/start` requests
on the same live thread before any interruption; AgentRunner's continuation
prompt relies on the existing thread context
([continuation loop](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/agent_runner.ex#L101-L153)).

The fake accepts no network address and opens no socket. Control uses named
FIFOs under the disposable root. If FIFO behavior proves unreliable on a
supported platform, preflight must reject the platform rather than silently
replace the barrier with sleeps.

## 5. Lifecycle actions that must be validated

The experiment needs four distinct interruption actions:

| Action | Intended seam | What it may establish |
|---|---|---|
| Orchestrator death inside a live BEAM | Resolve the injected Orchestrator name, monitor it, then use the same `Process.exit(pid, :kill)` pattern as the existing restart test ([test seam](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/test/symphony_elixir/core_test.exs#L416-L457)) | OTP `:one_for_all` reset, termination of the old supervised worker, empty replacement scheduler state, and redispatch behavior. |
| Whole-BEAM crash | An external launcher sends an untrappable kill to the exact recorded BEAM PID and no other PID | Durable filesystem/Git/log facts and whether the fake OS child survives or is orphaned. It does not establish graceful cleanup. |
| Graceful runtime stop | Stop the exact isolated runtime supervisor with normal shutdown semantics and wait for its children | Cleanup and port-close behavior during an orderly stop. |
| Local executor crash | Terminate only the exact fake app-server PID/process group while leaving BEAM and Orchestrator alive | Port-exit handling, task `DOWN`, retry state, capacity release, and later fresh invocation. |

These are harness actions, not yet approved shell commands. Preflight must
compile the harness, prove each target PID/name is owned by the manifest, run
each action against an idle canary, and then write the exact validated command
or RPC plus expected acknowledgement to `evidence/preflight.json`. Until that
file passes independent review, all scenario launch code must exit before
starting Symphony.

The primary matrix is local. SSH behavior remains source-only because the
owned local process is an `ssh -T` port and the source has no durable remote PID
or adoption protocol
([SSH launch](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/ssh.ex#L1-L49)).
A separate qualification may use the repository's PATH-injected fake `ssh`
script to verify argument construction and local port lifetime, without an SSH
server or remote process
([fake SSH fixture](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/test/symphony_elixir/ssh_test.exs#L105-L183)).
That qualification must not be reported as remote crash recovery.

## 6. Readiness and observation gates

No scenario advances on elapsed time alone. A barrier is ready only when all
expected facts agree:

1. the fake appends the named phase with its invocation and PID;
2. the expected workspace and Git observation match;
3. `Task.Supervisor.children(unique_task_supervisor)` has the expected count;
4. the named Orchestrator snapshot has the expected running, retrying, and
   blocked entries;
5. the process inventory contains no unexpected child; and
6. the disk log has reached the expected causal message when the case depends
   on one.

The snapshot exposes running task identity, workspace, session, app-server PID,
turn count, retry entries and deadlines, blocked entries, and polling state
([snapshot](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L1391-L1484)).
Application logs are directed under the disposable root. They rotate and are
observability rather than replay state
([log handler](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/log_file.ex#L8-L29),
[rotation](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/log_file.ex#L68-L77)).

For every restart, record:

- old and new runtime supervisor, task supervisor, Orchestrator, worker, BEAM,
  and fake-agent PIDs;
- whether the old executor is alive, stopped, orphaned, or unobservable;
- old and new thread, turn, session, and invocation identities;
- tracker fixture revision and exact four tasks;
- running/retrying/blocked counts, global capacity two, and whether D starts;
- workspace path and complete Git evidence;
- app-server and Symphony logs before and after; and
- the operator-visible snapshot or loopback endpoint response.

## 7. C0–C9 mapping

| Case | Support | Exact product seam and planned interruption | Required conclusion |
|---|---|---|---|
| C0 — stop before claim | Supported for in-BEAM reset and whole-BEAM restart | Start with the memory fixture empty, establish an idle snapshot, install A–D in memory, and interrupt before requesting/allowing the next poll. On restart/bootstrap, install the same tracker revision before starting the runtime. | The fresh poll should recompute A and B as the first candidates. Record no phantom `running`, `claimed`, or retry entry. Startup schedules a fresh poll from empty state ([init](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L54-L75)). |
| C1 — durable claim applied, response lost | **Unsupported** | Symphony's claim is inserted into the local `claimed` set only after `Task.Supervisor.start_child` returns; the tracker behaviour has no claim mutation or response boundary ([dispatch](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L953-L991), [tracker callbacks](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/tracker.ex#L13-L31)). | Report “no durable product claim seam”; do not substitute an artificial database or label. |
| C2 — workspace created, control record missing | Supported | The `after_create` hook initializes local Git and blocks after writing a workspace-ready marker but before returning. At that point `create_for_issue` has not returned and the worker has not sent `workspace_path`; interrupt the Orchestrator or whole BEAM ([workspace/worker ordering](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/agent_runner.ex#L38-L47)). | Record whether replacement dispatch reuses the exact directory, reruns only `before_run`, and creates no second directory. Symphony has no durable workspace acknowledgement to restore. |
| C3 — agent started, start response lost | Partially supported | Fake receives and logs `thread/start`. Variant 1 blocks before its response; variant 2 responds, then blocks before `turn/start`. Interrupt Orchestrator inside BEAM and, separately, the whole BEAM while observing the fake PID. | In-BEAM reset should stop the supervised worker; a replacement should issue a new `thread/start`. Whole-BEAM result must classify old fake liveness from process evidence, never infer it. There is no adopt/resume path. |
| C4 — complete uncommitted worktree | Supported locally | Fake acknowledges `turn/start`, creates C1 plus staged, unstaged, untracked, and ignored evidence, then blocks. Run Orchestrator-death and whole-BEAM variants; add separate stash and conflict variants. | Hash and compare every Git layer, worktree registration, base, fake log, and PID. A replacement may reuse the directory, but that is preservation, not validation ([workspace reuse](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workspace.ex#L40-L51)). |
| C5 — agent finishes, result not recorded | Supported only with an OTP observation barrier | Suspend the named Orchestrator after it has recorded the running entry, release the fake to emit `turn/completed` and exit, prove the fake exit marker exists while its messages/`DOWN` cannot be processed, then kill Orchestrator or the whole BEAM. Preflight must prove suspension does not suspend the worker/task supervisor. | Replacement starts from tracker and directory facts. Record whether work reruns, which new thread starts, and whether old completion exists only in fake/log evidence. |
| C6 — push applied, response lost | **Unsupported as a Symphony control-plane case** | A local fake can push to the disposable bare remote, but Symphony core neither requests push nor records its result; Git behavior belongs to hooks/agent policy ([workflow delegation](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/WORKFLOW.md#L99-L105)). | Source-only result: no core remote-ref reread or push reconciliation. An optional fake-agent qualification may show the remote ref survives, but must not be scored as Symphony recovery. |
| C7 — target update applied, response lost | **Unsupported** | Symphony has no core integration operation, target CAS, merge queue, or integration slot; Git/landing is delegated to agent workflow ([execution instructions](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/WORKFLOW.md#L199-L237)). | Record “no integration protocol” and the handoff boundary: preserved directory/branch plus agent or operator policy. |
| C8 — immediate graceful close/reopen | Supported | At the C4 barrier, gracefully stop the isolated runtime supervisor and wait for all owned children/ports to terminate; restart with the same memory fixture, workflow, names made fresh for the new runtime, and workspace root. | Compare with C4 crash variants. Record `after_run`, port close, old fake exit reason, new `thread/start`, Git preservation, and capacity. |
| C9 — week-later drift | Drift variants supported; elapsed-week/session-expiry simulation unsupported | Stop after C4; move local target from B0 to recorded B1, revise one task/dependency in `issues.term`, then restart with retained-workspace and removed-workspace variants. Do not wait a week. The production clock/timers are direct and there is no fake-clock seam ([retry and poll clocks](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L1034-L1053)). | Report immediate external-drift behavior separately from unsupported elapsed-time/lease/session-expiry behavior. Symphony stores no resumable provider handle; each replacement sends `thread/start`. |

## 8. Interruption-specific expectations

### Orchestrator death inside a live BEAM

This is the best-supported case. The expected reset boundary is the whole
agent-runtime subtree, not only the GenServer. Evidence must show the old task
supervisor and worker die before a replacement worker appears, as the existing
test demonstrates
([restart ordering](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/test/symphony_elixir/core_test.exs#L434-L471)).
It must not be described as durable crash recovery because the application
supervisor and BEAM remain alive.

### Whole-BEAM crash

The launcher kills only the recorded BEAM PID. It then inventories the fake
agent PID/process group before starting a new BEAM. If the fake remains alive,
the new Orchestrator has no source-visible scan or adoption record; if it dies,
the evidence must identify the OS mechanism rather than credit a Symphony
startup reconciliation. The result must distinguish supervisor cleanup from
kernel/port/shell behavior.

### Graceful shutdown

Graceful shutdown is a control case. It must wait for supervisor termination,
port closure, `after_run`, disk-log flush, and absence of owned children before
restart. A signal name or CLI command is not specified here because the
correct packaged shutdown entrypoint has not yet been validated. The preflight
manifest must supply it or restrict C8 to the exact isolated-supervisor call
used by the harness.

### Local executor crash

Killing only the fake app-server should make the worker fail, produce a task
`DOWN`, release its running slot, and enter the normal retry path while the
same Orchestrator remains live
([`DOWN` handling](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L128-L147)).
Observe retry number, due time, capacity, and whether D starts. Do not combine
this with coordinator death.

### SSH and remote execution

No real SSH test is authorized. The fake-SSH qualification may establish local
argv, line-mode, port, and EOF behavior only. Remote child survival, remote
filesystem state, per-host process adoption, and remote cleanup remain
source-only unknowns.

## 9. Capacity and session observations

At capacity two, A and B should occupy `running`; C remains ineligible and D is
eligible but unstarted. Symphony calculates global availability from
`map_size(running)` and does not count retrying or blocked entries as live
workers
([admission checks](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L816-L851)).

After each interruption, record:

1. whether A's old fake is alive;
2. whether replacement A starts;
3. whether B remains or is also reset;
4. whether D starts before old execution ownership is resolved;
5. snapshot running/retrying/blocked counts; and
6. maximum simultaneous fake PIDs from the append-only agent log.

For session classification:

- **complete restoration** requires the same synthetic provider session and
  continuing context/log;
- **partial restoration** means a new thread reads preserved filesystem or
  explicit handoff;
- **lost** means neither session nor handoff continues.

A reused workspace plus a new `thread/start` is partial at best, never the same
session. Symphony's normal live continuation uses repeated turns in one thread,
whereas replacement workers start a new thread
([live continuation](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/agent_runner.ex#L101-L153),
[new session](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/codex/app_server.ex#L38-L62)).

## 10. Integration observation

There is no Symphony integration scenario to execute. The evidence bundle still
records:

- target `experiment-target` and its B0/B1 object IDs;
- each task branch and candidate commit;
- whether the fake agent pushed anything in an explicitly labeled
  qualification;
- absence of a Symphony integration request, fence, queue, result, or cleanup
  record; and
- the handoff boundary visible to an operator.

No result may say that Symphony serialized, retried, or reconciled integration.
The core intentionally delegates branch, PR, and landing work to agent policy
([workflow instructions](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/WORKFLOW.md#L199-L237)).

## 11. Resource caps and credential/network isolation

Before launch, the environment allowlist contains only locale, the disposable
root, a minimal PATH whose fake `codex` precedes system tools, and runtime
variables explicitly required by Erlang/Elixir. The launcher removes all
GitHub, GitLab, Linear, Jira, Asana, model-provider, cloud, SSH-agent, registry,
package-publishing, proxy, and credential-helper variables. It sets Git's
global/system configuration to inert experiment-owned files and rejects any
remote URL that is not a canonical path beneath `<root>/git`.

Caps, whose exact platform mechanism must be validated in preflight:

- one Symphony BEAM and at most four fake-agent processes;
- Symphony capacity two;
- no real SSH/container/VM;
- loopback-only listening, with no listener when direct named-process
  observation is sufficient;
- a per-scenario wall-clock deadline no greater than two minutes;
- a whole-suite deadline no greater than thirty minutes;
- a per-process file-descriptor/process limit;
- a documented CPU and address-space limit;
- a 512 MiB root quota or post-write guard that halts before that size;
- 10 MiB maximum per evidence stream, with hashing before any truncation; and
- no package fetching during a scenario.

Preflight must prove dependencies were already installed for the pinned
checkout. If Mix attempts network access, execution is blocked rather than
allowed through a proxy.

## 12. Evidence bundle

Every scenario writes the common protocol bundle plus:

```text
evidence/
  preflight.json
  ownership.json
  otp-tree-before.json
  otp-tree-after.json
  snapshot-before.json
  snapshot-after.json
  fake-agent-processes-before.json
  fake-agent-processes-after.json
  fake-agent-log.jsonl
  hook-log.jsonl
  git-before/
  git-after/
  tracker-fixture-before.term
  tracker-fixture-after.term
  log/symphony.log*
```

`timeline.jsonl` uses one harness-assigned ordinal. Product log timestamps and
fake-agent timestamps are observations attached to that ordinal, not used to
invent a total order. `manifest.json` hashes every retained file and records
missing evidence explicitly.

Each result separately classifies:

- task/run reconstruction;
- provider-style session/context/log;
- committed, staged, unstaged, untracked, ignored, conflict, stash, worktree,
  branch, and base state;
- local live execution;
- capacity;
- integration or its absence; and
- operator-visible state.

## 13. Teardown proof

Teardown is fail-closed:

1. Stop the isolated supervisor/BEAM only through its recorded identity.
2. Send controlled termination to every recorded fake/hook PID and process
   group, then escalate only those exact identities after a deadline.
3. Prove none remains alive and prove no listener remains.
4. Prove every Git common directory, worktree, FIFO, log, and evidence path
   resolves beneath the manifest root.
5. Prove the root is neither empty, `/`, a home directory, the workspace root,
   nor a Git ancestor/common directory outside the experiment.
6. Compare the root device/inode and experiment ID with `owner.json`.
7. Preserve and hash the evidence bundle outside the deletion candidate only
   if the evidence destination was predeclared and ownership-checked.
8. Remove the exact root without shell globs.
9. Prove the path no longer exists and record teardown completion.

If any ownership, process, listener, mount, or path proof fails, teardown must
not delete the root. It marks the run quarantined and prints the exact retained
path for manual inspection. Symphony itself can recursively remove terminal
workspaces after a best-effort hook, so tracker terminal-state variants must
capture Git evidence before restart
([workspace removal](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workspace.ex#L93-L162),
[ignored hook failure](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workspace.ex#L331-L395)).

## 14. Hard preflight gate

Execution remains blocked until a reviewer signs a generated
`preflight.json` proving all of the following:

- the Symphony checkout is exactly the pinned SHA and clean;
- every fixed-SHA source link in this specification resolves;
- the experiment harness and fake executable are reviewed source files, not
  commands assembled from this prose;
- the fake's initialize/thread/turn transcript passes the pinned app-server
  protocol tests;
- memory tracker bootstrap reproduces A–D after a fresh BEAM;
- runtime supervisor, task supervisor, Orchestrator, application registration,
  logger handler, and any endpoint use unique experiment-derived names;
- the selected start, readiness, Orchestrator-kill, whole-BEAM-kill, graceful
  stop, executor-kill, restart, observation, and teardown actions were executed
  successfully against an idle canary and their exact invocations and
  acknowledgements are recorded;
- C5's Orchestrator suspension barrier proves the worker remains runnable;
- all inherited credentials and proxy variables are absent;
- the only Git remote resolves under the disposable root;
- no non-loopback socket opens;
- resource limits actually terminate a canary that exceeds them;
- teardown deletes a canary root and refuses a mismatched ownership manifest;
- unsupported C1, C6, C7, remote recovery, provider-session expiry, and fake
  week passage cannot accidentally be marked passed; and
- a dry preflight produces no mutation outside its disposable root.

There are intentionally no copy-paste launch or kill commands in this
specification. The common protocol requires exact commands, but inventing them
before the harness exists would turn an unvalidated design into an unsafe
procedure. The generated preflight manifest is the only place those commands
may become executable, after validation against the pinned source. Until then,
the correct status of every C0–C9 row is **not run**.
