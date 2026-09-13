# Executors when agents operate Dalph

Research date: 2026-09-13. This is a documentation-only investigation: it changes no executable code, accepted workflow, or provider configuration. The scenarios below are proposals and test seams, not accepted implementation requirements or claims of passing tests.

## Start with what happens

A maintainer asks an orchestrator agent to finish three GitHub issues. Two are independent; the third depends on both. The orchestrator asks Dalph to pursue that target with at most two task attempts executing. Dalph reads GitHub, establishes the exact attempts and worktrees, and asks the execution provider to start work. The orchestrator can inspect progress or send a correction while Dalph continues checking reports. When one worker submits its commit, Dalph performs the required integration, tracker reflection, and disposition-specific cleanup. The orchestrator does not need to remember a sequence of issue-close, worktree-remove, and capacity-release calls.

If the orchestrator conversation disappears halfway through, the same obligations still exist. A later conversation asks Dalph what remains and can give new direction. Losing a conversation must not erase the work or silently authorize another worker in the same worktree.

This suggests a division: the agent chooses goals, decomposes work, and resolves meaningful uncertainty; Dalph retains responsibility for carrying accepted work through its concrete lifecycle. Making Dalph callable over MCP does not require making its lifecycle dependent on every next model turn.

## What this repository already separates

The current [executor contract](../packages/contracts/src/executor.ts) identifies complete executor work by `(RunId, AttemptId)` and exposes `begin`, passive `observe`, `requestSuspension`, and `resume`. It deliberately hides provider sessions and processes. `ExecutorWorkSafelySuspended` proves that all executor-owned activity for the attempt has stopped and that the same attempt can resume. An absent report does not prove absence of work.

The [Codex adapter](../packages/dalph/src/application/codex-app-server.ts) already contains thread interaction, background-terminal controls, process-group census, and durable launch-token reconciliation. The [real-host qualification suite](../packages/dalph/test/qualification/codex-real-host-qualification.test.ts) includes recovery when an escaped token-bearing child survives the prior app-server leader. These are concrete reasons to retain the supervisor boundary when changing the user-facing operator.

The [architecture](../docs/ARCHITECTURE.md) and [domain context](../docs/CONTEXT.md) also keep accepted executor output distinct from integration, promotion, task completion, and cleanup. A new agent-facing tool should preserve those differences. It should not interpret “done” in a chat message as proof of all of them.

## Current provider capabilities

Codex App Server documents durable thread identifiers, `thread/resume`, read-only `thread/read`, `turn/start`, event notifications, active-turn `turn/steer` with `expectedTurnId`, and `turn/interrupt`. It separately documents experimental background-terminal listing and termination. This provides concrete primitives for separately addressable workers and orchestrator interaction. The documentation does not establish that a successful interrupt proves every operating-system descendant has exited; Dalph needs its execution adapter's stronger stop evidence. [Official App Server documentation](https://learn.chatgpt.com/docs/app-server).

Codex's native subagent workflow creates separate agent threads, surfaces their work in supported clients, and collects results in the main conversation. It supports configurable concurrent thread limits per session. Those conveniences are useful for contextual delegation, but a provider's per-session thread limit is not automatically a cross-provider Dalph task-execution limit. [Official subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents).

Claude Agent SDK supports subagent definitions, tool restrictions, subagent-specific MCP servers, background execution, nested delegation, and resuming subagents through the containing session. Its documentation includes caps for depth, concurrency, and spend. Therefore an architecture should not assume that native subagents are necessarily one-level or unresumable. [Claude SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents).

Claude's session documentation describes explicit session identifiers and resuming through `query()` options. Its `continue: true` chooses the most recent session in a directory; Dalph should instead bind work to an exact recorded identity. That last sentence is a design inference from Dalph's exact-attempt requirement. [Claude SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions).

Provider features are documented capabilities, not qualification of this checkout's installed binary, account, version, or adapter. No live agents or paid provider calls were started for this investigation.

## Which workers should Dalph use?

| Arrangement | Benefit | Requirement before Dalph can guarantee cleanup |
| --- | --- | --- |
| Separately launched, addressable sessions supervised by Dalph's executor adapter | The orchestrator can reconnect, change, or disappear without losing responsibility for worker activity | Exact attempt/session association, launch reconciliation, message routing, and proof that all owned writers stopped |
| Native subagents spawned through a cooperating host adapter | Native conversation inheritance, built-in delegation UX, and parent/child messaging | The host must expose admission, exact child identity, observation, interruption, descendant accounting, and recovery independent of an agent's memory |
| Agent spawns any child and later registers its handle with Dalph | Easy to attach to existing agent workflows | Registration cannot retroactively prevent duplicate launch, capacity overshoot, or unidentified writing; guarantees begin only after verified adoption |
| Pure bookkeeping MCP with no execution supervision | Portable and small | It cannot enforce “never forget cleanup” if the host does not supply trustworthy lifecycle evidence |

Recommendation: start with the first arrangement, while leaving the coarse executor boundary capable of accepting the second. These workers are children in the work assignment sense even if the provider calls them root sessions. Conversely, a provider-native child is not necessarily a separately recoverable Dalph task attempt.

A durable session is not an immortal process. Its transcript may be recoverable while its live tools have died, or a tool process may survive while the conversation is unavailable. Observe and reconcile those separately.

