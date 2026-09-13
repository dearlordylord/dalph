# Codex-managed worktrees and agent-operated Dalph

Research dated 2026-09-13, requested as an Astra investigation. This note changes
no Dalph runtime behavior. It assesses the new CLI feature against the
[agent-operated proposal](agent-driven-dalph.md),
[executor investigation](agent-driven-executors.md), and
[repository assessment](agent-driven-repo-assessment.md). It is not an accepted
implementation specification.

## What happens for the maintainer

Alice asks a reasoning agent to deliver issues A and B concurrently. Each worker
needs a separate checkout and a conversation Alice can revisit. Codex's new
managed-worktree entry points make that individual worker experience easier.
Dalph still has to decide whether A and B are eligible, claim them, record each
exact planned attempt before creating resources, limit execution, observe
surviving writers after a disconnect, integrate verified commits, and dispose
of the exact resources after the accepted conditions hold.

**Recommendation:** keep Dalph's existing Git provisioning and Codex app-server
executor for the proposed first version. Treat managed worktrees as a useful
Codex convenience and possible future provisioning backend, not evidence that
Codex now supplies Dalph's workflow ownership or recovery protocol. Enabling
the feature in the current conversation is unnecessary for this assessment or
for Dalph's existing executor.

## Evidence and feature boundaries

**Documented** means stated by an opened official OpenAI page. **Observed** means
established by the separate local CLI inspection in this investigation; its
result files were also inspected for this assessment. Those observations are
specific to installed `codex-cli 0.154.0`. **Inference** means
an architectural conclusion from those facts. **Unknown** means this research
has not established the guarantee. A help flag establishes a supported input;
it does not prove every success, crash, or cleanup behavior.

### What the release actually establishes

