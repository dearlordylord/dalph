# Gas Town + Beads crash-experiment specification

**Status:** Prepared only. **Do not execute.**

This document specializes the
[common control-plane crash protocol](../control-plane-crash-experiment-protocol.md)
for:

- Gas Town
  [`649b832b7672bc7a2dbef26f5983aba6198b819b`](https://github.com/gastownhall/gastown/tree/649b832b7672bc7a2dbef26f5983aba6198b819b);
- Beads
  [`0e069115a231c537a83bb77a5106fe7c0efb47f2`](https://github.com/gastownhall/beads/tree/0e069115a231c537a83bb77a5106fe7c0efb47f2).

It is an experiment design, not evidence that an experiment ran. No command in
this document is authorized for execution until the preflight gate is
implemented, reviewed, and passes in full.

## 1. Questions and product boundary

The experiment asks what survives when a Gas Town coordinator or Polecat
process stops between effects owned by Beads, Git, the filesystem, tmux, and a
Git remote. It must not silently attribute a Beads feature to Gas Town.

Two dispatch protocols require separate experiments:

1. **Gas Town scheduled dispatch.** A host-local file lock serializes one
   scheduler cycle. Sling creates or reuses a Polecat worktree, performs a
   generic Beads update to `hooked` with an assignee, and starts a session
   ([scheduler lock and execution](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/capacity_dispatch.go#L152-L258),
   [Sling sequence](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/sling_dispatch.go#L60-L105),
   [hook and start](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/sling_dispatch.go#L373-L425)).
   This is not a durable claim transaction.
2. **Beads-native claim.** `ClaimReadyIssue` changes the durable issue inside a
   transaction, installs a node-local lease, and verifies ambiguous commit
   outcomes by rereading the row
   ([claim and verification](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/dolt/issues.go#L314-L457),
   [claim operation](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/issueops/claim.go#L86-L190)).
   Gas Town's capacity scheduler does not call this operation.

The primary matrix reports Gas Town behavior. A separate Beads qualification
reports what its native claim can guarantee.

## 2. Result vocabulary

Every C0–C9 cell must be labeled one of:

- **Executable:** an existing, reviewed seam reaches the boundary
  deterministically using only disposable local resources.
- **Partial:** a meaningful subcase is executable, while the named ambiguity
  window is not.
- **Source-qualified:** source establishes the order or recovery rule, but no
  safe deterministic fault seam reaches the window.
- **Unsupported:** the pinned product has no reachable production path for the
  behavior.
- **Blocked:** the behavior exists, but execution awaits a small, explicitly
  reviewed test adapter. A timeout or `kill` chosen by observation is not a
  substitute for a deterministic barrier.

“No duplicate observed” is not proof of exactly-once behavior. A scenario
passes only its declared assertions.

## 3. Disposable fixture

### 3.1 Root and manifest

The future runner must create one root with `mktemp -d` and immediately write
an immutable manifest containing:

- canonical root path, owner UID, start time, nonce, and runner PID;
- pinned Gas Town and Beads SHAs and hashes of built binaries;
- every child PID and process group;
- the explicit tmux socket name;
- every listening address and port;
- bare remote, clone, worktree, `.beads`, Dolt, log, FIFO, and evidence paths;
- task IDs, branch names, commit IDs, session names, and cleanup disposition.

All generated paths must be descendants of that canonical root after symlink
resolution. The root must not be `$HOME`, the Dalph workspace, either reference
checkout, a Git common directory outside the fixture, or `/`.

Suggested logical layout (names are fields, not a runnable script):

```text
<root>/
  manifest/
  bin/
  town/
  seed/
  remote/rig.git
  control/
  agent-state/
  evidence/
  logs/
```

### 3.2 Credentials and network

The runner must start from an allowlist environment, not inherit and selectively
delete variables. It must omit GitHub, GitLab, Jira, Linear, SSH-agent, cloud,
package-publishing, and all model-provider credentials. It must set a
fixture-local Git identity and disable credential helpers and interactive Git
prompts. The bare remote must be addressed by a canonical local filesystem
path.

No provider, hosted tracker, package registry, or Internet endpoint may be
contacted. Any Dolt server must bind to loopback on a manifest-recorded free
port; embedded Dolt is preferred. `BEADS_DIR`, all `BD_*` state, XDG/config
paths, and temporary directories must resolve under the root.

### 3.3 Git and task graph

Create a local bare remote and seed repository with target commit `B0`; create
and record later commit `B1` without exposing it until C9. The canonical fake
agent must create all four Git layers from the common protocol:

1. committed `C1`;
2. staged `staged.txt`;
3. unstaged change to tracked `unstaged.txt`;
4. untracked `untracked.txt`;
5. ignored `.agent-local/required-state.json`.

Stash and unresolved-conflict variants are separate runs.

Create Beads tasks A, B, C, and D, with C depending on A and B and D at lower
priority. The CLI shape is `bd dep add C A` for “C depends on A”
([dependency command and semantics](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/cmd/bd/dep.go#L133-L147),
[command arguments](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/cmd/bd/dep.go#L235-L249)).
The setup adapter must capture actual IDs; it must not assume generated IDs.
Use capacity two only after `scheduler.max_polecats` and batch configuration
are verified at the pin
([scheduler commands and flags](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/scheduler.go#L27-L118)).

Beads initialization must be non-interactive, skip hooks and agent-file
modifications, and use an embedded fixture-local Dolt database. Exact `bd init`
flags must be copied from the built pin's `--help` and checked against source;
the available flags are defined here
([init flags](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/cmd/bd/init.go#L2012-L2059)).

### 3.4 Town and rig

The fixture must not install into a well-known Gas Town location. Prefer an
in-package test fixture derived from Gas Town's existing custom-agent
integration setup, which creates a minimal town and rig entirely under
`t.TempDir`
([custom-agent fixture and stub](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/config/integration_test.go#L21-L247)).

If the built CLI is required, preflight may approve only the source-backed
shape `gt rig add <random-rig> <canonical-local-bare-path>`; `quick-add`,
network URLs, adoption of an existing repository, and automatic discovery of
a user town are forbidden
([rig-add command](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/rig.go#L49-L91)).

### 3.5 Fake agent

The existing custom-agent test stub proves that a credential-free executable
can be selected, but it does not implement the common protocol's phase barrier
or Git-layer fixture. Before execution, add a reviewed test-only fake agent
under the experiment fixture. It must:

- accept task, invocation, worktree, log, and control-FIFO paths;
- reject any path outside the fixture root;
- append process, invocation, provider-style session, phase, and continuation
  records using flush-and-fsync;
- perform the common Git mutations and block at named barriers;
- make no network calls and invoke no model CLI;
- have a hard elapsed-time limit and a parent-death/teardown path.

The provider-style session ID is experiment evidence only. It does not prove
Gas Town resumed a real provider conversation.

### 3.6 tmux and process isolation

Set `GT_TMUX_SOCKET` to a unique `gt-crash-<nonce>` value. Gas Town reads that
variable into its session registry, and its tmux wrapper adds `-L <socket>` to
commands
([registry selection](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/session/registry.go#L116-L175),
[tmux invocation](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/tmux/tmux.go#L115-L179)).
Use random town, rig, Polecat, and agent names as defense in depth. Unset
`TMUX`. Every direct observation or cleanup command must name the same socket;
never query, kill, or use the default tmux server. Gas Town's own test pattern
uses a PID-scoped socket and `tmux -L <socket> kill-server`
([isolated tmux test](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/tmux/respawn_hook_test.go#L12-L45)).

Place all child processes in a fixture-owned process group or cgroup. Cap
processes, CPU, memory, file size, open files, disk use, and wall time. Record
PIDs before releasing any start barrier. No kill operation may use a process
name pattern.

## 4. Observation contract

At setup, every barrier, after interruption, after restart, and at convergence,
capture:

- Beads issue JSON, dependencies, events, status, assignee, and hook fields;
- scheduler status/list output and scheduler lock metadata;
- town/rig/Polecat records and exact worktree path;
- `git rev-parse HEAD`, branch, porcelain-v2 status, cached diff, worktree
  diff, untracked files, ignored artifact hash, stash list, worktree list,
  local refs, and remote refs;
- `tmux -L <socket> list-sessions/list-panes` plus pane PIDs and process trees;
- fake-agent append log, session ID, invocation count, and FIFO transcript;
- Witness/daemon/Refinery logs and checkpoint files;
- bare-remote target and task-branch tips;
- exit status, timestamps, and hashes for every observation.

Capture commands must be read-only and individually time-bounded. Raw evidence
is immutable; normalized summaries are derived artifacts.

## 5. Deterministic fault adapters required before execution

Gas Town exposes an in-package hook callback seam, but `executeSling` does not
inject worktree creation or `StartSession`
([dispatch parameters and sequence](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/sling_dispatch.go#L15-L105),
[hook helper](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/sling_helpers.go#L1262-L1335)).
Therefore the full matrix cannot safely run at this pin without reviewed
test-only instrumentation.

Any adapter must be compiled only into an in-package experiment test, use
named before/after barriers around one source boundary, and leave production
code semantics unchanged. Approved barrier names would be:

- `before_hook_write`;
- `after_worktree_before_hook`;
- `after_hook_before_session`;
- `after_session_start_before_return`;
- `after_agent_exit_before_done_observed`;
- `after_branch_push_before_return`;
- `after_target_push_before_return`.

These names describe required seams, not commands that currently exist.
Do not approximate them with polling plus `kill`, shell replacement of `git`,
or a `bd` shim unless that replacement receives a separate code and safety
review. A PATH-level `bd` stub is used in Gas Town tests, but replacing durable
Beads in a reliability run would invalidate the result.

## 6. C0–C9 mapping

| Case | Gas Town mapping at the pin | Status and permitted experiment |
|---|---|---|
| C0 — stop before claim/hook | Stop immediately before the generic hook update, while the scheduler's host-local file lock may be held. | **Blocked.** `scheduler run --dry-run` proves selection without effects, and scheduler tests cover a held dispatch lock, but neither is a crash at the boundary ([lock tests](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/scheduler_dispatch_test.go#L48-L119)). Run only after `before_hook_write` exists. Assert no task is hooked, no worktree/session is leaked, and a later cycle may dispatch it once. |
| C1 — claim applied, response lost | Gas Town has no claim transaction here. Its hook is a generic status/assignee update after worktree preparation. | **Unsupported as a Gas Town native-claim result.** Run the separate Beads qualification in section 7. A future Gas Town `after_hook_before_return` case must be reported as ambiguous hook dispatch, not Beads claim recovery. |
| C2 — worktree created, control record missing | Sling creates/reuses the Polecat worktree before hooking the Bead ([worktree then hook](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/sling_dispatch.go#L235-L258), [hook step](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/sling_dispatch.go#L373-L396)). | **Blocked.** No injectable worktree boundary exists. After adding `after_worktree_before_hook`, assert the exact directory and Git worktree registration, absence/presence of task hook, later reuse versus duplicate creation, and cleanup disposition. |
| C3 — agent started, start response lost | Session start follows hook and agent-field updates. | **Blocked for the ambiguity window. Partial for recovery semantics.** Add `after_session_start_before_return`; assert one live fake agent and whether reconciliation starts another. Witness restart uses a fresh invocation over the existing worktree/hook; `gt session restart` stops then calls `SessionManager.Start` with empty options ([restart](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/session.go#L551-L601)). |
| C4 — full WIP, coordinator stops | Kill only the manifest-owned coordinator after the fake agent reaches `full_wip`; leave the Polecat pane alive. | **Partial.** Executor survival and Witness restart are testable once the fake-agent fixture is reviewed. There is no single durable attempt record. Record all Git layers before and after. Run checkpoint-disabled/not-yet-run and checkpoint-dog subcases separately; see section 8. |
| C5 — agent finishes, result missing | The fake agent exits after writing completion evidence, before Gas Town observes/acts on completion. | **Blocked.** The arbitrary custom agent has no reviewed `gt done`/completion adapter, and no acknowledgment barrier exists. Add `after_agent_exit_before_done_observed`; distinguish clean process exit, task state, hook state, submitted MR, and worktree preservation. |
| C6 — task-branch push accepted, response lost | `gt done` commits and pushes before creating/submitting the MR, and has partial-failure handling ([done ordering](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/done.go#L1381-L1467), [push/MR failure path](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/done.go#L1767-L1901)). | **Source-qualified, blocked for execution.** No accepted-push/failed-return transport seam exists. Add a reviewed local Git transport adapter at `after_branch_push_before_return`. Assert remote ref before retry and whether retry duplicates MR/workflow records. |
| C7 — target update accepted, response lost | Production Refinery processes one MR, runs gates, pushes the target, verifies the pushed commit, and later proves submitted ancestry ([per-MR path](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L520-L766), [post-merge proof](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L1538-L1559)). | **Source-qualified, blocked for ambiguity injection.** Add `after_target_push_before_return` around the local bare remote. Assert target tip/ancestry before retry and final MR/task state. Batch/bisect is explicitly excluded; see section 9. |
| C8 — graceful immediate stop/restart | Gas Town exposes reversible `gt down` and idempotent `gt up`; default down stops infrastructure but not Polecats, while `--polecats`, `--all`, and `--nuke` expand scope ([down semantics](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/down.go#L46-L94), [up semantics](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/up.go#L121-L159)). | **Partial, executable after preflight.** Use default down only; never `--nuke`, `--all`, or `--force`. Observe surviving Polecat and Git state, then use `gt up --restore` only if built help and source confirm restoration for hooked Polecats. Compare provider-style session and invocation IDs. |
| C9 — simulated week plus external drift | Alter fixture timestamps/clock inputs, expose `B1`, expire only native Beads leases using the lease test seam, and restart. | **Partial.** No Gas Town virtual clock or week-advance command exists. Use source-reviewed timestamp manipulation only for files whose reader uses file time. Do not sleep a week. Gas Town hooks have no lease and must not be declared expired. Record whether old worktree, hook, session, checkpoint JSON, and target drift are independently reconciled. |

For graph/capacity assertions, run a non-crash baseline first: A and B may be
dispatched, C may not start until both dependencies close, and eligible D may
wait at capacity two. This establishes fixture validity, not crash safety.

## 7. Separate Beads-native C1 qualification

Use Beads' existing in-package fault-injection tests rather than a Gas Town
scheduler run. They inject commit outcomes and cover:

- commit applied but returned an error, then verified by reread;
- verified rollback followed by exactly one replay;
- a false-success defense;
- a second ambiguous outcome that remains bounded.

The seam and assertions are already present
([claim verification tests](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/dolt/claim_verify_test.go#L13-L157)).
Run those tests only from the pinned Beads checkout with fixture-local Go
caches after the execution gate approves the exact test selector.

Also qualify concurrency, idempotency, anti-steal, heartbeat, and reclaim using
the storage conformance suite
([claim conformance](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/conformance/claim.go#L13-L260)).
The default five-minute lease is node-local, not a durable global fencing
token
([lease defaults](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/issueops/lease.go#L18-L69),
[node locality](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/issueops/lease.go#L110-L150)).
Use the conformance clock/TTL seam for expiry; do not wait in real time.

Report these results under “Beads-native claim,” never “Gas Town scheduler.”

## 8. Witness restart, provider identity, and Git layers

### 8.1 Fresh process is not provider resume

Witness/session recovery can start a new process over the same hook and
worktree. The normal session manager constructs a startup command and beacon
([session construction](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/polecat/session_manager.go#L319-L431));
the generic restart path passes no provider session ID. Therefore record:

- same or changed Polecat/worktree;
- same or changed fake provider-style session ID;
- invocation count;
- received continuation/beacon text;
- whether the earlier process was proven dead.

A changed session ID with preserved worktree is **fresh-session continuation**,
not exact provider resume. Gas Town does have provider-specific resume paths,
including quota rotation with a known session ID
([quota resume](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/quota/executor.go#L174-L208)),
but an arbitrary credential-free custom agent does not prove those paths. The
Claude-specific `--continue` handoff must not be spoofed as a fake Claude CLI
([handoff path](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/handoff.go#L822-L896)).
Exact provider-session restoration is **unsupported by this credential-free
fixture** at the pin.

### 8.2 Checkpoint-dog transformations

Capture the five canonical Git layers before any checkpoint dog cycle.
Run these subcases independently:

1. **No checkpoint cycle:** a stopped coordinator or restarted Witness must
   preserve committed, staged, unstaged, untracked, and ignored state exactly
   if it reuses the directory.
2. **One deterministic checkpoint cycle:** use a reviewed in-package daemon
   test seam; there is no `gt checkpoint` command. The dog runs `git add -A`,
   unstages runtime artifacts and tracked deletions, then commits the remaining
   staged content as `WIP: checkpoint (auto)`
   ([checkpoint transformation](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/daemon/checkpoint_dog.go#L128-L190)).
   Thus ordinary staged, unstaged, and untracked content may move into a
   checkpoint commit; tracked deletion and runtime artifacts remain outside
   it. That is preservation with a deliberate layer transformation, not exact
   index restoration. Existing tests prove nested runtime changes remain
   unstaged and unlost
   ([runtime-artifact test](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/daemon/checkpoint_dog_test.go#L211-L289)).
3. **Stash:** create a branch-specific stash, capture the shared stash ref and
   branch reachability, then restart. Do not combine with the base layer case.
4. **Conflict:** create an unresolved conflict. Expect checkpoint commit
   failure unless source/test evidence says otherwise; verify that restart
   neither erases nor silently commits conflict stages. Do not run ordinary
   `gt done` as if this were a clean worktree.

Hash every file and capture index stages. A clean porcelain summary alone is
insufficient.

## 9. Refinery, merge slot, and absent batch behavior

C7 must exercise only the reachable per-MR Refinery path. Although
`ProcessBatch` and bisection are implemented and tested, no production caller
was found at the pin
([batch implementation](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/batch.go#L202-L305)).
Batch/bisect is therefore **unsupported as a production crash experiment** and
must not be invoked directly then described as product behavior.

Record the merge slot separately. Its implementation reads the slot Bead,
checks the holder, then performs a generic update; it is not an atomic CAS,
lease, or fenced lock
([merge-slot acquire/release](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/beads/beads_merge_slot.go#L98-L201)).
A direct in-package storage test may source-qualify duplicate-acquirer or stale
holder behavior, but cannot substitute for the per-MR accepted-push ambiguity
case. There is no TTL-based “week later” recovery to assert.

## 10. Preflight: mandatory all-or-nothing gate

An independent reviewer must approve a generated preflight report before any
fault process starts. The report must prove:

1. `git rev-parse HEAD` equals both pinned SHAs and working trees contain no
   experiment modifications.
2. Every intended CLI token is present in built `--help` and matches the cited
   source. Commands not validated are removed, not guessed.
3. The town finder resolves exactly the fixture town; rig and all Git common
   directories resolve under the root.
4. `BEADS_DIR`, Dolt data, configs, caches, temp paths, logs, and fake-agent
   state resolve under the root.
5. The bare remote contains only fixture refs and every configured remote URL
   is a canonical local path.
6. The allowlist environment contains no credentials, SSH agent, proxy, or
   provider executable selection.
7. DNS/network probes from the test process are blocked; any listener is
   loopback-only and manifest-owned.
8. `GT_TMUX_SOCKET` is unique; the default socket is never queried; no session
   exists on the experiment socket before setup.
9. Fake-agent command expansion, phase barriers, fsync behavior, path guards,
   and hard timeout pass unit tests.
10. Every C-case barrier is reachable in a focused test. Cells without a
    validated barrier remain blocked/source-only.
11. Resource limits, process-group ownership, disk budget, and global elapsed
    timeout are active.
12. Observation commands are read-only, bounded, and write only below
    `evidence/`.
13. Teardown dry-run lists only manifest-owned PIDs, socket, listeners, and
    paths.
14. The canonical graph and capacity-two non-crash baseline passes.
15. Evidence retention has enough disk space and cleanup cannot follow
    symlinks.

One failure blocks all destructive scenarios. Preflight must not “warn and
continue.”

## 11. Execution order after future approval

If and only if preflight passes:

1. run the non-crash baseline;
2. run Beads-native qualification in its own fixture;
3. run each executable Gas Town case in a newly created root;
4. run checkpoint, stash, and conflict variants in separate roots;
5. never reuse a database, town, tmux socket, Polecat, worktree, or bare remote
   between cases;
6. stop after the first ownership, containment, credential, or observation
   failure;
7. produce a per-case evidence hash and immutable manifest before teardown.

No case may exceed its wall-time cap. A blocked or unsupported cell stays
empty; it is not filled by a nondeterministic manual attempt.

## 12. Teardown and ownership proof

Teardown is fail-closed:

1. stop only manifest-recorded PIDs after verifying PID start time, UID,
   executable, process group, and fixture path;
2. terminate the unique tmux server only with its exact
   `tmux -L <manifest-socket> kill-server` command;
3. stop only the listener whose PID and data directory match the manifest;
4. reread process trees, socket sessions, open files, listeners, Git worktree
   registrations, and mount points;
5. remove the root only if its canonical path equals the manifest root, its
   nonce marker matches, it is not a Git common directory outside itself, and
   no non-owned process has an open file or working directory inside;
6. otherwise retain the full root and report its path and reason. Do not broaden
   a kill or deletion target to force cleanup.

The cleanup operation must never delete a user town, reference checkout, Dalph
workspace, default tmux server, shared Dolt server, or user cache.

## 13. Required report shape

For each case, publish:

- exact pins, fixture manifest hash, adapter hash, and preflight result;
- status vocabulary label and interruption target;
- chronological boundary events;
- before/after/restart/converged state across Beads, Git, tmux/process, fake
  provider, worktree, and remote;
- graph/capacity behavior;
- duplicate starts, hooks, worktrees, commits, pushes, MRs, or integrations;
- preservation or transformation of each Git layer;
- same-session resume versus fresh-session continuation;
- authoritative rereads and any indeterminate result;
- teardown proof or retained evidence path.

The combined conclusion must keep four claims independent:

1. Gas Town file-locked scheduled hook dispatch;
2. Beads-native transactional leased claim;
3. Witness/Polecat process restart and workspace preservation;
4. per-MR Refinery integration.

No passing result in one layer upgrades another layer's guarantee.
