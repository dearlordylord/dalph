# Control-plane crash experiment readiness matrix

**Status:** retained experiment-readiness research. The current competitive
comparison uses source-code inference only; no further crash experiment is
planned, and no crash experiment has run.

This matrix compares the prepared
[common crash protocol](./control-plane-crash-experiment-protocol.md) with the
product-specific specifications for:

- [Gas Town + Beads](./experiments/gastown-beads-crash-spec.md);
- [OpenAI Symphony](./experiments/symphony-crash-spec.md);
- [Paperclip](./experiments/paperclip-crash-spec.md); and
- [HerdOS](./experiments/herdos-crash-spec.md).

It reports readiness at the revisions pinned by those specifications. It does
not predict outcomes and does not authorize execution. Readiness labels are
retained as historical preparation, not as the evidence basis of the current
comparison.

## Latest execution note

The first [Symphony C0 preflight harness](./experiments/harnesses/symphony/README.md)
has been implemented and independently reviewed. Its retained
[execution record](./experiments/results/symphony-c0-20260730T204747602Z-97dbf5f6-blocked/result.md)
is a blocker, not a crash result: this host has no Elixir/Mix runtime, cannot
create the required private network namespace, and cannot prove the required
hard resource limits. Symphony was never started and neither C0 fault was
injected. The readiness labels below therefore remain unchanged.

## Status vocabulary

The five labels describe what can be tested safely and deterministically at the
pin, not whether a product is reliable:

| Status | Meaning |
| --- | --- |
| **Ready now** | The product and repository already contain the deterministic seam, isolated fixture, observation, resource controls, and reviewed preflight needed to run the exact case. |
| **Requires isolated harness work** | The product seam is already suitable, but the outer fake/supervisor/evidence/sandbox/preflight package described by its specification has not been implemented and reviewed. |
| **Source-only** | Source exposes the ordering or recovery rule, but the exact ambiguity window lacks a deterministic barrier or the safe local fixture cannot prove the production boundary. Internal test instrumentation or an adapter is needed in addition to the outer harness. |
| **Partial** | A meaningful native subcase or restoration layer is representable, but the exact C-case or another required layer remains source-only or unsupported. |
| **Unsupported** | The pinned product does not own the named operation or restoration layer. It must be reported as absent, not approximated with an artificial effect. |

No C0-C9 cell is **Ready now**. All four specifications retain an unmet
all-or-nothing preflight gate. Existing unit tests may qualify mechanisms, but
they are not crash-experiment results.

## C0-C9 readiness