The official 0.154.0 changelog includes managed-worktree creation (#42196),
repository listing (#42366), execution support (#42652), interactive sessions
and forks (#43069), and the TUI browser (#43286). These are concrete new CLI
capabilities. A changelog entry saying “list” does not establish a public
`worktree/list` RPC or a stable automation contract.
[Official changelog](https://learn.chatgpt.com/docs/changelog).

The user-supplied
[Developers Digest article](https://www.developersdigest.tech/blog/codex-cli-worktrees-durable-agent-sessions)
is the investigation's discovery source. Its durable-workspace/session framing
is useful, but the decisions below rely on official documentation, local CLI
inspection, and Dalph source rather than treating the article as a lifecycle
specification.

### CLI versus app-server

Local inspection found an experimental `worktrees` feature disabled by default
in this installation, plus `--worktree` in interactive, exec, and fork help.
The complete generated app-server JSON schema, including experimental APIs and
a generation with the feature enabled, contained no `worktree` occurrence.
The current official app-server narrative likewise documents no managed
worktree create/list/remove methods. This is evidence that the new entry points
are client-facing; it is not proof that every internal implementation detail
is client-local. Do not design against invented `worktree/create`,
`worktree/list`, or `worktree/remove` RPCs.
[Official app-server reference](https://learn.chatgpt.com/docs/app-server).

The current developer-command documentation also lags the installed CLI's new
flags. Its IDE slash-command section describes `/worktree`, which must not be
mistaken for a documented CLI automation API.
[Developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli).

### What the isolated local experiment proved

The experiment used a disposable two-commit repository, a dedicated Codex home,
and a model provider configured only to an unavailable loopback address. No
external model request or production configuration change was required. See
the [reproduction and evidence note](codex-managed-worktrees-local-probes.md).

| Boundary exercised | Observed result | Limit of the evidence |
| --- | --- | --- |
| `exec --worktree` with the feature disabled | Rejected before creating a Git worktree | Establishes this version's feature gate |
| The same entry point with `--enable worktrees` | Allocated `<isolated home>/worktrees/c1ae/repo`, detached at source current HEAD; emitted a new thread ID and persisted its exact `cwd` | No caller-selected path, branch, or older Base was demonstrated |
| Source had dirty tracked and untracked files | New checkout was clean and did not copy those changes | Does not establish all copy/include options or ignored-file behavior |
| Client was killed after the loopback request could not connect | Checkout and history remained; process scan found no surviving probe processes | Proves retained files/history, not continued agent execution or arbitrary writer survival |
| A fresh invocation repeated the same source/home/prompt | Created another detached worktree and another thread; both worktrees remained after terminal connection failure | Repeating a fresh command is not idempotent resource reconciliation |
| A new app-server read the original thread, then resumed it without starting a turn | Same thread ID and exact generated directory; read returned `notLoaded`, resume returned `idle` | Proves cross-process persisted lookup and reload, not successful model continuation or safe suspension of real tools |
| Generated experimental app-server schema, including feature-enabled generation | No worktree methods or fields | No discovered public managed-worktree RPC contract |

### Desktop worktrees have a separately documented lifecycle

The desktop guide says managed worktrees start at the chosen branch's HEAD,
normally detached, under `$CODEX_HOME/worktrees`; choosing local changes applies
those too. Its Worktree root setting changes location. `.worktreeinclude`
copies selected ignored setup files, with ignored `AGENTS.override.md` included
automatically; the guide explicitly scopes that behavior to local desktop
managed worktrees. Permanent worktrees are separate projects and avoid automatic
deletion. Ordinary managed worktrees default to a recent-15 retention limit;
archive/retention can trigger deletion, with protections for pinned or active
chats and snapshots for restoration. **These are desktop statements, not
verified CLI guarantees.**
[Desktop worktree guide](https://learn.chatgpt.com/docs/environments/git-worktrees).

### Conversation durability is separate from activity

App-server documents stored thread reads without resuming, resume of an existing
thread, and fork into a new thread ID with copied history. Ephemeral forks can
be memory-only. A turn finishing or being interrupted is a turn outcome;
background-terminal listing and termination are separate APIs. Last-subscriber
unsubscription can eventually unload an inactive thread. These contracts do
not state that a saved transcript proves every descendant process has stopped
or that all processes survive a server crash.
[Thread and process APIs](https://learn.chatgpt.com/docs/app-server).

The documented `tui.resume_cwd` setting chooses current versus saved session
directory, or asks when unset and different. Therefore “resume” alone is not
an adequate exact-directory assertion for Dalph.
[Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

## What the current Dalph code already does

When Dalph prepares A, its immutable
[`PlannedTaskAttempt`](../packages/contracts/src/planned-attempt.ts) contains
the task revision, Run and attempt IDs, branch, exact worktree path, executor
locator, and Base SHA. These are fixed before the Git/provider mutation under
the [accepted architecture](../docs/ARCHITECTURE.md#durable-task-attempt-planning).

The [Git adapter](../packages/orchestrator/src/authorities/git/node-worktree.ts)
creates the exact named branch/path at that Base, or attaches the exact already
existing branch. Its observation checks registration and lineage; it explicitly
rejects a planned path whose worktree is detached. It preserves contradictory
resources instead of repairing them.

The [Codex transport](../packages/dalph/src/application/codex-app-server.ts)
starts a non-ephemeral thread with the already-planned `cwd`, resumes with an
explicit `cwd`, and supplies that directory again when starting turns. The
[executor](../packages/dalph/src/application/codex-planned-attempt-executor.ts)
checks returned thread identity and directory against the exact attempt,
persists the association before the first task turn, and reconciles ambiguous
turn starts. Its lifecycle checks include owned activity rather than trusting
the assistant's final message. Its
[private store](../packages/dalph/src/application/codex-attempt-store.ts)
already retains provider association and recovery evidence without moving
provider session state into Dalph's workflow journal.

This is substantially closer to agent-operated Dalph than a fresh shell wrapper
around `codex exec --worktree`. The new feature does not remove the need to
qualify the existing executor against the actual host, but it also does not
require replacing it.

## Consequences for the proposal

| When the person or system acts | Consequence for Dalph |
| --- | --- |
| Alice asks for a new isolated worker | Existing provisioning already supplies the worker's checkout. Adding `--worktree` afterward could create a second, unplanned resource and change its directory. |
| Codex allocates a path or chooses current HEAD while starting | Before adoption, prove the caller can bind the exact path, branch and Base before creation, or accept a new planning protocol. Discovering them only afterward leaves an unresolved creation window. |
| Alice has unfinished changes in her foreground checkout | The tested fresh CLI path did not copy tracked/untracked edits. Any future copying option needs explicit accepted inputs; do not infer desktop copy behavior or silently change an attempt's starting contents. |
| Alice forks a conversation to try another approach | A new conversation is not automatically another tracker task or authorized task attempt. Decide whether it is a private helper, a new tracked deliverable, or an explicitly authorized replacement. |
| Alice's reasoning conversation disconnects | Retained identity/directory and reload are now demonstrated locally. The autonomous Dalph host still must inspect actual activity; resumable history does not prove execution is alive or safely stopped. |
| A worker finishes and Alice archives its chat | Dalph's accepted cleanup conditions still govern its resources. Any independent Codex deletion policy would need to be excluded or reconciled; desktop snapshots are not a substitute for preserving the exact planned worktree. CLI archive behavior remains unverified. |
| Alice reopens an old chat in a different directory | Verify its returned `cwd` and resource association. Do not silently move or recreate the worktree of an existing attempt. |
| Alice wants four simultaneous workers | A worktree feature does not enforce Dalph admission or total internal agent/process budgets. Preserve the distinction between task-work capacity, helper sessions, integration capacity, and retained resources. |

These are inferences from the source contracts, not claims that Codex has
violated them. A tool can be appropriate for interactive use without exposing
every boundary needed by a recoverable delivery coordinator.

Git remains the authority for worktree registration, refs and commits even if
a future Codex client creates them. Codex metadata may locate its managed
resources; it must not become a replacement task/claim database or a second
authority for the meaning of an attempt. The
[proposed graph](agent-driven-dalph.md#the-graph-and-frontier) should still show
tracker work, execution, and outstanding integration/cleanup obligations, with
provider sessions as optional detail.

## What would justify adopting managed creation

Do not change the existing runtime merely to adopt the feature. First establish
the following boundaries against the selected CLI version:

1. The input/output contract for exact source commit, resulting path, branch,
   and managed identity, including collision and dirty-source behavior.
2. A way to reconcile a successful create whose response is lost, without
   allocating another checkout or inferring ownership from age/path similarity.
3. Headless enumeration and exact disposal, or a deliberate design that uses
   Git for both while reconciling any Codex metadata. TUI browsing is not a
   sufficient machine contract.
4. Thread association, fork/resume directory behavior, and preservation across
   CLI exit/server restart. Qualify surviving tool processes separately.
5. Absence of competing automatic deletion, or an enforceable exclusion for
   Dalph-owned resources. Establish actual CLI behavior rather than assuming
   the desktop's settings or retention policy apply.

If creation cannot meet the exact preplanned-resource contract, the inexpensive
answer is to continue using Git creation and pass its path to Codex. Replacing
the accepted protocol would need a concrete operational benefit large enough
to justify new scenarios, types, recovery behavior and conformance evidence.

## Scenario-to-test mapping for a future decision

These are proposed acceptance seams, not newly accepted scenarios or tests run
by this prose-only investigation. The cited existing tests establish relevant
repository coverage to preserve; their presence is not fresh passing evidence.

| Chronological scenario | Required result and forbidden result | Existing evidence / additional seam |
| --- | --- | --- |
| Alice starts A; Dalph journals A's exact Base/path/branch; creation succeeds but its response is lost; Dalph restarts | Reobserve and retain the original resource; never start another checkout or change Base | Git tests `creates and rediscovers the exact isolated worktree` and `preserves the exact worktree when interrupted after Git creation`; add managed-create lost-response qualification if adopted |
| Alice's source checkout is dirty when A starts from an earlier declared Base | Start from the accepted exact inputs; preserve Alice's source; do not import unrelated edits | New managed-creation fixture with staged, unstaged, untracked and ignored files, plus a non-HEAD Base and conflicting branch/path negative controls |
| A's provider response is lost after a turn starts; a replacement orchestrator connects | Same attempt and associated work; no repeated task turn | Executor tests `reconciles a lost turn response without sending a second turn` and `does not issue a second Begin after an association write failure`; add host disconnect/reconnect composition |
| A returns a result while its descendant still writes | Keep execution responsibility until exact absence; no worktree removal from prose completion | Executor test `keeps terminal capacity while an owned descendant survives, then accepts after exact absence` |
| Alice forks or resumes A from a different checkout | Preserve the accepted attempt resource or reject the operation; never silently reinterpret the new conversation as A | Existing executor exact thread/directory checks; add managed fork/resume fixture and stale-association negative control |
| Alice archives a completed chat while Dalph still owes integration or cleanup | Preserve exact resources until authorized disposition, or expose externally lost resources without repair | Git test `reports a lost exact worktree without recreating or deleting any path`; add CLI archive/retention qualification and preserve existing disposition-cleanup conformance |

Existing Git tests are in
[`node-worktree.test.ts`](../packages/orchestrator/src/authorities/git/node-worktree.test.ts);
executor tests are in
[`codex-planned-attempt-executor.test.ts`](../packages/dalph/src/application/codex-planned-attempt-executor.test.ts).
Before implementation, expand and accept each selected chronology under the
[operational scenario gate](../docs/OPERATIONAL-SCENARIOS.md), including exact
boundary calls and crash/retry outcomes.

## Does Alice need to enable it in the parent session?

No. Documentation and generated-schema inspection do not require moving the
parent conversation into a worktree. Local experimentation can use a disposable
Git repository, a dedicated child-process Codex home, and a per-invocation
`--enable worktrees` override. A child-process override is not a change to the
parent's settings. Do not assume the surrounding agent harness automatically
exposes a CLI feature just because the CLI binary supports it.

Model-backed continuation, managed CLI fork behavior, and arbitrary descendant
process survival remain qualification work. Persisted identity/directory and
app-server reload were proved without a live model, as shown above. No
production settings or runtime code were changed, and implementation gates
are not represented as research proof.
