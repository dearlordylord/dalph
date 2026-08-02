# Gas Town + Beads reliability architecture card

## 1. Scope, pins, and evidence boundary

This card audits the combined Gas Town control plane and its Beads state
substrate. It is based only on:

- Gas Town commit
  [`649b832b7672bc7a2dbef26f5983aba6198b819b`](https://github.com/gastownhall/gastown/tree/649b832b7672bc7a2dbef26f5983aba6198b819b);
- Beads commit
  [`0e069115a231c537a83bb77a5106fe7c0efb47f2`](https://github.com/gastownhall/beads/tree/0e069115a231c537a83bb77a5106fe7c0efb47f2).

The evidence boundary is source, manifests, tests, migrations, and design
documents at those pins. No live system was installed and no destructive
failure experiment was run. “Gas Town does X” below means a reachable Gas Town
path was found. “Beads can do X” does not imply that Gas Town uses that
primitive.

The most important boundary is the last one. Beads has a transactional,
lease-backed `in_progress` claim operation. Gas Town's capacity scheduler does
**not** use it. Gas Town discovers ready work, serializes one host's dispatch
cycle with a file lock, creates or reuses a Polecat worktree, and then records a
`hooked` status and assignee through a generic `bd update`
([scheduler cycle](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/capacity_dispatch.go#L152-L237),
[sling sequence](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/sling_dispatch.go#L74-L105),
[hook write](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/sling_dispatch.go#L373-L425)).
The two mechanisms therefore need separate reliability judgments.

## 2. Plain-language architecture

Gas Town is a local, multi-agent orchestration environment organized as a
“town” containing one or more repositories, called rigs. A Mayor coordinates
the town; a Deacon and Boot provide background supervision; each rig has a
Witness that watches workers and a Refinery that integrates completed work.
Polecats are reusable worker identities with repository worktrees, while Crew
workspaces are human-oriented and persistent. The role split and the
town/rig hierarchy are explicit in the architecture document
([roles](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/docs/design/architecture.md#L62-L80),
[two-level Beads layout](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/docs/design/architecture.md#L82-L171)).

Beads is the durable graph and coordination database. At this pin its primary
storage interface covers issue lifecycle, dependencies, ready-work queries,
comments, events, and optimistic-concurrency operations; Dolt is the concrete
versioned backend behind that interface
([storage contract](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/storage.go#L90-L170)).
Gas Town normally talks to Beads by executing the `bd` CLI, so its end-to-end
transactions stop at the process boundary rather than spanning Beads, Git,
filesystem setup, and tmux.

The product is consequently a federation of authorities rather than one
database:

- Beads owns task graph and agent/workflow records.
- Git owns branches, commits, index and worktree facts.
- tmux plus operating-system process inspection owns live-session facts.
- JSON/runtime files hold supplementary checkpoints, heartbeats, cooldowns,
  PID identities, and respawn counters.
- The remote Git server owns the accepted target tip and pushed branches.

That federation is a genuine control plane. It schedules bounded work, creates
isolated execution environments, monitors agents, recovers dead sessions, and
serializes integration. It is also only partially transactional: many
operations cross these authorities in a deliberate order and then reconcile
or compensate on failure.

## 3. State-owner table

| Fact | Authority at this pin | Derived or duplicate observations | Reliability consequence |
|---|---|---|---|
| Work identity, status, assignee, dependency graph | Beads issue rows and dependency rows | Gas Town agent beads, hook fields, sling-context beads and mail refer to work IDs | Durable and queryable, but Gas Town's hook protocol is a multi-write convention rather than one atomic attempt record ([hook sequence](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/sling_dispatch.go#L373-L425)). |
| Atomic Beads worker claim | Durable issue `status=in_progress` and `assignee`; claim event in the same SQL/Dolt transaction | Node-local ephemeral lease row | Beads can reject concurrent claimants and verify an ambiguous commit by rereading the durable row ([claim transaction](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/dolt/issues.go#L314-L389)). Gas Town scheduling does not use this claim. |
| Beads claim liveness | Ephemeral lease row on the granting node | Durable issue still exposes claimant and `in_progress` to other replicas | A five-minute default lease can be renewed or reclaimed on its node, but it is intentionally not global durable history ([lease design](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/issueops/lease.go#L18-L69), [node locality](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/issueops/lease.go#L110-L150)). |
| Gas Town scheduled-dispatch serialization | Host-local `.runtime/scheduler-dispatch.lock` | Durable `hooked` status appears only later | It prevents two cooperative schedulers on one filesystem from executing a cycle concurrently, but is neither a distributed claim nor durable ownership ([lock and execution](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/capacity_dispatch.go#L152-L237)). |
| Attempt workspace identity | Polecat directory, Git worktree registration and branch | Agent bead fields name Polecat/hook/MR | There is no single durable record binding task, exact worktree, and resolved base SHA before effects begin. |
| Branch, commits, staged/unstaged/untracked/conflict/stash state | Git repository, index, worktree and shared stash ref | Agent `cleanup_status` is a coarse projection; checkpoint JSON is another lossy projection | Recovery must reread Git. A stale “clean” status is not authority. Gas Town's detailed reader includes modified, untracked, unmerged, branch-local stash count, and unpushed commits ([status shape and read](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/git/git.go#L2997-L3011), [collection](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/git/git.go#L3168-L3197)). |
| Live agent/session | tmux session plus process liveness | Agent state, heartbeat file, PID record | Watchdogs correctly treat tmux/process inspection as live truth and use durable fields to decide what should be running ([zombie classification](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/witness/handlers.go#L1598-L1627)). |
| Provider conversation | Provider-owned session store and, for some providers, a session ID | Handoff mail, startup beacon and conversation log export | Some paths resume a provider conversation; others start a fresh provider process over the same worktree and hook. These are not equivalent. |
| Agent transcript/telemetry | Provider JSONL and optional external VictoriaLogs endpoint | A detached watcher PID file in `/tmp` | Logging is opt-in observability, not a restoration journal. The watcher deliberately starts near “now,” so it excludes older conversations ([agent logger](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/session/agent_logging_unix.go#L15-L80)). |
| Accepted integration result | Remote target ref and ancestry | MR Bead and local Refinery target branch | Refinery verifies the pushed commit against the remote before recording success, then verifies the submitted head is reachable before closing workflow records ([push verification](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L695-L766), [post-merge proof](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L1538-L1559)). |
| Workflow history | Beads events and Dolt commits; Gas Town feed/mail records for additional control events | Runtime JSON state | Histories are useful evidence, but there is no unified attempt journal covering every boundary call and its before/after observation. |

## 4. Scheduling and capacity

### What actually schedules

The capacity scheduler scans open sling-context records, checks that their
source Beads are still dispatchable, and calculates a plan before mutating
anything. Dispatch configuration has separate town-wide capacity, per-cycle
batch size, and spawn delay; direct and scheduled Polecats both count toward
the limit
([configuration](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/scheduler/capacity/config.go#L8-L31),
[plan construction](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/capacity_dispatch.go#L87-L149)).

Capacity is not simply “number of tmux sessions.” Gas Town derives a Polecat
workstate from agent, hook, Git, stash, unpushed-commit, MR, and cleanup
observations. Dirty, unknown, or active-work states consume capacity; an
otherwise-clean Polecat whose only remaining fact is an active MR does not
([workstate inputs and decision](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/polecat/workstate.go#L13-L200)).
This is a strong idea: uncertain cleanup state is treated as occupied rather
than as spare capacity.

### Lock versus durable claim

Immediately before execution, the scheduler takes a non-blocking host-local
file lock. If another scheduler holds it, this cycle exits. With the lock held,
each planned item runs a callback that performs the sling, and closing the
sling-context record is retried twice after a successful launch
([dispatch executor](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/scheduler/capacity/dispatch.go#L48-L177)).

The item-level sling has additional local file locks, but its important order
is:

1. choose or create the Polecat and worktree;
2. update the durable work Bead to `hooked` with the Polecat assignee;
3. start the tmux session;
4. eventually close the scheduler context
   ([worktree before hook](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/sling_dispatch.go#L235-L270),
   [hook then session](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/sling_dispatch.go#L373-L425)).

That ordering creates observable recovery states rather than an atomic
dispatch. A crash after worktree creation but before hook creates unused
resources. A crash after hook but before session leaves durable assigned work
for the watchdog to restart. A launch followed by failure to close the
scheduler context can expose the item to a later cycle; the code explicitly
warns that this can double-dispatch
([post-launch context-close warning](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/capacity_dispatch.go#L239-L258)).

The hook helper retries `bd update` up to ten times and verifies status and
assignee by reread after a successful command. On a command error it generally
retries the write without first resolving whether the prior attempt landed
([hook retry](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/sling_helpers.go#L1262-L1331)).
That is materially weaker than Beads' claim-family ambiguity protocol.

### What Beads could supply, but does not supply to this scheduler path

Beads' `ClaimReadyIssue` selects ready work and performs the conditional claim
inside one transaction. Concurrent Dolt claimants rely on optimistic commit
conflicts and retry from a fresh snapshot because Dolt's row-lock syntax is
not an actual row lock
([ready claim](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/dolt/issues.go#L356-L389)).
The shared issue operation uses a conditional update, a random shared
`row_lock` conflict cell, a lease grant, and a claim event in that transaction
([claim CAS and lease](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/issueops/claim.go#L86-L190)).

After a commit-phase connection loss, Beads rereads the issue. Desired
post-state means success; verified rollback permits exactly one replay; an
unreadable state stays honestly indeterminate; and reported success without
the desired row fails loudly
([ready-claim verification](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/dolt/issues.go#L392-L457)).
This is the strongest claim protocol in the audited pair, but it protects only
the Beads claim. It cannot atomically include worktree creation or tmux start.

## 5. Restoration layers

### 5.1 Control-plane task and run

Task graph, status, assignee, MR records, agent records, and event history
survive a control-plane process restart in Beads/Dolt. A `hooked` assignment
also survives because it is a normal durable issue update, and Gas Town can
discover dead-session work by rereading agent and work records
([orphan scan](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/witness/handlers.go#L2884-L2991)).

What does not survive as one object is a planned attempt. The scheduler has a
host-local lock, a transient plan, sling-context record, work Bead, agent Bead,
filesystem worktree and tmux session. There is no one durable transaction or
attempt row saying “task T, Polecat P, exact base SHA B, exact worktree W,
effects through phase N.” Recovery infers that state from the authorities.

Beads leases do offer dead-worker recovery for Beads-native `in_progress`
claims: heartbeat extends the node-local ephemeral lease, and reclaim rewrites
the durable issue back to ready while conflicting with a concurrent
heartbeat/close
([heartbeat and reclaim](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/dolt/issues.go#L460-L507)).
Gas Town's scheduler-created `hooked` assignments have no such lease. Their
recovery comes from Witness/daemon observation and explicit status repair.

### 5.2 Agent session, context, and logs

Gas Town distinguishes a persistent Polecat identity/worktree from its
ephemeral tmux/provider process. Witness recovery deliberately restarts the
session without deleting the worktree or branch; the fresh process is expected
to find the existing hook
([restart contract](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/witness/handlers.go#L1298-L1314)).

Provider conversation continuation is path-dependent:

- Provider presets describe session-ID and resume syntax. Claude and Gemini
  expose `--resume`; Codex uses a `resume` subcommand
  ([presets](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/config/agents.go#L231-L300),
  [generic command builder](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/config/agents.go#L756-L790)).
- Quota/account rotation reads the active session ID from tmux, links provider
  state into the new account, and uses the generic resume command when that
  succeeds; otherwise it explicitly falls back to a fresh start
  ([quota continuation](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/quota/executor.go#L174-L208)).
- Self-handoff first persists handoff mail, refuses to respawn if that write
  fails, and then requests continuation
  ([handoff ordering](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/handoff.go#L509-L568)).
  However, this restart builder inserts `--continue` only by replacing a
  `claude` command string. A configured non-Claude provider gets the
  continuation prompt but not its preset's resume syntax on this path
  ([hard-coded continuation](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/handoff.go#L822-L896)).
- Witness `gt session restart --force` promises a fresh session over the
  existing hook/worktree. The command stops the tmux session and calls
  `SessionManager.Start` with empty options; that start builds a normal startup
  beacon and runtime command, not a provider resume command or session ID
  ([restart command](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/session.go#L551-L601),
  [fresh startup builder](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/polecat/session_manager.go#L319-L431)).

Thus “continue the same work” is reliable at the control/worktree level, not
uniformly at the model-conversation level. Fresh-session continuation depends
on prime/hook instructions, handoff mail, the repository, and checkpoints.
Exact provider-session continuation exists in selected flows and providers.

Optional transcript export does not close that gap. The detached logger tails
recent Claude JSONL to VictoriaLogs, kills the previous watcher using a
`/tmp` PID file, and filters files older than roughly sixty seconds before
startup
([logger lifecycle](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/session/agent_logging_unix.go#L15-L125)).
It is useful telemetry, not an input to deterministic session restoration.

### 5.3 Committed, staged, unstaged, untracked, conflicted, and stashed worktree state

The authoritative restoration unit is the existing Git worktree:

| Worktree state | What survives a process/session restart | What Gas Town records or changes |
|---|---|---|
| Committed | Commit and branch survive in Git. | Detailed workstate also detects commits not pushed upstream ([Git status read](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/git/git.go#L3168-L3197)). |
| Staged | Index survives while the worktree remains. | The periodic checkpoint dog runs `git add -A` and may commit it as WIP, so the exact pre-checkpoint staged boundary is not preserved ([checkpoint dog](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/daemon/checkpoint_dog.go#L78-L190)). |
| Unstaged tracked modification | File and worktree delta survive while the directory remains. | The checkpoint dog stages and commits normal modifications. |
| Untracked | Ordinary untracked files survive in the directory. | `git add -A` normally turns them into a WIP commit; runtime artifacts are explicitly unstaged so they remain local ([checkpoint exclusions test](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/daemon/checkpoint_dog_test.go#L211-L253)). |
| Tracked deletion | Deletion survives in the filesystem/index state. | The dog deliberately unstages deletions instead of committing them, so they remain dependent on preserving the worktree directory ([checkpoint implementation](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/daemon/checkpoint_dog.go#L128-L190)). |
| Conflict/unmerged | Conflict entries and files survive in Git's index/worktree while the directory remains. | The detailed status marks unmerged state, which makes the Polecat non-reusable; a WIP commit cannot faithfully serialize an unresolved index ([status shape](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/git/git.go#L2997-L3011), [workstate decision](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/polecat/workstate.go#L58-L200)). |
| Stash | Stash objects live in the repository's shared stash ref, not inside one worktree. | Gas Town filters stashes by branch for cleanup decisions. Normal and force cleanup refuse a Polecat with its own stash; nuclear cleanup may remove the worktree, while the repository-level stash remains ([cleanup gates](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/polecat/manager.go#L1112-L1174)). |
| Ignored/runtime-only file | Survives only with the filesystem directory unless another subsystem owns it. | It is excluded from checkpoint commits and does not become durable Git history. |

Checkpoint JSON is a convenience projection, not a complete worktree image. It
stores branch, last commit and a flat modified-file list produced from
`git status --porcelain`; it strips the two-character status code, so staged,
unstaged, untracked and conflict categories are not retained
([checkpoint schema and capture](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/checkpoint/checkpoint.go#L1-L53),
[porcelain flattening](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/checkpoint/checkpoint.go#L118-L160)).
Prime deletes a checkpoint older than 24 hours instead of presenting it, so a
week-old restart cannot depend on this JSON handoff
([stale checkpoint handling](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/prime_output.go#L770-L830)).

Reusable idle worktrees are intentionally destructive. After the pure
workstate classifier says reuse is safe, Gas Town kills the old session,
chooses a current remote/base start point, calls hard reset and force clean,
and reinitializes the branch
([reuse path](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/polecat/manager.go#L1780-L1905)).
This is reasonable resource reuse, but it is not restoration of the prior
attempt.

### 5.4 Live process, container, and VM state

tmux sessions and their descendants are live state, not durable state. A
Gas Town CLI/scheduler crash normally leaves separate tmux sessions running.
A host reboot loses them. The daemon heartbeat rebuilds supervision by
restarting Dolt as needed, ensuring Deacon, Boot, Witnesses, Refineries and
Mayor, checking orphaned Polecat work, and then running scheduled dispatch
([recovery heartbeat](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/daemon/daemon.go#L840-L1000)).

No source establishes restoration of arbitrary child-process memory, open
sockets, shell jobs, containers, or VM snapshots. Gas Town restores the
control loop and starts processes again. Any continuation beyond repository,
Beads, provider-session storage, mail and runtime files must be supplied by the
underlying tool.

## 6. Immediate restart

The chronological outcomes differ by crash point:

1. **Scheduler dies before the dispatch lock.** No execution effect has begun;
   the open sling context remains eligible.
2. **Scheduler dies while holding the host lock.** The OS releases the file
   lock. A later cycle rebuilds the plan from Beads and current capacity
   ([cycle lock](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/capacity_dispatch.go#L152-L237)).
3. **Worktree exists, hook does not.** The item may still look undispatched,
   while a Polecat resource exists. Spawn has best-effort rollback, but no
   atomic resource/claim transaction
   ([spawn and provisioning](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/polecat/manager.go#L875-L1093)).
4. **Hook exists, session does not.** Durable work says who should run it. The
   daemon notices hooked work with no live process, notifies the Witness, and
   Witness restart preserves the worktree
   ([daemon orphan check](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/daemon/lifecycle.go#L1182-L1271),
   [restart-first policy](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/witness/handlers.go#L1955-L2085)).
5. **Session exists, scheduler context close failed.** Work can be running even
   though the durable scheduling context remains open. The implementation
   warns of later double-dispatch; item and assignee checks narrow but do not
   turn the workflow into a transaction
   ([warning](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/capacity_dispatch.go#L239-L258)).
6. **Agent process dies inside a live tmux session, or tmux dies while work is
   active.** Witness rereads liveness, includes a TOCTOU guard against a newly
   recreated session, and restarts the process over the same workspace
   ([detection safeguards](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/witness/handlers.go#L1598-L1627),
   [restart action](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/witness/handlers.go#L2068-L2209)).
7. **Polecat directory and session are both gone while the Bead remains
   assigned.** The Witness scans from durable `hooked`/`in_progress` work,
   rechecks directory and session, then resets the work to open/unassigned and
   requests redispatch
   ([reverse orphan scan](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/witness/handlers.go#L2884-L2991)).
8. **Refinery dies after writing itself into the merge-slot Bead.** The holder
   survives, but it has no expiry, lease, fencing token, or audited startup
   reclamation. A later push holder is unique and therefore observes
   contention until its bounded retries time out
   ([persistent holder protocol](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/beads/beads_merge_slot.go#L98-L201),
   [unique holder and retry](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L1030-L1078)).

The immediate user experience is therefore usually “the same worktree comes
back in a new agent process,” not “the exact process resumes.” A provider
conversation may resume on particular paths, but a fresh session must be
prepared to reconstruct intent from the hook, repository and handoff records.

## 7. Restart after a week and external drift

A week changes several facts:

- The task graph, hook assignment, Dolt history, Git commits, branch and any
  still-existing worktree remain available.
- A Beads-native five-minute lease would be long expired unless heartbeat and
  reclaim ran. A Gas Town `hooked` assignment has no Beads lease and therefore
  remains until Witness or an operator repairs it
  ([lease TTL](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/issueops/lease.go#L18-L41)).
- The Polecat checkpoint JSON is over 24 hours old and Prime deletes it
  ([checkpoint expiry](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/prime_output.go#L770-L830)).
- A Refinery push holder left in the merge-slot Bead is still present a week
  later because the record has no TTL. Restarting the Refinery does not by
  itself prove that the old holder is dead or clear it
  ([slot release protocol](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/beads/beads_merge_slot.go#L165-L201)).
- Provider logs or provider session files may still exist, but the audited
  control-plane paths do not guarantee their retention or universal automatic
  resume.
- Remote default branch and source branch may have moved. Gas Town fetches and
  uses moving refs during new or reused workspace setup rather than preserving
  a resolved planned base SHA
  ([worktree creation](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/polecat/manager.go#L875-L1014),
  [reuse reset](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/polecat/manager.go#L1780-L1905)).
- Refinery's pre-verification fast path is invalidated when the remote target
  no longer equals the recorded verification base, so gates run again
  ([target drift check](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L1329-L1349)).

For users, a week-later restart is closer to reconciliation than resumption.
Committed work has the strongest survival. Uncommitted or conflicted work is
safe only if the exact worktree directory and Git metadata survived. A new
Polecat attempt starts from current remote truth and may need to recover prior
work from a pushed branch, WIP commit, or manual cherry-pick; it does not
automatically recreate the exact old index and filesystem state.

The orphan recovery path does add two useful week-scale brakes. Before
resetting abandoned work it checks whether the Polecat commit is already on
main, and it records per-Bead respawn counts with a circuit breaker to prevent
an endless respawn storm
([recovery guards](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/witness/handlers.go#L2744-L2815),
[reset and redispatch](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/witness/handlers.go#L2817-L2864)).

## 8. Git starting point and integration behavior

### Starting point

A fresh Polecat worktree uses an explicit base-branch string when configured,
otherwise the moving `origin/<default>` ref; it creates a unique task branch.
A resume branch is fetched best-effort and attached instead. The resolved
commit is not first written as a durable planned Base SHA tied to the attempt
([creation logic](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/polecat/manager.go#L875-L1014)).

This means two attempts nominally based on `main` can start from different
commits. That is often desirable after a retry, but it is not exact replay.
It also means post-crash reasoning must examine Git rather than rely on a
single planned-attempt record.

### Submission

The normal completion path pushes the Polecat branch before creating the MR
record, then verifies the pushed commit. The order avoids an MR that points to
a branch that never became remotely visible; later source comments explicitly
handle the opposite partial result, “push succeeded but MR bead failed”
([push-before-MR flow](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/done.go#L1381-L1467),
[partial success handling](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/done.go#L1767-L1901)).
This is intent ordering plus observation, though still not one transaction.

### Refinery behavior that is shipped in the ordinary per-MR path

The reachable single-MR Engineer:

1. resolves the submitted branch head;
2. checks out and pulls the target;
3. checks conflicts;
4. runs configured gates;
5. locally merges, then runs post-merge gates;
6. acquires a Beads-backed merge slot before a default-branch push;
7. rechecks that the MR is still eligible;
8. pushes and verifies the remote target contains the merge commit
   ([merge and gates](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L520-L684),
   [slot, recheck and verified push](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L695-L766)).

The slot is a persistent coordination record, unlike the scheduler's
process-lifetime file lock, but it is **not** a transactional durable claim.
Its holder is JSON in a Bead description; acquisition does a read, checks an
empty holder, and then performs a generic update without an expected-version
CAS. Two truly concurrent Refinery processes can both read “available,” both
write themselves as holder, and both return success
([slot CRUD protocol](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/beads/beads_merge_slot.go#L98-L163)).
The Engineer retries when it observes an existing holder and distinguishes
exhausted contention from infrastructure failure
([retry loop](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L1030-L1078)).
The design therefore serializes the expected single-threaded Refinery path
when no acquisition race occurs; it does not fence arbitrary or duplicated
writers. The true integration authority is the remote Git ref, whose push
acceptance and subsequent verification decide the outcome.

After push, workflow closure is guarded by a stronger proof: the originally
submitted commit SHA must be reachable from the remote target before the MR
and source work are closed
([success cleanup](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L1352-L1389),
[reachability proof](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L1538-L1559)).
The user consequence is good: a false-positive local merge does not silently
close the task.

### Batch/bisect status

Gas Town contains a substantial `batch.go` implementation with stack
construction, gates, bisection, merge-slot acquisition, push verification and
tests
([batch types and assembly](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/batch.go#L10-L97),
[batch verified push](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/batch.go#L379-L470)).
However, the source search found no production caller of `ProcessBatch`,
`AssembleBatch`, or `bisectBatch`; callers were tests only. The architecture
document simultaneously calls batch-then-bisect a core capability and marks
Phase 1 “in progress” and Phase 2 “blocked by Phase 1”
([phase table](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/docs/design/architecture.md#L206-L235)).

The defensible conclusion is: per-MR Refinery integration is shipped and
substantial; batch/bisect is implemented and tested as a package-level plan,
but is not wired into the audited production queue. It should not be counted
as shipped control-plane behavior.

## 9. Code organization by layers and end-to-end slices

### Layers

Beads has the cleaner internal layering:

- public/CLI entry points;
- a broad `storage.Storage` boundary;
- backend adapters such as Dolt and embedded Dolt;
- shared `issueops` transactional behavior;
- shared types, SQL builders and schema/migration machinery
  ([storage boundary](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/storage.go#L90-L170),
  [claim shared operation](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/issueops/claim.go#L193-L249)).

That separation enables backend conformance tests. Its cost is a very broad
interface and twin implementations/protocols that must stay semantically
aligned.

Gas Town is organized by subsystem—`cmd`, scheduler/capacity, Polecat,
Witness, daemon, session, Git, Refinery, Beads CLI wrapper, checkpoint and
configuration. There are good pure decision islands, notably workstate and
capacity planning. Boundary-heavy orchestration remains concentrated in large
command/manager files. One scheduled-dispatch slice crosses:

`capacity_dispatch.go` → capacity executor → `sling_dispatch.go` → Polecat
manager/Git/filesystem → `bd` subprocess → session/tmux → scheduler-context
close.

That makes the chronological behavior traceable if one follows the call chain,
but changing one invariant requires reasoning across many packages and several
untyped CLI/status conventions. In particular, Beads' strong in-process claim
semantics are not automatically inherited by Gas Town's `bd update`
subprocess usage.

### End-to-end maintainability

The system has clear product roles and distinct packages, but its reliability
policy is not expressed as one interpreter-neutral workflow. Retries,
verification, best-effort rollback, mail fallback, locks and status repair are
implemented locally in each slice. The result is pragmatic and feature-rich,
but reviewers must repeatedly audit cross-boundary effect order.

The Refinery is a representative mixed case. Git and Beads operations have
injectable functions around important slot operations, while a large Engineer
method still sequences checkout, pull, gates, merge, reset, push and cleanup
([Engineer seams](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L247-L305),
[merge slice](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L520-L766)).
This supports focused tests, but it is not a small compositional control-plane
algebra.

## 10. Production, test, fake, and dry-run dependency seams

| Mode/seam | Evidence | Assessment |
|---|---|---|
| Production Beads | `Storage` interface with Dolt implementation and shared issue operations ([interface](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/storage.go#L90-L170)) | Strong substitutability at storage level; broad interface makes small fakes heavier. |
| Beads backend conformance | Shared claim/lease suite asserts claim, idempotency, anti-steal, filtered ready claim, heartbeat, expiry and reclaim ([conformance suite](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/conformance/claim.go#L13-L66), [lease cases](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/conformance/claim.go#L177-L260)) | One of the strongest seams in the pair. |
| Gas Town pure planning | Capacity plan and workstate decision separated from execution ([workstate](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/polecat/workstate.go#L13-L200), [dispatch executor callbacks](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/scheduler/capacity/dispatch.go#L48-L177)) | Good policy test seam; boundary orchestration remains production-shaped only in parts. |
| Gas Town function-variable fakes | Refinery injects merge-slot operations and several tests replace command/Git behavior ([Engineer dependencies](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L247-L305)) | Useful but ad hoc; global/function mutation can miss real CLI, filesystem and process behavior. |
| Scheduler dry run | Builds and validates a plan, then returns before lock, cleanup and execution ([dry-run branch](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/capacity_dispatch.go#L152-L163)) | Safe preview, but it is not the same workflow interpreted with no-op effects. Lock contention, revalidation and later failures are absent. |
| Live-fake equivalent | No single production-shaped fake-provider workflow was found that interprets the same scheduling/recovery algebra against fake Git, tracker, executor and journal boundaries. | Tests cover components and some subprocess-shaped integration, but there is no one named end-to-end fake control plane. |

## 11. Verification inventory

### Strong evidence

- Beads tests commit-phase ambiguity in both directions: an applied write that
  reports error becomes success, a verified rollback gets one replay, a
  reported success that did not land fails loudly, and a second ambiguous
  replay remains bounded
  ([fault-injection tests](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/dolt/claim_verify_test.go#L13-L157)).
- Beads exercises claim conflict output through the real claim path and checks
  typed sentinel compatibility
  ([claim-conflict test](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/dolt/claim_conflict_test.go#L25-L78)).
- The shared Beads conformance suite checks claim, anti-steal, filtered
  claim-ready behavior, lease heartbeat, expiry, and dead-worker reclaim across
  backends
  ([claim conformance](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/conformance/claim.go#L13-L168),
  [lease/reclaim conformance](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/conformance/claim.go#L177-L260)).
- Beads tests twenty simultaneous fresh-schema initializers and verifies both
  migration version and representative tables
  ([concurrent schema test](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/dolt/initschema_concurrent_test.go#L19-L121)).
- Beads migration code detects binaries both ahead of and behind the database
  and exposes explicit operator messages
  ([schema skew handling](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/schema/schema.go#L82-L180)).
- Gas Town tests that a held scheduler lock suppresses dispatch and that a
  failed scan fails closed
  ([scheduler tests](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/scheduler_dispatch_test.go#L48-L119)).
- Workstate is a pure classifier with a large table-driven test surface; Git
  tests exercise untracked files, conflicts, branch-local versus repository
  stashes, pushes and submodules
  ([Git untracked test](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/git/git_test.go#L407-L438),
  [stash isolation test](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/git/git_test.go#L1852-L1927)).
- Checkpoint tests verify that runtime artifacts remain uncommitted rather than
  being accidentally swept into WIP history
  ([checkpoint test](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/daemon/checkpoint_dog_test.go#L211-L253)).
- Witness tests cover fresh-heartbeat races, dead sessions, dirty states,
  orphaned Beads, restart suppression after merge, and respawn behavior; the
  implementation also rechecks session and directory immediately before
  recovery mutation
  ([orphan TOCTOU guard](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/witness/handlers.go#L2946-L2991)).
- Refinery tests cover batch mechanics even though that path is not wired, and
  production per-MR code verifies remote push and submitted-head reachability
  ([per-MR verification](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L737-L766),
  [post-merge proof](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L1538-L1559)).

### Gaps

- No property-testing library or Go fuzz target was found for the core
  scheduler/claim/worktree/Refinery protocols. Gas Town has some manually
  randomized DAG property tests, but not an explicit generative state-machine
  model of the control plane
  ([randomized DAG tests](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/convoy_property_test.go#L99-L180)).
- No formal model (Quint, TLA+/PlusCal or Alloy) was found for dispatch,
  claim/reclaim, cleanup, or integration.
- No test found kills the scheduler at every boundary between worktree create,
  hook update, tmux start and scheduler-context close, then boots the whole
  control plane and asserts one exact disposition.
- No end-to-end test found preserves and validates all seven Git categories
  across a full host restart: committed, staged, unstaged, untracked,
  conflicted, stashed, and ignored/runtime-only.
- The generic Beads claim ambiguity tests do not protect Gas Town's generic
  `bd update --status=hooked` retry loop.
- Batch/bisect has unit/integration-style package tests but no reachable
  production caller, so those tests do not demonstrate production queue
  behavior.

## 12. Chronological failure table

| Event in real order | Observable state after failure | Existing recovery | Remaining risk / user-visible result |
|---|---|---|---|
| Scheduler scans Beads, then another actor changes readiness before execution | Plan is stale | Execution-time sling checks and status reads can refuse; unknown readiness errors fail closed ([sling preconditions](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/sling_dispatch.go#L128-L205)) | There is no atomic ready-selection plus Gas Town hook. |
| Host-local dispatch lock is held by another process | No dispatch from this cycle | Exit and retry next cycle ([lock test](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/scheduler_dispatch_test.go#L48-L71)) | Correct only for cooperating processes sharing the lock filesystem. |
| Polecat/worktree creation succeeds; process dies before hook | Git/filesystem resource exists; work still appears open | Later cleanup/reuse may discover it; spawn has best-effort rollback ([spawn provisioning](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/polecat/manager.go#L875-L1093)) | Resource leak or later duplicate attempt; no durable attempt phase binds the orphan to the work. |
| `bd update` commits hook but exits with error | Work may be `hooked`; helper sees an error | Generic retry, eventual later checks | Unlike Beads claim-family writes, the helper does not first reread on every failed exit; repeated update or misleading failure is possible ([hook retry](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/sling_helpers.go#L1262-L1331)). |
| Hook lands; tmux start fails | Durable owner/hook, no live worker | Daemon/Witness restarts over preserved worktree ([restart-first](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/witness/handlers.go#L1955-L2085)) | Recovery latency and fresh provider context; hook has no lease. |
| Agent is alive; scheduler-context close fails | Work runs while context remains open | Context close gets bounded retries; later planner rechecks | Source explicitly warns of double-dispatch ([warning](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/capacity_dispatch.go#L239-L258)). |
| Agent dies with dirty worktree | Hook and Git work remain; process gone | Witness creates/deduplicates cleanup wisp and restarts without deleting workspace ([dirty restart](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/witness/handlers.go#L2098-L2209)) | Model conversation may be fresh. Exact staged/unstaged boundary may already have been changed by checkpointing. |
| Worktree and session disappear, work remains assigned | `hooked`/`in_progress` Bead points to absent Polecat | Reverse orphan scan rechecks absence, resets open/unassigned, and signals redispatch ([orphan reset](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/witness/handlers.go#L2884-L2991)) | Any unpushed work that disappeared with the directory is lost. Respawn counter limits loops but cannot restore it. |
| Beads claim commit response is lost | Durable row may or may not contain `in_progress` owner | Verify by reread; one replay only after verified rollback ([verification](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/dolt/issues.go#L392-L457)) | Strong, honest result for the claim itself; unrelated Gas Town effects remain outside transaction. |
| Beads worker dies after native claim | Durable claimant remains; node-local lease stops renewing | Reclaim after lease expiry returns work to open and records history ([reclaim](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/dolt/issues.go#L478-L507)) | Lease enforcement is granting-node-local; this is not the Gas Town hook lifecycle. |
| Polecat push succeeds; MR creation fails | Remote branch exists; MR record absent | Completion path has checkpoints and explicit partial-success handling ([done partial result](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/done.go#L1767-L1901)) | Requires reconciliation; remote branch is the recovery artifact. |
| Refinery merges locally; merge-slot acquisition fails | Local target contains unpushed merge | Engineer hard-resets to remote target and leaves MR queued/failing appropriately ([slot failure reset](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L695-L717)) | Reset failure is only warned, so a dirty/stale local target can remain. |
| Refinery acquires slot and crashes before deferred release | Bead description retains a unique holder; no push result exists | No TTL or automatic stale-holder reclamation was found; a later holder retries and times out ([slot CRUD](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/beads/beads_merge_slot.go#L98-L201), [bounded retries](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L1030-L1078)) | Integration can remain wedged across immediate and week-later restarts until an operator or another path clears the holder. |
| Refinery push returns error after remote may have accepted it | Remote outcome is ambiguous | Code resets local target and returns failure on push error; explicit remote verification occurs only after reported push success ([push path](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L737-L757)) | This is weaker than claim ambiguity handling. A retry can reconcile via remote state, but this path does not first resolve a failed push by reread. |
| Refinery push reports success but remote proof fails | Local merge exists; remote target lacks expected proof or cannot be read | Reset local target and fail; do not close workflow ([verified push](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L749-L757)) | Fail-closed result is visible to operator; remote read outage and true missing push are not distinguished in disposition. |
| Remote target moves after Polecat pre-verification | Stored base differs from remote target | Refinery runs gates again ([drift check](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L1329-L1349)) | Correctly trades speed for safety. |

## 13. Maintenance risks

1. **Two different ownership protocols look similar.** Beads has
   `in_progress` claims plus node-local leases; Gas Town has `hooked` assignment
   plus watchdog recovery. Treating them as one mechanism would lead to false
   claims about expiry and atomicity.

2. **String/status coupling crosses a subprocess boundary.** Gas Town depends
   on CLI commands, JSON fields and status strings rather than Beads'
   in-process typed claim contract. A Beads semantic improvement does not
   automatically harden Gas Town's hook sequence.

3. **The Refinery slot is persistent but not atomic.** Its read/check/update
   sequence has no compare-and-swap token, expiry, owner-liveness check or
   fencing value. A crash after acquisition can also leave a stale holder that
   blocks future unique push holders indefinitely. The
   ordinary one-Refinery-per-rig topology narrows the race, but a duplicate
   process or concurrent caller can defeat the intended serialization
   ([slot acquisition and release](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/beads/beads_merge_slot.go#L98-L201)).

4. **Large orchestration functions hide ambiguity policy.** Sling, completion,
   Witness recovery and Refinery each decide independently when to retry,
   reread, reset, warn, or compensate. Maintaining a uniform
   intent-observe-reconcile rule requires manual discipline.

5. **Supplementary state can be mistaken for authority.** Agent fields,
   checkpoint JSON, heartbeat files, PID files and cleanup status are useful
   projections. Git, tmux/process inspection, Beads and the remote ref remain
   the authorities. The code often respects this, but the number of
   projections raises drift risk.

6. **Worktree reuse has a sharp destructive edge.** Pure workstate
   classification is the safety gate before hard reset/clean. Any missed Git
   phenomenon in that classifier can turn a classification bug into user work
   loss
   ([reuse sequence](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/polecat/manager.go#L1780-L1905)).

7. **Provider abstraction is incomplete at continuation boundaries.** Presets
   model resume capabilities, but self-handoff still edits a Claude command
   string. Adding a provider requires auditing all restart paths, not only the
   registry.

8. **Documentation can outrun reachability.** Batch/bisect is described as
   core, implemented, and tested, yet has no audited production caller and is
   marked blocked in the same design document
   ([status contradiction](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/docs/design/architecture.md#L206-L235)).

9. **Migration sophistication increases storage surface area.** Beads has
   version checks, content skew, repair paths, locks, embedded/server parity,
   and many migration tests. This is strong engineering, but it is a large
   compatibility matrix for an orchestration dependency
   ([schema guards](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/schema/schema.go#L82-L180)).

## 14. Ideas Dalph should consider

### Adopt or adapt

- **Separate durable ownership from liveness.** Beads' durable assignee/status
  plus cheap ephemeral heartbeat is a useful model. Dalph should keep its
  tracker-owned claim authoritative and model executor liveness separately,
  rather than writing high-rate heartbeat history into the tracker.

- **Verify ambiguity by authoritative reread.** Beads' rule is excellent:
  convert an applied-but-error result to success, replay only after verified
  rollback, and surface an honest indeterminate result when verification is
  unavailable
  ([protocol](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/dolt/issues.go#L392-L457)).
  Dalph should apply the same shape to tracker claims, Git pushes/worktree
  creation, executor session start, and journal append—using the authority
  appropriate to each effect.

- **Count uncertainty against capacity.** Gas Town's workstate decision counts
  dirty, stashed, unpushed and unknown cleanup as occupied. Dalph should
  preserve this fail-closed capacity rule while giving each disposition a
  distinct type.

- **Restart process, preserve sandbox.** Witness's restart-first recovery is a
  strong user-centered default. Destructive cleanup should remain a separate,
  exact, disposition-typed decision.

- **Scan from both sides.** Gas Town checks Polecats for assigned work and also
  checks assigned work for missing Polecats. Dalph should reconcile task →
  attempt/worktree/session and attempt/worktree/session → task, because either
  side can disappear independently.

- **Verify submitted ancestry before closing work.** Refinery's remote
  reachability proof is stronger than “push returned zero.” Dalph integration
  should close tracker work only after Git proves the accepted target contains
  the intended submitted commit or an explicitly accepted equivalent.

- **Use a bounded respawn circuit breaker.** Restart-first needs a durable
  attempt/retry budget and escalation, otherwise it becomes a spawn storm.

- **Backend conformance suites.** Beads' shared claim/lease tests are a good
  template for Dalph provider contracts: every tracker, Git and executor fake
  should pass the same semantic scenarios as production adapters.

### What an Effect-style interpretation could simplify

Effect could make the Gas Town-shaped workflow easier to reason about by:

- expressing tracker, Git, executor, clock, filesystem, journal and logging as
  explicit services/layers;
- giving each boundary a typed failure and explicit ambiguity/disposition;
- sharing retry schedules and fake clocks;
- scoping local locks, worktree handles, sessions and cleanup finalizers;
- interpreting one workflow algebra for dry-run, live fake, tests and
  production;
- keeping pure scheduling/workstate decisions separate from effect execution.

This would directly address the current scattering of callback injection,
global command execution, local retry loops and dry-run early returns.

Effect cannot:

- make a tracker claim, Git worktree creation and executor start one atomic
  transaction;
- turn a host-local file lock into a distributed durable claim;
- restore provider memory, process RAM, sockets, containers or an erased
  worktree;
- preserve staged versus unstaged versus conflicted state unless Dalph
  explicitly observes and stores the relevant Git facts;
- resolve an ambiguous external effect when the authority cannot be reread;
- make a moving branch name an exact planned Base SHA;
- prevent duplicated authority if Dalph persists facts that properly belong
  to the tracker, Git or executor.

The useful lesson is not “rewrite Gas Town in Effect.” It is “make the
cross-authority protocol explicit and interpretable while leaving authority
facts where they belong.”

## 15. Confirmed unknowns and negative-claim search record

The following are confirmed source-audit unknowns or absences, not claims
about every unpublished deployment:

- **No production batch/bisect caller found.** Search covered all Gas Town Go
  and design sources for `ProcessBatch`, `AssembleBatch`, `bisectBatch`,
  `BatchConfig`, and batch configuration use. Definitions and tests were
  present; a queue/daemon/CLI production call was not.
- **No universal exact provider-session restoration found.** Search covered
  `BuildResumeCommand`, `ResumeFlag`, `ContinueFlag`, `SessionIDEnv`,
  `ContinueSession`, session restart, handoff and quota paths. Exact resume is
  implemented for quota rotation. Claude self-handoff asks the provider to
  continue its most recent conversation rather than naming an exact ID; the
  Witness restart contract is a new runtime invocation over the same
  workspace/hook, and non-Claude self-handoff does not use the generic resume
  builder.
- **No durable planned Base SHA per Gas Town attempt found.** Search covered
  Polecat add/reuse, base branch, resume branch, checkpoint, agent fields and
  sling context. Exact submitted and merge commit SHAs exist later in the
  workflow, but worktree creation starts from a ref string without first
  persisting its resolved SHA as the attempt plan.
- **No complete serialized worktree snapshot found.** Search covered
  checkpoint, Git status, checkpoint dog, cleanup and workstate. Git itself
  retains the complete live index/worktree while the directory exists;
  checkpoint JSON flattens porcelain status and omits stash/conflict/index
  structure.
- **No Gas Town use of Beads `ClaimReadyIssue`/lease in capacity dispatch
  found.** Search followed capacity plan through sling, hook helper, Beads
  wrapper and tests. The path uses `bd update --status=hooked --assignee=...`.
- **No cross-boundary transaction or durable attempt journal found.** Search
  covered scheduler context, hook, agent Bead, checkpoint, event/feed and
  lifecycle state. Each records useful portions, but none owns an intent and
  observation for every worktree/claim/session effect.
- **No formal specification found.** Searches for Quint, TLA+, PlusCal, Alloy,
  model checking and state-machine verification found no model of these
  protocols.
- **No core Go fuzz/property framework found.** Searches for `func Fuzz`,
  `testing/quick`, `rapid`, `gopter`, QuickCheck, proptest, Hypothesis and
  fast-check found no generative model for the audited control-plane
  invariants.
- **No full immediate-reboot/week-later end-to-end test found.** Searches
  covered daemon restart, Witness restart, checkpoint, dirty/stash/untracked,
  schema migration, external drift and recovery tests. Strong component tests
  exist, but not one whole-system scenario asserting the exact final
  disposition across all authorities.
- **No live runtime snapshot/restore found.** Search covered tmux lifecycle,
  PID tracking, daemon boot, process cleanup, containers and VMs. The system
  restarts processes; it does not restore arbitrary runtime memory.

## 16. Technical and user-visible consequences

Technically, Gas Town + Beads is a real control plane with more depth than a
simple agent launcher. It has graph-aware work discovery, bounded capacity,
isolated Git worktrees, durable coordination records, watchdogs,
restart-first recovery, integration serialization, remote Git verification,
schema evolution, and unusually careful Beads claim ambiguity handling.

Its reliability boundary is nevertheless uneven:

- Beads-native claims are transactional and ambiguity-aware.
- Gas Town dispatch is a file-locked, multi-effect saga whose durable hook is
  written after workspace creation.
- Agent work can survive a process crash well because the worktree and hook
  are independent of the model process.
- The exact provider conversation does not survive uniformly.
- Complete uncommitted work survives only with the exact Git worktree;
  checkpointing improves the odds by creating WIP commits but changes the
  staged/unstaged shape and excludes some files.
- The Refinery's shipped per-MR path has meaningful fail-closed remote proofs;
  the advertised batch/bisect path is not production-reachable at this pin.

For a user, the best case after an immediate crash is strong: the Witness
starts a new agent in the same sandbox, with the same branch and durable work
hook, and the agent continues. The degraded case is still understandable:
the task remains assigned but waits for watchdog repair, or it is reset for
redispatch when its Polecat has truly vanished. The worst case is work that
never became a commit/push and disappeared with its worktree, or duplicate
execution across a crash window where scheduler context and hook/session
effects disagree.

For Dalph, this pair is both a competitor and a rich design reference. Its
strongest transferable ideas are authoritative reread after ambiguity,
uncertainty-consuming capacity, bidirectional reconciliation, restart-first
sandbox preservation, remote ancestry proof, and backend conformance tests.
Its clearest opportunity for differentiation is one explicit, typed,
production-shaped workflow that records planned attempt identity before
effects, keeps tracker/Git/executor/journal authority separate, and exercises
the same chronological recovery scenarios in fake, test, dry-run and
production interpreters.
