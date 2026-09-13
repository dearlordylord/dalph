# Invoker and invokee: evidence for the next specification

Status: research synthesis, 2026-09-13. This records the accepted direction,
validated mechanisms and remaining choices. It is neither a specification nor
an implementation backlog. All executable experiments are disposable and live
on the isolated interview branch; production code is unchanged.

## Alice can use Dalph directly or through an agent

Alice starts Dalph for one repository and one tracker root. Dalph owns task
admission, exact attempts and resource dispositions, and keeps working under
her existing policy. An agent or CLI client attaches to inspect tasks, blockers,
frontier and optional opaque executor associations, or invokes a named control
operation. Closing the client does not close that host or settle executor work.
Another client can read current state without recovering the first client's chat.

The agent authors tasks and dependencies in the tracker. A refresh request
contains no graph facts: it is a whole-root hint or advisory task IDs. Grouping
is not dependency, and ID hints do not select arbitrary work. Dalph chooses
eligible tasks. A complete intermediate tracker state may be acted upon before
later edits add blockers, as accepted in Q17.

This preserves both autonomous invocation and agent invocation. It does not
require a parent conversation, handback, worker-owned bookkeeping protocol,
custom chat standard, or external worker lease for the initial milestone.
The [accepted milestone](invokee-first-milestone.md) and
[scope audit](invokee-spec-readiness-audit.md) govern older exploratory notes.

## What the executable evidence establishes

| Concrete boundary | Evidence and its practical consequence |
| --- | --- |
| Observation client dies while delivery is held | [Real-host experiment](invokee-real-host-results.md): the same production host continues through acceptance, integration, promotion and tracker confirmation. Attachment need not own the Run. |
| Current graph/status changes, client reconnects and host closes | [Graph stream](invokee-graph-stream-results.md): one attachment supplies current plus later publications; a new client receives current first; retained Closed reaches the client before EOF with the tested shutdown ordering. |
| Slow writer falls behind | [Sliding candidate](invokee-slow-watch-results.md): a one-value sliding stage keeps the latest/final state in controlled cases. Internal SubscriptionRef retention is unbounded, so that stage alone is not a global memory bound or selected public policy. |
| Request is interrupted inside SQLite append | [Interruption cuts](invokee-command-interruption-results.md): live Journal defers interruption through storage and accepted publication. Capacity retry conflicts without another change; Unpause retry adds another direction. |
| Unpause persists but its owner callback is skipped | [Recovery](invokee-command-recovery-results.md): a locally paused ongoing owner ignores later wake hints despite durable Unpause. Fresh owner reconstruction recovers without another command. A complete command owned independently of the request reaches the actual callback once, restarts the timer and activates. |
| Actual MCP process exits during a request to the actual host | [MCP-host composition](invokee-mcp-host-results.md): the independent adapter finishes capacity against the original bootstrap; another real MCP child reads the same Run and revision; actual delivery completes with one coordinator, one capacity change, and zero Exit requests. |

[Changing tracker graph validation](invokee-changing-graph-results.md) now
qualifies both discovery and a failure. A timer refresh discovers four tasks;
B stays blocked by C, while eligible D cannot start over A's occupied position.
The current desired selection can rank D ahead of A without replacing A's
retained execution responsibility. A replacement client sees the new graph.

After A delivers and the tracker confirms it, the journal rejects Run
termination: overlapping graph observations differ without the causal
predecessor relationship required to supersede them. The probe asserts this
failure and the absence of a terminal record. It is a passing reproduction of
a current limitation, not successful end-to-end Run settlement. This finding
must be resolved or explicitly bounded in a later specification; it was not
fixed in research.

During refresh, current `Ready` can contain `GraphNotEstablished` while the
activation obtains its own tracker view. That is not an empty graph or task
deletion. A UI may retain its last observed graph only as explicitly stale
presentation state. The current-source contract must distinguish this interval.

## Bounded design recommendations supported by the evidence

These recommendations are inputs to a later specification, not new accepted
behavior or shipped interfaces:

- Keep one separately started application host. MCP and CLI adapters reach the
  same operation surface; CLI need not invoke MCP. Connection discovery and a
  local address are ordinary adapter work, not another scheduler or mandatory
  process manager.
- Own the complete accepted command independently of the request, including
  callbacks after journal append. Avoid treating a protected append alone as
  full command completion. Host shutdown remains a separate lifetime boundary.
- Expose capacity's expected revision, current policy and conflict unchanged.
  Do not automatically acquire a new revision and repeat the caller's intent.
