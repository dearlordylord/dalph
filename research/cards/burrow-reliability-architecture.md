# Burrow reliability architecture card

## 1. Scope, pin, and evidence boundary

This card audits Burrow as Warren's local execution dependency under the agreed
assumption that **one Burrow coordinator owns a data directory at a time**.
It does not assess overlapping coordinators as a supported deployment.

- Repository: `jayminwest/burrow`
- Release: `v0.3.15`
- Commit: `c19c475fb915ab28f790d9f80485d98197dd0a7a`
- Audit method: documentation was treated as a claim and checked against
  reachable production source and tests. No destructive experiment was run and
  the reference checkout was not edited.
- Confidence boundary: this is a static source audit. Kernel behavior,
  week-long drift, power-loss durability, and sandbox escapes were not tested.

Burrow's README promises OS isolation, durable state, `kill -9` recovery, and an
archived event log on destroy
([README](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/README.md#L50-L58)).
The source supports a narrower interpretation: a restart retains SQLite rows and
workspaces, fails interrupted runs, resets selected messages, and requeues runs
that had not been claimed. It does **not** adopt a live agent process or reconstruct
an agent's in-memory context
([recovery.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/db/recovery.ts#L1-L35)).

## 2. Plain-language architecture

A person asks Warren to run a coding agent locally. Warren asks Burrow to create
a named workspace, then creates a run. Burrow records the burrow and run in
SQLite, admits the run through an in-process queue, starts a fresh agent CLI in a
Linux Bubblewrap or macOS Seatbelt sandbox, parses the process's output into
SQLite events, and marks the run terminal when the process exits.

The durable center is SQLite plus the Git-backed filesystem workspace. The
scheduler, subprocess handles, PIDs, output readers, restricted-network proxy,
sidecars, and preview forwarders are process-local. A restart therefore restores
records and queued intentions, but it does not restore the same execution.

The main layers are:

1. CLI/HTTP/client surfaces create burrows, runs, messages, and lifecycle calls.
2. SQLite repositories own durable burrow, run, event, and inbox records.
3. The dispatcher and run loop own admission and per-burrow ordering.
4. An agent runtime turns a run into a runtime-specific command and parser.
5. the local provider owns the Git workspace and OS sandbox process.
6. Event polling reconstructs durable output; the in-memory bus only accelerates
   live delivery.

This is a useful local execution substrate, not a durable workflow engine with
process/session adoption.

## 3. State-owner table

| Phenomenon | Owner at this commit | Durable representation | Restart meaning |
|---|---|---|---|
| Burrow identity and lifecycle | Burrow SQLite | ID, parent, kind, paths, branch, provider state/profile, state and timestamps | Reopened from SQLite |
| Workspace contents | Git and filesystem | Worktree/clone on disk; some source metadata in SQLite | Left in place unless destroy removed it |
| Exact starting revision | Git at materialization time | **Not recorded as a SHA** | Must be inferred later, and can drift |
| Run intent and outcome | Burrow SQLite | prompt, agent ID, optional predecessor, state, result metadata | Queued runs replay; running runs become failed |
| Parsed agent output | Burrow SQLite events | per-burrow sequence, kind, stream, JSON payload, timestamp | Replayable after the last durable sequence |
| Agent context/session | Runtime-specific agent files and optional run metadata | No generic Burrow session object | At best runtime-specific explicit resume; never process adoption |
| PID, process group, PTY | Burrow process | `SpawnResult` only | Lost |
| Scheduler capacity | Burrow process | in-memory queues and counters | Recreated with default/configured limit |
| Sidecar and preview logs | Burrow process | in-memory registry and bounded ring buffers | Lost |
| Event archive | Files under Burrow storage | JSONL/JSON files created during destroy | Survives independently; no retention policy |

The schema substantiates both the durable fields and the absences: runs contain
no PID, PTY, process group, host boot identity, lease, or sandbox locator, and
burrows contain a branch name but no base SHA
([schema.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/db/schema.ts#L31-L94)).

## 4. Scheduling and capacity

When a run is inserted, one in-process `PQueue` admits it. Runs for the same
burrow pass through another queue with concurrency one; different burrows may
run concurrently, with a default global cap of eight
([run-loop.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/runner/run-loop.ts#L1-L13),
[run-loop.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/runner/run-loop.ts#L49-L63)).
A transactional queued-to-running claim prevents the same run ID from executing
twice after duplicate enqueue attempts
([runs.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/db/repos/runs.ts#L142-L159)).

What this guarantees under one coordinator:

- FIFO execution within one burrow.
- At most one active run per burrow in this process.
- A process-wide maximum number of concurrently driven burrows.
- A queued run left in SQLite is rediscovered on startup
  ([run-loop.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/runner/run-loop.ts#L65-L90)).

What it does not durably guarantee:

- Capacity reservations, leases, or fairness across restarts.
- Per-project, per-agent, per-provider, per-host, CPU, or memory admission.
- Preservation of queue position across a process restart beyond the repository
  query's ordering.
- Adoption of capacity already consumed by a surviving orphan process.

Sidecars have a separate per-burrow cap of four by default, but their registry,
PID, and bounded logs are intentionally in memory; the source explicitly assigns
restart reconstruction to Warren
([sidecars.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/server/sidecars.ts#L1-L26),
[sidecars.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/server/sidecars.ts#L190-L224)).

## 5. Restoration layers

Burrow restores different layers with materially different strength:

| Layer | Restoration behavior |
|---|---|
| SQLite connection | WAL, foreign keys, busy timeout, and normal synchronous mode are configured; this is database durability, not effect reconciliation |
| Burrow row | Reopened with its stored paths, branch, provider state, and sandbox profile |
| Queued run | Re-enqueued and may execute |
| Running run | Marked failed with `process exited unexpectedly`; never resumed automatically |
| Delivered message to a nonterminal/orphan run | Reset to unread for later delivery |
| Workspace | Assumed to remain at the stored path |
| Agent process | Not found or adopted |
| Sidecar/forwarder | Forgotten; Warren is expected to recreate it |
| Live event subscription | Replaced by polling SQLite with a caller-supplied cursor |

SQLite uses WAL and `synchronous=NORMAL`
([client.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/db/client.ts#L38-L80)).
That is a reasonable local database configuration, but it does not make
workspace creation, process spawn, output observation, Git mutation, archive
creation, and row updates one atomic transaction.

## 6. Immediate restart

Immediately after the coordinator dies:

1. On Linux, the main Bubblewrap command includes `--die-with-parent`; this
   improves cleanup when the parent disappears
   ([bwrap.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/provider/local/bwrap.ts#L55-L79)).
   On macOS the wrapper uses `sandbox-exec` and cancellation calls
   `proc.kill()`; no durable process-group ownership is recorded
   ([sandbox.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/provider/local/sandbox.ts#L46-L100)).
2. The next Burrow process resets delivered messages first and then marks every
   `running` row failed. That ordering prevents a message from remaining attached
   to a newly failed run
   ([recovery.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/db/recovery.ts#L26-L35)).
3. It enqueues rows still in `queued`.
4. It does not inspect `/proc`, the workspace, agent session files, cgroups, Git
   state, or sidecars.

Thus “recoverable after `kill -9`” means that durable records and workspaces
remain inspectable and unclaimed work continues. The interrupted run is a failed
attempt, not the same adopted attempt.

There is also a last-observation gap: output is parsed from process streams and
then appended to SQLite. If the agent performed an effect or emitted output
before the coordinator persisted the corresponding event, the effect may exist
without a durable Burrow observation
([dispatch.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/runner/dispatch.ts#L336-L430)).

## 7. Restart after a week or external drift

After a week, Burrow still trusts stored paths and names. `attach` changes a
stopped row to active but does not verify that the workspace exists, is the same
worktree, points at the expected Git common directory, has the expected branch
checked out, or retains the same filesystem isolation prerequisites
([attach.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/cli/commands/attach.ts#L1-L48)).

Consequences of external drift include:

- A missing workspace can be reported active until the next boundary call fails.
- A branch can move, be deleted, or be checked out elsewhere.
- The parent clone or `.git` common directory can move.
- Runtime binaries, credentials, host mounts, and sandbox support can change
  after the profile was stored.
- A prior runtime session token can refer to expired, deleted, or incompatible
  external state.
- Old sidecars are neither proven dead nor adopted; their registry is gone.

There is no reconciliation loop that distinguishes “same resource,” “missing,”
“replaced,” and “ambiguous.” Warren must perform that check before treating a
week-old LocalProvider attachment as usable.

## 8. Git starting point, all Git layers, and integration implications

For a host clone, Burrow creates a new branch and worktree from a **branch name**,
defaulting to `main`. `git worktree add -b <new> <path> <baseBranch>` resolves the
base at command time
([workspace.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/provider/local/workspace.ts#L90-L108),
[worktree.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/git/worktree.ts#L54-L73)).
The resulting commit is not saved as an exact planned Base SHA. A task fork
likewise uses the parent's branch name, not a recorded revision
([fork.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/cli/commands/fork.ts#L47-L113)).

Git-layer behavior:

| Git layer | While the burrow exists | On forced worktree destroy |
|---|---|---|
| `HEAD` / checked-out branch | Per-worktree | Worktree removed; branch deletion attempted with `-D` |
| Index | Per-worktree metadata in Git common dir | Removed with the worktree |
| Working-tree modifications | Workspace filesystem | Deleted |
| Untracked and ignored files | Workspace filesystem | Deleted |
| Conflicts and in-progress operation files | Worktree/workspace metadata | Deleted |
| Commits and objects | Shared object database for worktrees | Objects may remain reachable through other refs/reflogs; Burrow does not promise retention |
| Branch ref | Shared common dir | Force-deletion attempted; failure is swallowed |
| Tags and other refs | Shared common dir | Not specifically removed |
| Stash | Repository-shared refs/object database | Not modeled as burrow-owned and not archived |
| Reflogs and unreachable objects | Git-owned | Subject to Git's later GC policy, not Burrow's |
| Fresh-clone `.git` | Inside clone workspace | Entire clone is recursively removed |

The sandbox deliberately mounts the worktree's Git common directory read-write,
so an agent can update per-worktree HEAD/index and shared objects and refs
([workspace.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/provider/local/workspace.ts#L42-L63)).
This enables ordinary Git work, but it also means the isolation boundary includes
a shared repository authority, not just an isolated working directory.

Removal defaults to force, recursively removes stale workspace paths, and then
force-deletes the branch best-effort
([workspace.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/provider/local/workspace.ts#L179-L219)).
Burrow's event archive is therefore not a Git backup. It does not preserve
unstaged changes, staged changes, untracked files, index state, conflicts,
runtime session files, or a self-contained object database.

There is a reachable clone-fallback mismatch worth testing before relying on it:
`up` normally generates a new `burrow/<id>` branch
([up.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/cli/commands/up.ts#L158-L182)),
while the fallback passes that generated name directly to `git clone --branch`
([workspace.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/provider/local/workspace.ts#L249-L274),
[worktree.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/git/worktree.ts#L117-L130)).
A fresh remote would not normally contain that generated branch.

## 9. Code organization: layers and slices

The code is organized by technical layer:

- `core` defines records and typed application errors.
- `db` and its repositories implement durable state transitions.
- `events` implements append, live publish, poll/replay, and archive.
- `runner` implements admission, dispatch, stream parsing, and finalization.
- `runtime` adapts Codex, Claude Code, Pi, Sapling, and declarative agents.
- `provider/local` implements workspace, sandbox, cgroup, and network mechanics.
- `git` wraps Git subprocess calls and identity/worktree operations.
- `lib` composes the client and lifecycle operations.
- `server` exposes HTTP, admin drain, sidecars, files, and event surfaces.
- `cli` performs operator workflows such as up, prompt, attach, fork, and destroy.

The useful slice is “run”: a durable run row flows through repository claim,
in-memory admission, runtime command construction, sandbox spawn, event append,
and terminal finalization. However, create/destroy and dispatch cross filesystem,
Git, process, archive, and SQLite boundaries without a durable effect journal.
The layers are clear; the ambiguity-crossing workflows are not modeled as
reconcilable state machines.

## 10. Production, test, fake, and dry-run seams

Production uses Bun subprocesses, native filesystem calls, Git commands,
Bubblewrap or Seatbelt, SQLite, and real sockets. It is direct TypeScript
composition rather than an effect/service layer.

There are numerous useful injection seams:

- Dispatcher accepts alternate spawn, proxy, and install-check functions.
- Workspace creation accepts a materializer.
- Sidecars accept alternate spawn and forwarder functions.
- Network forwarding accepts listener and relay-spawner functions.
- Repositories support in-memory SQLite.
- Tests use fake runtimes and streams.

The cross-process dispatcher test starts a real server subprocess and verifies
that an HTTP-created run reaches a terminal state through SQLite WAL, but uses a
fake no-op agent and graceful `SIGTERM`
([dispatcher-cross-process.test.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/server/dispatcher-cross-process.test.ts#L1-L17),
[dispatcher-cross-process.test.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/server/dispatcher-cross-process.test.ts#L143-L191)).

No production dry-run interpreter was found. `doctor` is a preflight and is
deliberately run before workspace side effects, but it is not a simulation of
create, run, finalize, archive, or cleanup
([up.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/cli/commands/up.ts#L120-L141)).

## 11. Verification inventory

At the pinned commit, the package exposes Bun tests, TypeScript checking, Biome,
duplicate/dependency/size/debt/coverage ratchets, CI-parity checking, and a
combined verification script
([package.json](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/package.json#L25-L42)).
The source tree contains 102 `*.test.ts` files.

Strongest relevant verification found:

- Repository state-transition tests, including startup recovery.
- Run-loop tests for requeue, claim, concurrency, drain, and finalization.
- Real temporary-Git-repository tests for worktree operations.
- Sandbox argument/profile and resource-control unit tests.
- Parser golden fixtures and event replay tests.
- HTTP and one graceful cross-process dispatcher test.
- Archive and destroy-path tests.

Important absences:

- No property-based testing library or property suite was found.
- No formal specification/model checker (Quint, TLA+, Alloy, etc.) was found.
- No crash matrix kills the coordinator at every ambiguity boundary.
- No power-loss/SQLite durability experiment was found.
- No week-long adoption/drift test was found.
- No kernel-level isolation or escape suite was found.
- No test proves descendant/process-group cleanup on both platforms.
- No test proves exactly-once persistence of externally visible agent effects.
- The cross-process test is graceful shutdown, not `SIGKILL`.

The recovery unit test confirms exactly the narrow sweep: running becomes failed,
delivered becomes unread, and destroyed rows are pruned
([recovery.test.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/db/recovery.test.ts#L17-L65)).

## 12. Chronological failure table

| Concrete event | Durable fact at failure | Restart/result | Ambiguity or forbidden outcome |
|---|---|---|---|
| Git worktree/branch is created, then Burrow row insertion fails | Workspace and branch may exist; no row necessarily exists | Startup has no row from which to reconcile it | Orphan workspace/branch |
| Run row is inserted, coordinator dies before enqueue/claim | `queued` | Startup re-enqueues it | Safe under one coordinator |
| Run is claimed, coordinator dies before spawn | `running` | Startup marks it failed | It may never have executed, but is indistinguishable from an interrupted execution |
| Process starts, coordinator dies before PID/session metadata is saved | `running`; no durable process locator | Run becomes failed; no adoption | Process/descendants may be ambiguous, especially outside Linux parent-death behavior |
| Agent changes files or performs a network/Git effect, then coordinator dies | Effect may exist; run still `running` | Run becomes failed | Retrying can duplicate non-idempotent effects |
| Output is read, coordinator dies before SQLite append | No corresponding event | Output is lost | “Full event log” is only full for successfully persisted parser output |
| SQLite event append succeeds, coordinator dies before in-memory publish | Event exists | Poll/replay recovers it | A live-only subscriber can miss it until replay |
| Steering text is written to stdin, coordinator dies before message is marked delivered | Message may remain/reset unread | Later run may deliver it again | At-least-once message delivery; duplicate instruction |
| Process exits successfully, coordinator dies before metadata extraction/finalize | Run remains `running` | Run becomes failed | Successful work may be reported failed; session token may be lost |
| Destroy removes workspace, then archive fails | Workspace is gone; live DB data remains | Retry cannot reconstruct Git/filesystem state from events | Destructive effect precedes durable archival success |
| Archive succeeds, child-row prune succeeds, process dies before `markDestroyed` | Active/stopped row can remain without runs/events/messages | Retry can archive an empty history | Lifecycle and archive are split across transactions |
| Workspace removal fails but is swallowed, archive/prune succeeds | Orphan workspace/branch may remain | Burrow can disappear from SQLite later | Cleanup reports completion without exact resource disposition |

The create gap is reachable because `up` materializes the workspace before
inserting the burrow row, with no surrounding compensating transaction
([up.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/cli/commands/up.ts#L158-L182),
[up.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/cli/commands/up.ts#L224-L241)).
Destroy likewise removes the workspace before archive, swallows removal errors,
and then proceeds
([destroy.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/lib/destroy.ts#L1-L15),
[destroy.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/lib/destroy.ts#L48-L104)).

## 13. Maintenance risks

1. **Documentation overstates recovery.** “Recoverable after `kill -9`” can be
   read as process/session continuation; the implementation terminalizes the
   run.
2. **No exact base identity.** Branch names are stored where Warren needs a
   planned Base SHA.
3. **No durable effect protocol.** Workspace create, spawn, event observation,
   finalize, destroy, and archive have crash windows without intent/observation
   records.
4. **Runtime-specific resume is uneven.** Codex explicitly does not support
   resume and writes only a prompt file
   ([codex.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/runtime/codex.ts#L1-L13),
   [codex.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/runtime/codex.ts#L34-L63)).
   Claude Code declares resume support but supplies no reachable
   `extractMetadata` implementation, while dispatch only persists metadata
   through that optional hook; a requested resume can therefore degrade to a
   fresh process when the prior token is absent
   ([runtime.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/runtime/runtime.ts#L135-L159),
   [dispatch.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/runner/dispatch.ts#L384-L430)).
5. **Linux restricted networking is not a hard allowlist.** The sandbox shares
   the host network and supplies a proxy; the source itself notes that tools
   which ignore the proxy can bypass the domain policy
   ([bwrap.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/provider/local/bwrap.ts#L18-L27)).
6. **Resource limits can silently degrade.** Linux cgroup setup is best-effort
   and can fall back to unlimited execution
   ([cgroup.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/provider/local/cgroup.ts#L1-L24)).
7. **Archive is not a snapshot.** It contains rows/events/messages, not the
   filesystem, Git index, object reachability, or agent session directory
   ([archive.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/events/archive.ts#L1-L20)).
8. **Sidecars are an explicitly split authority.** Burrow owns the live process,
   but Warren is expected to own restart reconstruction. Without a shared
   generation/idempotency protocol, restart can leak or duplicate previews.
9. **No PTY ownership model.** Agent runs use piped streams; no PTY locator,
   terminal state, process group, or adoption contract is persisted.
10. **Per-burrow sequence has an application invariant, not a unique database
    constraint.** Append computes `MAX(seq)+1` inside a transaction under the
    single-writer assumption, while the schema only defines an index
    ([events.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/db/repos/events.ts#L1-L59),
    [schema.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/db/schema.ts#L76-L94)).

## 14. Ideas Dalph should consider

- Record the exact planned Base SHA before workspace creation, and verify the
  created worktree's `HEAD` afterward.
- Give every ambiguity-crossing effect a durable intent, expected resource
  identity, observation, and reconcile-before-retry transition.
- Treat run attempt, agent session, process incarnation, sandbox, and worktree as
  distinct branded identities.
- Persist a process incarnation only if the executor can prove adoption using
  PID plus host boot/process-start identity, cgroup/process group, and runtime
  session locator; otherwise make “fail old attempt and create a new attempt”
  explicit.
- Make cleanup disposition-typed: removed, already absent, retained for
  recovery, identity mismatch, or ambiguous. Do not swallow workspace failure
  and report destroy as complete.
- Snapshot or commit the required Git layers before destructive cleanup. An
  event archive should not be represented as a worktree backup.
- Use a durable admission record if capacity must survive restart; keep task,
  execution, integration, and sidecar capacities separate.
- Define cursors as `(burrow ID, sequence)` and do not infer a global total order
  from timestamps. `tailAll` merges per-burrow streams by timestamp and tie
  breakers, not by one durable global ordinal
  ([poll.ts](https://github.com/jayminwest/burrow/blob/c19c475fb915ab28f790d9f80485d98197dd0a7a/src/events/poll.ts#L59-L94)).
- Require an explicit runtime session capability: fresh-only, resumable by token,
  adoptable process, or replayable transcript. Do not collapse these meanings
  into “resume.”
- Build production, fake, test, and dry-run interpreters for the same workflow
  algebra so ambiguity behavior is testable without real destructive effects.
- Add property tests for state transitions, model-check admission/finalization/
  cleanup, and run a crash-injection matrix after every durable and external
  boundary.

## 15. Unknowns and negative search

The pinned source does not establish:

- That Linux restricted networking enforces the domain allowlist against a
  malicious or merely non-proxy-aware child.
- That macOS cancellation kills every descendant or prevents processes from
  escaping the sandbox wrapper's lifetime.
- That `--die-with-parent` plus best-effort cgroup cleanup closes every Linux
  descendant/process race.
- That a configured sandbox timeout is enforced in the local spawn path; the
  profile stores `timeoutMs`, but no corresponding timer was found in
  `runSandboxed`.
- How external Git GC, reflog expiry, branch protection, hooks, LFS, submodules,
  credentials, and concurrent human Git operations affect week-old worktrees.
- Any retention, rotation, integrity manifest, or garbage collection policy for
  archive directories.
- Exactly how Warren detects and safely recreates forgotten sidecars without
  duplication.
- Whether runtime-owned session files remain usable after runtime upgrades or
  credential/model changes.
- Any end-to-end guarantee that every externally visible effect has a matching
  durable event.

Negative searches found no `node-pty`/PTY implementation, process-group/session
ownership, property-testing framework, formal model, or `SIGKILL` crash suite in
the production source and tests. These are evidence absences, not proof that
operating-system behavior is unsafe.

## 16. Technical and user-visible consequences, including Warren supplement

For a user, Burrow gives a practical isolated Git workspace, serial execution
inside that workspace, persisted parsed output, and inspectable records after a
coordinator restart. The user should expect an interrupted local run to become a
failed attempt. They should **not** expect the same Codex process, agent context,
terminal, sidecar, or exact queue/capacity state to continue.

For Warren, “LocalProvider succeeded” must not mean “Burrow durably owns every
execution fact.” Warren's separate post-call attachment writes add another
ambiguity window around Burrow's own create/run/finalize windows. A retry should
first query Burrow by a durable idempotency/resource identity; the audited API
and schema do not supply a complete such protocol.

### Warren LocalProvider unknowns resolved by this source

| Warren question | Resolution at Burrow `v0.3.15` |
|---|---|
| What is the sandbox? | Linux uses Bubblewrap with namespace isolation, explicit mounts, and `--die-with-parent`; macOS uses Seatbelt. The workspace and, for worktrees, Git common directory are writable. |
| Is restricted networking a hard domain firewall? | No on Linux: it shares host networking and relies on proxy-aware clients. |
| What survives a coordinator restart? | SQLite burrow/run/event/message records, archive files already written, and whatever remains in the workspace/Git filesystem. |
| Is every running process adopted? | No. Every `running` row is failed; no durable PID/PTY/process locator exists. |
| Is a Codex Agent Session/context restored? | No. The built-in Codex runtime is fresh `codex exec` per run and declares `supportsResume: false`. |
| Are events replayable? | Persisted events are replayable after a per-burrow sequence cursor. The in-memory bus is best-effort, and there is no durable global ordering across burrows. |
| Are sidecars durable? | No. Their PIDs, state, and bounded logs are in memory; Warren is explicitly expected to respawn them. |
| Which Git state is preserved while live? | The full worktree filesystem and Git worktree/common-dir state remain on disk. |
| Which Git state is archived on destroy? | None as a Git/filesystem snapshot. Only Burrow's run/event/message audit files are archived. |
| What is the capacity model? | One run per burrow, global process-local concurrency default eight, plus a separate process-local sidecar cap default four. |

### Warren LocalProvider unknowns that remain

- Whether every child and descendant is gone after abrupt termination on each
  supported OS.
- Whether an old workspace is the same resource and still based on the intended
  exact commit after days or external Git changes.
- How Warren and Burrow jointly reconcile “Burrow created it but Warren did not
  record the ID,” “process ran but finalize was not observed,” and “sidecar
  exists but its registry was lost.”
- How to retain or recover staged, unstaged, untracked, conflict, session-file,
  reflog, and unreachable-object layers before forced destroy or later Git GC.
- What archive retention and integrity policy production should use.
- Whether runtime-specific Claude Code or Pi resume metadata is present, current,
  and semantically the same agent context after a failure.
- Whether cgroup limits, timeout, proxy policy, and mount isolation were actually
  enforced for a particular attempt rather than merely requested.
- What idempotency key and authoritative lookup Warren can use before repeating
  create, run, finalize, preview, or destroy.

The architectural bottom line is that Burrow resolves Warren's **local sandbox
mechanics and durable observation store**, but not Warren's **durable attempt,
agent-session, exact-Git-lineage, adoption, or reconcile-before-retry protocol**.