## Handles and interaction

Give the orchestrator a stable attempt reference for inspection and direction, not a raw provider thread ID as lifecycle authority. Keep the exact provider association in the execution substrate. A worker receives a credential restricted to its attempt and the operations it needs, such as reading assigned facts, recording a result, or requesting help. Validate that restriction at the server; putting a handle in a prompt is not enforcement.

Distinguish three proposed concepts before introducing types: an attempt reference identifies work; a scoped credential authorizes selected actions; a control assignment says which orchestrator may issue potentially conflicting directions. One copied string should not silently perform all three jobs.

Submitting a result should initiate the verified completion path. It should never grant the worker permission to delete its own worktree or release capacity while descendants still write. An explicit handback can improve UX, but the system cannot depend on every worker remembering it. The supervisor must recover responsibility if no handback arrives. Credential expiry likewise means the caller can no longer issue certain requests; it does not prove a writer stopped.

Offer one orchestrator-facing message operation that resolves the current worker binding. The adapter can steer an active turn, enqueue a later message, or explain that the worker is no longer addressable. Distinguish accepted-for-delivery, delivered, and acted-on: a successful tool response must not imply that the model has obeyed the correction. A queued-message design also needs a durable owner and retry semantics; it should not accidentally place provider inbox contents in Dalph's workflow journal.

Replacement orchestrators should read the existing run and acquire the right to direct it, preserving attempts and worker bindings. If exclusive control is desired, a server-checked generation prevents an old conversation from issuing stale directions. That generation fences control calls only; it cannot stop filesystem writes by itself.

## Capacity and grandchildren

Choose explicitly what is bounded. Two task attempts, two model turns, two processes, and two worktrees are different promises. Preserve Dalph's task-execution bound; add separately named provider or machine budgets only if needed.

For a task worker that spawns helper agents, either count helpers under a declared per-attempt provider budget or admit them through a shared provider-capacity allocator. A simple per-session cap multiplied across independently launched sessions does not enforce a global limit. If native spawn tools bypass the allocator, disable them for that profile or state the narrower guarantee accurately.

Do not create a deadlock in which all task workers hold slots while each waits for a new task worker. A decomposition operation could leave the parent as a nonexecuting tracker task waiting on its children, but the parent must first stop its owned work before releasing an execution slot. Alternatively, helpers remain internal to an executor's explicitly bounded budget. These choices require different scenarios and should not be blended silently.

Retaining a worktree for evidence does not necessarily occupy an execution slot. Releasing task execution capacity does not mean a worktree may be deleted. The graph should show waiting-for-stop-proof, integration, retained resources, and runnable work separately so the agent can understand the actual constraint.

## Proposed failure scenarios and acceptance-test seams

These chronological scenarios explore the design. Each requires acceptance and expansion under `docs/scenarios/` before implementation.

| Scenario and starting facts | Trigger, calls, crash or retry | Visible result and forbidden result | Proposed acceptance test |
| --- | --- | --- | --- |
| Maintainer has two ready issues; GitHub records the first claim; Git has one exact planned worktree; journal records begin intent; provider has started the first worker | Connection drops before the launch response. Dalph restarts, reads its intent, and asks the executor to reconcile that exact attempt before any start | Graph shows reconciling then the original worker; no second writer or invented free slot | `reconciles a lost worker launch response before admitting another writer` |
| Maintainer's orchestrator conversation vanishes; tracker still owns the same tasks and claims; exact worktrees and worker sessions remain; Dalph recorded their responsibilities | A new orchestrator connects. Dalph reads existing responsibilities and current provider/Git/tracker facts, then binds direction to the replacement controller | Same attempts and visible progress; old controller cannot issue conflicting fenced directions; no automatic rerun caused by chat loss | `replacement orchestrator adopts existing work without creating attempts` |
| Worker reports a commit while its background compiler still writes; Git worktree exists; claim and attempt remain journaled | Result submission arrives. Adapter checks activity and observes the compiler; later it stops and a fresh check proves absence | Result can be recorded as evidence, but no false stopped report, premature capacity release, or worktree removal | `keeps capacity and worktree while a result-reporting worker still owns a writer` |
| Every admitted task worker holds a slot and needs a child task; tracker currently lacks those child tasks; worktrees and active responsibilities exist | Agent asks to decompose. Chosen protocol writes real child tasks and edges to tracker, safely suspends parent work, records observations, then admits eligible children. Lost tracker writes require reread before retry | Children progress after parent writers stop; no parent-slot/child-slot deadlock or duplicate child creation | `stops parent work before allowing decomposition to release its slot` |
| Worker has submitted evidence and disconnected without handback; provider later proves no owned activity; Git result exists; journal retains responsibility and tracker task remains open | Supervisor observes completion, carries forward accepted integration/cleanup protocols, and reflects the proven outcome to tracker; crashes recover from recorded intents | Maintainer sees settlement without another model call; no mandatory remembered handback, premature issue closure, or foreign-resource deletion | `settles an abandoned worker handle through observed lifecycle evidence` |

The tests above are not implemented or run. Existing runtime tests do not establish these proposed MCP, adoption, or delegated-control behaviors. No runtime/model changes were made, so this note does not claim implementation-gate or model-check evidence.