| Case | Gas Town + Beads | Symphony | Paperclip | HerdOS |
| --- | --- | --- | --- | --- |
| **C0 — stop before claim** | **Source-only.** Gas Town needs a deterministic barrier before its generic hook write. Scheduler dry-run and lock tests are not a crash at that boundary. | **Requires isolated harness work.** The memory fixture can install A-D before the next poll, and both in-BEAM reset and whole-BEAM restart have a defined seam. The isolated runtime launcher and approved stop actions are missing. | **Requires isolated harness work.** Pausing the coordinator before fixture insertion gives a deterministic before-claim point. The supervisor, embedded-database fixture driver, sandbox, and evidence dumper are missing. | **Source-only.** A persistent fake platform and package-local dispatch barrier must be added; production commands cannot safely use a real GitHub account. |
| **C1 — claim applied, response lost** | **Partial.** Gas Town scheduled dispatch has no native claim transaction. Beads separately has existing ambiguous-commit verification and claim conformance tests, but those qualify Beads rather than Gas Town scheduling and still require the execution preflight. | **Unsupported.** The claimed set is process memory updated after worker start; there is no durable tracker claim/response boundary. | **Source-only.** The durable queued-to-running update exists, but no deterministic post-update/pre-follow-up checkpoint exists. | **Source-only.** An in-progress label can serve as the soft claim only in a persistent fake-platform model; there is no atomic claim or shipped response-loss seam. |
| **C2 — workspace created, control record missing** | **Source-only.** Sling creates the Polecat worktree before hooking the Bead, but the required post-worktree/pre-hook barrier is absent. | **Requires isolated harness work.** The existing `after_create` hook can block after the directory is initialized but before the worker records the path. | **Source-only.** Worktree realization and persistence are separate, but there is no deterministic barrier between them. | **Partial.** The native analogue is a runner checkout plus local worker branch; HerdOS owns no distinct worktree record to lose or adopt. A retained-versus-fresh checkout qualification needs the fake-platform/Git harness. |
| **C3 — agent started, start response lost** | **Partial.** Witness/session restart semantics can be observed with a fake agent, but the exact post-session-start ambiguity barrier is missing. | **Partial.** The fake app server can block before `thread/start` response or before `turn/start`; in-BEAM and whole-BEAM behavior are observable, but no process/session adoption exists. | **Partial.** A recorded-start variant can crash after PID/PGID persistence. Exact OS-spawn-before-persistence still needs a test-only checkpoint. | **Source-only.** A future fake can prove a child started while `Agent.Execute` is outstanding, but HerdOS records no PID/start receipt and a local harness cannot prove Actions behavior. |
| **C4 — full uncommitted worktree** | **Partial.** Polecat process/worktree survival is representable after a fake-agent fixture is reviewed, but there is no single durable attempt record; checkpoint-dog and no-checkpoint cases transform Git differently. | **Requires isolated harness work.** The local fake can create every Git layer and the workspace is reusable. Orchestrator-death, whole-BEAM, stash, and conflict variants need the approved harness. | **Requires isolated harness work.** Product worktrees, PID/PGID state, run logs, embedded database, and restart paths are present; the outer fake, supervisor, sandbox, and evidence tooling are missing. | **Source-only.** Retained and fresh runner checkouts can be modeled locally only after the persistent fake-platform harness exists; the result would not prove Actions runner-directory retention. |
| **C5 — agent finishes, result not recorded** | **Source-only.** The custom agent needs a reviewed completion adapter and a post-exit/pre-done-observed barrier. | **Requires isolated harness work.** An OTP observation barrier can suspend only the Orchestrator while the worker finishes; preflight must prove the worker and task supervisor remain runnable. | **Source-only.** The process adapter returns too quickly after child exit; a test-only adapter or heartbeat checkpoint is required. | **Source-only.** The proposed base harness also needs a test-only `agent.Agent` wrapper that blocks after child exit but before returning `ExecResult`. |
| **C6 — push applied, response lost** | **Source-only.** Gas Town owns task-branch push and MR submission, but needs a reviewed local transport barrier after the branch update. | **Unsupported.** Core Symphony delegates push to agent/hook policy and records no push result. | **Unsupported.** Paperclip core preserves workspace/branch work but does not push. | **Source-only.** Worker force-push recovery can be qualified with a one-shot in-root Git shim after the fake platform exists; it would model applied-effect/error handling, not a real network. |
| **C7 — target update applied, response lost** | **Source-only.** Per-MR Refinery integration and ancestry proof exist, but an accepted-target-push/failed-return barrier is missing. | **Unsupported.** Symphony has no core target integration protocol. | **Unsupported.** Paperclip has no core target update or merge protocol. | **Source-only.** Worker-to-batch containment recovery can be exercised with the fake platform and Git shim; final PR-merge cleanup remains fake-platform evidence rather than GitHub proof. |
| **C8 — immediate graceful close/reopen** | **Partial.** Default `gt down`/`gt up` is a real graceful control case after preflight, but it deliberately leaves Polecats alive and must not be conflated with coordinator crash or broader destructive flags. | **Requires isolated harness work.** The isolated supervisor can stop normally, but the exact packaged shutdown action, child termination, and port closure still need canary validation. | **Requires isolated harness work.** Graceful SIGTERM, explicit hot restart, and hard SIGKILL are all source-backed and must be run as three separate variants after supervisor validation. | **Unsupported.** Worker/integrator commands have no general graceful coordinator shutdown. SIGTERM and SIGKILL may be compared later as OS-termination variants, but neither is a graceful HerdOS C8 result. |
| **C9 — reopen after a week with drift** | **Partial.** Target/worktree/hook drift and Beads lease expiry have bounded subcases; Gas Town has no virtual week clock and its hooks are not leases. | **Partial.** Target and tracker drift with retained/removed workspace are representable; elapsed-week timers and provider-session expiry are not. | **Partial.** Database timestamps and Git/workspace drift can be changed through a reviewed driver; genuine provider-session expiry cannot be tested with the process adapter. | **Partial.** Fake issue/run timestamps and Git drift can be modeled; provider-session expiry is inapplicable to ephemeral Codex, and real GitHub retention remains outside the harness. |

### Important qualification

“Requires isolated harness work” is not permission to run a manual command.
It means the product seam is adequate once every fixture, barrier, signal,
resource limit, observation, and teardown action in the linked specification
has been implemented and approved. “Source-only” requires an additional
deterministic boundary or acknowledges that the safe model cannot prove the
external production substrate.