- Keep wake, Unpause and refresh distinct. A hint acknowledgement is not proof
  of an authority read or activation. A response-lost Unpause has no safe blind
  replay identity. The [operation research](invokee-operation-contract-research.md)
  records actual inactive, paused and terminal behavior.
- Use complete graph/frontier/status projections from a single runtime
  publication. Journal position is supporting evidence, not a sequence for all
  runtime updates. Reconnect can read current state; durable replay is not an
  accepted requirement. Coalescing updates and slow-client disconnection need
  explicit wire behavior if selected.

The remaining application contract should make these boundaries visible rather
than expose raw internal services as if they were already a supported API.
A remote adapter must still qualify input/Run identity and shutdown handling.
A disposable adapter proves composition, not deployment/authentication or the
public CLI. No new authentication system is implied by agent-issued instructions
under the same logical operator.

## Later features are researched without being made first-milestone blockers

[External-worker participation](invokee-external-worker-participation.md)
distinguishes admission before launch from registration after launch. The latter
cannot retroactively establish a capacity bound. The caller or worker can report,
but reports need adapter-qualified execution evidence; MCP silence, release,
timeout and lease expiry do not prove writers stopped. The existing generic
executor remains an exact Run/attempt correlation with opaque provider internals.
A new provider's durable identity, adoption and activity evidence is the next
useful substrate-specific validation when that provider is selected.

[Native human access](agent-human-interaction.md) remains conditional on the
execution host's own capabilities. Independent addressable sessions and
parent-controlled helpers must not be conflated. Existing local Codex research
qualifies specific installed interfaces and offline identity behavior; it does
not prove every worker permits direct conversation or exclusive manual editing.
No custom Dalph chat or takeover protocol is required for the first milestone.

[Recursive planning](recursive-planning.md) remains later core work. Direct
tracker edits and graph refresh are its discovery foundation. An implementer
ending unfinished and freeing a position needs exact stopped-execution evidence
and an explicit partial-work disposition; merely publishing prerequisites or
returning a handle does neither. The original task remains ordinary work with
explicit blockers. Its fixed Base/worktree cannot silently become a successor
attempt. That later chronology needs its own operator choices about preserving
partial work; it does not justify an edit barrier or a new task-container kind
in this milestone.

## Readiness boundary

Technical research should answer whether mechanisms exist and where they fail.
It cannot choose a different user intent by renaming commands. The potentially
remaining product question is whether a general “start work” action should
explicitly resume a paused Run, or whether Pause is preserved until a separately
named Unpause/Resume operation. The smallest recommendation is separate names that preserve Pause. Agents
choose those operations under their existing user instructions; there is no
per-command human approval or handback requirement. Any remaining product
clarification concerns the design of a general action, not permission for each
invocation.

No operator needs to reapprove settled root scope, Dalph choosing tasks,
separate host startup, or client independence. Transport details and precise
projection/result schemas can be specified from this evidence. Future external
worker and unfinished-recursion choices remain later scope, with limitations
recorded rather than filled by assumed protocols.

## Verification boundary

The result notes contain chronological scenario-to-test mappings and exact
commands. Independently repeated focused experiments, source reviews, local
link/syntax checks and normal commit hooks qualify these research artifacts.
No production behavior, build/dependency configuration or formal model changes;
full runtime and exhaustive model gates are not relevant to this round.
Before implementation, selected operational scenarios still need the repository's
accepted scenario/invariant mapping. Successful throwaway tests are evidence
for that work, not implementation authorization or completed tickets.

## Final review and focused results

| Experiment | Producing run | Independent check | Interpretation |
| --- | --- | --- | --- |
| Missed Unpause recovery and complete-command ownership | 2/2 | 2/2 | Stale ongoing owner reproduced; fresh reconstruction and independent command lifetime qualified. |
| Actual MCP bridge into actual production host | 1/1 | 1/1 | Capacity survives child replacement and the unchanged delivery completes. |
| Latest-state slow-watcher candidate | 2/2 | 2/2 | Controlled coalescing retains final state; only one buffer stage is bounded. |
| Changed tracker graph and terminal evidence | 1/1 | 1/1 | Discovery/capacity/reconnect pass; test deliberately reproduces rejected termination and no terminal record. |

Review corrected advisory IDs being described as fetch scope, active-only
capacity being implied as accepted policy, per-command human approval being
implied by “operator choice,” and stale claims about in-progress experiments.
It also qualified the slow-buffer scheduler evidence and removed mandatory
credential/fake-provider assumptions from the external-worker investigation.
The graph probe was reviewed against its actual journal and process evidence;
its qualified negative result is deliberately preserved without a production
patch. Syntax, local links and diff whitespace were checked for the changed
research artifacts; normal staged lint and secret scanning run on commit.
