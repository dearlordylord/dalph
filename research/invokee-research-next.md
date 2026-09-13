# Research continuation and targeted validation

Status: research and targeted validation only. This document changes no Dalph
runtime behavior. The user will explicitly request tasks when ready. Do not
create a task breakdown or implementation tickets during this phase.

## Alice reconnects to ongoing delivery

Alice starts autonomous Dalph for one repository and tracker root. Her agent
connects to inspect tasks and their blockers, requests an allowed control change,
and later disconnects. Dalph continues its own delivery. Another client sees the
same Run and current task graph. This is the first composition question to
validate, not an invitation to build the entire client/server feature.

The existing [process experiment](./invokee-hosting-results.md) uses real capacity
control and journal publication but synthetic task progress and status. It
establishes useful process-lifetime and revision-conflict evidence. It does not
establish actual host attachment, real executor progress after disconnect,
worktree cleanup, or MCP interoperability.

## Scope correction and extracted findings

An unauthorized step from research into production implementation was stopped.
Its uncommitted production code, tests and draft runtime documentation were
removed. The retained runnable prototype remains under `research/prototypes/`.
The attempted implementation is neither a shipped feature nor a validated
prototype; focused passing tests did not establish composition correctness, and
the final typecheck had errors. No implementation task is complete.

Useful questions from that exploration can be investigated against unchanged
source rather than preserving half-implemented code:

- The host callback owns the Run lifetime. Where can a future client attach
  without acquiring that ownership? See
  [`production-host.ts`](../packages/dalph/src/application/production-host.ts).
- A stale client may reconnect to an endpoint now serving a different Run.
  Determine the required Run identity checks before selecting endpoint reuse
  behavior. Explicit Run identity is a candidate, not an accepted wire API.
- Graph edges, frontier and task status must describe compatible observations.
  A successful serialization test alone does not prove that coherence. Inspect
  [`delivery-status.ts`](../packages/orchestrator/src/coordination/delivery/delivery-status.ts)
  and its underlying publications before choosing a public representation.
- Capacity revision conflicts provide useful retry behavior, but do not identify
  which caller won an ambiguous request. Inspect
  [`task-work-capacity.ts`](../packages/orchestrator/src/control/task-work-capacity.ts).
- Wake, explicit Unpause and tracker refresh have different meanings. A queued
  hint cannot be reported as completed work or completed authority refresh. See
  [`run-reactivation-owner.ts`](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts).
- Client cancellation, accepted command lifetime and host Exit are distinct
  events. Their relationship needs an explicit per-operation chronology.

## Bounded investigations

| Question | First action | When an experiment is justified | Required evidence |
| --- | --- | --- | --- |
| Can clients disconnect while the actual host continues? | Trace host resource ownership and existing hermetic fixtures | If composition lifetime remains unproven, use a disposable harness with the existing host and controlled providers | Observe executor activity, kill an OS client after its first observation, release the controlled provider, observe real subsequent delivery and reconnect to the same Run; verify no second coordinator |
| What should the graph expose? | Map rooted task inventory, blockers, frontier, status and opaque executor associations to existing publications | Only if publication coherence cannot be established from source/tests | Include unassigned tasks; show which observations belong together; identify unavailable and closed states without inventing authority facts |
| What happens when a response is lost? | Write separate chronologies for capacity, wake, Unpause and refresh from existing control semantics | Exercise only unresolved admission/cancellation boundaries | Distinguish received, journal-accepted, hint-submitted and completed outcomes; specify safe reread/repetition without claiming durable caller attribution |
| Which connection mechanism fits? | Compare local socket and loopback HTTP against actual CLI/MCP, platform and lifecycle constraints | Only a concrete compatibility or lifecycle uncertainty warrants a transport probe | Explain address ownership, stale clients, shutdown and slow watchers; avoid building two production transports |
| Does ordinary MCP lifecycle fit? | Inspect primary MCP SDK/spec behavior and the referenced sibling implementations | A minimal real MCP client/server probe if EOF/cancellation semantics remain uncertain | Initialize, invoke, cancel/disconnect and reconnect without coupling the Run lifetime to MCP; no custom agent-chat protocol |

These are research work packages, not implementation tickets. Start with source
inspection; reuse existing tests and the retained experiment. Do not build a
prototype merely to demonstrate a possibility already established. A disposable
experiment needs a named uncertainty, observable pass/fail result, a negative
control where useful, and cleanup of its own resources. Keep all experimental
code under `research/prototypes/`; no production API additions to make it fit.
If existing public seams cannot support an experiment, record that limitation
and proposed seam in a task rather than quietly implementing it.

## Later task preparation — not active

After each investigation, record established facts and unresolved choices.
Only after an explicit request should these become proposed tasks. Each implementation task must state the real
chronology, starting authority facts, boundary calls, visible and forbidden
results, dependencies, and scenario-to-test mapping. Unproven claims remain
explicit acceptance requirements, not checked boxes.

Discriminate requirements for the first useful milestone from important later
work. Preserve autonomous use, one existing root-based Run and Dalph choosing
eligible tasks. Arbitrary task selection remains outside the plan. MCP is a
likely interface, not proof of reliable reporting. Native human access depends
on the executor provider; no custom parent/child conversation is assumed.
Caller-launched worker registration/leases and recursive planning remain
separate research tracks. Recursive prerequisite publication and preservation
of unfinished work belong to the planned core, including autonomous delivery.

The current deliverable is source-grounded research and targeted validation
evidence. Task creation and production implementation each require a subsequent
explicit instruction.