## Graceful stop and crash are separate

| Product | Graceful stop readiness | Crash readiness |
| --- | --- | --- |
| **Gas Town + Beads** | **Partial.** Default `gt down` followed by validated `gt up` is the narrow graceful case. It leaves Polecats alive by design. Broader `--polecats`, `--all`, `--force`, and `--nuke` operations are outside this safe experiment. | **Partial.** A unique tmux socket and fake Polecat can expose executor/worktree survival, but exact hook, session-start, completion, and Git ambiguity windows remain source-only until named in-package barriers exist. |
| **Symphony** | **Requires isolated harness work.** Normal isolated-supervisor termination can be a genuine control case once the exact action and child/port closure are proven on a canary. | **Requires isolated harness work.** In-BEAM Orchestrator reset, whole-BEAM kill, and fake-executor kill are distinct. Whole-BEAM recovery must never inherit evidence from the live application supervisor. |
| **Paperclip** | **Requires isolated harness work.** Graceful SIGTERM and explicit hot-restart intent are two distinct orderly paths, both different from crash. | **Partial.** C0, C4, and the recorded-start C3 variant require the outer harness; exact C1, C2, C3, and C5 remain source-only. Coordinator-only SIGKILL, whole-control-plane kill, and executor kill must have separate process manifests. |
| **HerdOS** | **Unsupported.** There is no general graceful worker/integrator shutdown path at the pin. | **Source-only.** Short-lived operation processes can be killed in a future local fake-platform harness, but that proves the pinned slices against the platform contract, not GitHub Actions crash behavior. |

## Four restoration layers

This is readiness to observe each layer independently, not a claimed recovery
result.

| Restoration layer | Gas Town + Beads | Symphony | Paperclip | HerdOS |
| --- | --- | --- | --- | --- |
| **Control-plane task/run/attempt** | **Partial.** Beads task/claim and Gas Town hook/session facts are separate; no one durable Gas Town attempt joins them. | **Requires isolated harness work.** The memory tracker must be reinstalled after whole-BEAM restart, while the snapshot exposes the live in-BEAM run. | **Requires isolated harness work.** Embedded PostgreSQL exposes issue, wake, run, event, workspace, retry, PID, and log facts with strong inspection value. | **Source-only.** GitHub-shaped labels/runs/refs can be persisted only by the proposed fake platform; it is not a production GitHub attempt ledger. |
| **Agent session/context/log** | **Partial.** A fake can distinguish a fresh Witness invocation from filesystem continuation. Exact provider resume is unsupported by the credential-free fixture. | **Partial.** Thread/turn and fake logs are observable, but replacement workers start a new thread and whole-BEAM session adoption does not exist. | **Partial.** Process-adapter and Paperclip run-log continuity are observable; provider-session continuation is unsupported with the credential-free adapter. | **Unsupported.** Same-session restoration is unavailable because Codex is explicitly ephemeral. A fake process/log can qualify invocation continuity only. |
| **Complete Git worktree state** | **Partial.** A real Polecat worktree can expose all layers, but checkpoint dog may intentionally fold staged, unstaged, and untracked content into a commit; ignored/conflict/stash need separate cases. | **Requires isolated harness work.** A local reusable workspace can capture commit, index, unstaged, untracked, ignored, conflict, stash, registration, branch, and base. | **Requires isolated harness work.** Product-owned worktree records and quarantine/recovery paths make this the richest exact local Git case. | **Partial.** HerdOS owns a runner checkout, not a durable worktree identity. Pushed commits survive a fresh checkout; unpushed layers remain runner-local. |
| **Live execution** | **Partial.** tmux pane/PID survival can be observed, while Witness restart is generally a fresh process rather than adoption of the exact provider execution. | **Partial.** OTP can deliberately terminate supervised workers during an in-BEAM reset; a new BEAM has no source-visible adoption of a surviving old OS child. | **Requires isolated harness work.** PID/PGID persistence, hot-restart classification, orphan reaping, and detached process observation can all be compared with OS evidence. | **Unsupported.** HerdOS owns no live-process adoption record. Workflow run status is durable externally, but HerdOS records no coding-agent PID or process lease. |

## Historical minimum harness estimate per product

This section records what the smallest safe experiment would have required
when the experiment path was evaluated. It is not a current recommendation to
execute one.

### Gas Town + Beads

The proposed starting point was the **Beads-native C1 qualification**, not a Gas Town crash. Its
existing in-package tests already inject ambiguous claim commit outcomes and
exercise claim concurrency, idempotency, heartbeat, and reclaim.

Missing work:

- approve exact pinned test selectors and fixture-local Go caches;
- prove no external Dolt, credentials, or network are reachable;
- record the conformance clock/TTL inputs;
- produce the standard evidence and teardown manifest; and
- label the result “Beads-native claim,” never “Gas Town scheduler.”

This is the smallest useful qualification, but it does not reduce the need for
Gas Town's tmux/fake-agent/fault-barrier harness.

### Symphony

The proposed starting point was **C0 before claim**, first as an in-BEAM Orchestrator reset and then
as a whole-BEAM restart. It needs no agent WIP or Git ambiguity injection and
validates task bootstrap, frontier recomputation, empty running/retry state,
process ownership, and restart observation.

Missing work:

- build the isolated OTP launcher with unique supervisor, registry, logger, and
  endpoint names;
- persist and reinstall the A-D memory fixture revision;
- validate exact Orchestrator-reset, whole-BEAM-stop, ready, snapshot, and
  teardown actions on idle canaries;
- enforce credential/network/resource limits; and
- generate the signed `preflight.json`.

That foundation can later add C2-C5 and C8 without replacing the tracker or
process-isolation design.

### Paperclip

The proposed starting point was **C0 before claim** using one local trusted coordinator and embedded
PostgreSQL. Pause scheduling, insert the A-D fixture and queued wakes, prove no
run became running, hard-crash only the coordinator, and restart.

Missing work:

- implement the outer supervisor and exact process manifest;
- generate and validate loopback-only Paperclip/embedded-PostgreSQL config;
- build the database fixture driver and consistent evidence dumper;
- validate ready, coordinator-only kill, restart, and fail-closed teardown;
- enforce outbound denial plus PID/CPU/memory/disk/time limits; and
- keep C1/C2/exact C3/C5 disabled until their internal checkpoints exist.

The fake agent is not needed for this first case, which keeps it smaller than
C4 or hot-restart adoption.

### HerdOS

The proposed starting point was the **source-level C0 fake-platform case**. Persist A-D issues and
workflow state below one root, stop before the ready-label removal, kill the
operation process, and invoke the pinned dispatch/advance slice again.

Missing work:

- add a reviewed build-tagged, package-local harness in a disposable pinned
  source copy;
- implement fsync-safe persistent fake platform services and an operation log;
- add the deterministic pre-ready-removal barrier;
- prove the real GitHub client and all account credentials are unreachable;
- add process/resource/network containment and evidence snapshots; and
- validate ownership-aware teardown.

This result would qualify HerdOS logic against its `platform.Platform`
contract. It must not be presented as a GitHub Actions crash result.

## Which single harness to build first

Build the **Symphony isolated OTP harness first**.

The choice is about experimental leverage, not product rank:

1. **Evidence value:** one harness can distinguish in-BEAM supervision from
   whole-runtime loss, observe capacity and live-child behavior, and later
   exercise exact workspace and agent-protocol boundaries.
2. **Isolation safety:** the planned tracker is memory-backed, the fake app
   server and Git remote are local, and no PostgreSQL, tmux, Dolt, real GitHub,
   SSH server, or provider account is required.
3. **Implementation effort:** Symphony already has an `after_create` hook,
   fake app-server protocol tests, snapshots, and OTP supervision seams. The
   main work is an isolated launcher, unique naming, deterministic barriers,
   process ownership, evidence, and teardown.
4. **Coverage:** after C0, the same harness can cover C2, both C3 subcases, C4,
   the C5 observation barrier, executor crash, C8, capacity behavior, and the
   Git/control part of C9. C1, C6, C7, real SSH recovery, and provider-session
   expiry remain explicitly unsupported.

Paperclip is the best second harness because its durable run/workspace/PID/log
state offers the richest four-layer evidence, but embedded PostgreSQL, detached
process adoption, hot restart, and broader resource supervision make its first
safe harness more expensive. Gas Town spans tmux, Dolt/Beads, worktrees,
Witness, checkpoint dog, and Refinery with several missing barriers. HerdOS
first needs a durable fake GitHub-shaped platform, and any result remains a
platform-contract qualification rather than real Actions recovery.

The low-cost Beads-native C1 test qualification can proceed independently once
its narrower preflight is approved; it is not a substitute for the first
end-to-end control-plane crash harness.
