# Invokee research coverage and specification readiness

Status: documentation coverage audit, 2026-09-13. No runtime, configuration,
task, accepted domain type, or specification is changed. This audit distinguishes
accepted scope from older research proposals. It does not promote disposable
experiments into a supported application boundary.

## Alice's first milestone and the governing record

Alice starts Dalph separately for one repository and one tracker root. Her agent
connects through MCP or CLI, sees tasks and their frontier, requests work and
changes capacity. The agent edits the tracker directly and may send a whole-
graph or ID-only refresh hint. Closing its client leaves Dalph delivering.
Another client can inspect the same Run.

The [first-milestone chronology](invokee-first-milestone.md) and the
[interview's Q20–Q26 decisions](invoker-invokee-interview.md#round-9-answer-and-follow-up-research)
govern this scope. Earlier research remains useful for alternatives and failure
phenomena, but its imperative language is not additional accepted scope.

## Older assumptions that must not enter a specification

| Earlier statement or proposal | Later decision and correct treatment |
| --- | --- |
| [Recursive planning](recursive-planning.md#github-supports-hierarchy-but-publishing-it-is-not-one-atomic-action) says multi-step publication needs a recoverable admission barrier; RP1, RP3 and RP4 require preventing admission while edges are unpublished. The [main synthesis](agent-driven-dalph.md) also says to prevent admission from a partially published plan. | Q17 explicitly accepts D starting from a complete observed tracker state before its blockers are authored. These candidate barriers and corresponding test outcomes are superseded for the initial behavior. A complete intermediate graph is different from incomplete provider evidence. Later readiness facilities remain possible, not necessary. |
| Recursive planning starts with a planner asking Dalph to create tasks and edges; its proposal and handback carry task descriptions and acceptance facts. The main synthesis proposes `propose_graph_change`. | Q12/Q13 specify direct tracker authoring followed only by “refresh graph” or IDs. Dalph-owned graph publication, creation deduplication and publication receipts are not requirements of this milestone. They cannot silently become prerequisites to supporting external planners. |
| [Recursive planning's handback section](recursive-planning.md#what-handback-must-mean) and RP7/RP8 introduce delegated scope grants, revocation and parent receipts. [Executor research](agent-driven-executors.md#handles-and-interaction) prescribes scoped credentials, controller generations and a message operation. | Q5/Q6 leave collaboration to the user and workflow; no parent conversation, handback service or delegation-grant architecture is accepted. Identity, permission and execution-stop evidence are distinct concerns, but that distinction does not require building all proposed mechanisms. |
| Recursive planning proposes a non-executable grouping parent with aggregate acceptance; its open decisions still ask which parent policy to adopt. | Q10 rejects conflating grouping with prerequisite semantics. The current task remains ordinary work; explicit dependencies determine eligibility. A new container task kind is outside this milestone and should not be presented as an unresolved prerequisite. |
| [Human interaction research](agent-human-interaction.md#implications-for-the-current-dalph-boundary) discusses Dalph message routing, durable queue outcomes, explicit manual ownership and return. | The standing requirement is organic provider-native access where technically available. These are possible mechanisms for stronger guarantees, not requirements to implement a custom conversation or manual-takeover standard. Provider evidence remains valuable and expressly conditional. |
| [Executor research](agent-driven-executors.md#capacity-and-grandchildren) discusses budgets for internal helper agents and rich resource detail in the graph. | Initial graph granularity is task plus optional opaque executor. Task-work capacity is the accepted bound. Provider/session/machine budgets and executor internals remain separate later questions if a concrete requirement needs them. |
| Story 2 initially lets the orchestrator start Dalph; the interview's Q26 recommendation initially described arbitrary task selection as later scope. | Q22 settles the simplest initial arrangement: Dalph started separately. Q26 explicitly excludes arbitrary selection from the plan, rather than scheduling it for later. Refresh IDs do not select work. |
| Older source assessment says only controlled executors exist or the public CLI is dry-only. | The first-milestone source map identifies the real production host, Codex executor/Integrator and production CLI. Earlier original-workspace snapshot claims must not replace this isolated baseline's facts. |

The early notes already label their protocols exploratory, and the synthesis
contains superseding interview clarifications. Nonetheless, their standalone
sections can be copied out of context. A later specification should cite the
accepted decision and current evidence together; it should not convert every
old candidate acceptance seam into a ticket.

## Evidence coverage and remaining specification work

| First-milestone behavior | Present evidence | What still needs a concrete contract |
| --- | --- | --- |
| Disposable clients attach to one surviving host | [Real host](invokee-real-host-results.md), [graph stream](invokee-graph-stream-results.md), and [attachment validation](invokee-attachment-validation.md) report client death/reconnect against unchanged delivery components. | Supported attachment/addressing and host shutdown ordering. Host startup is separate; no automatic process manager is needed. |
| MCP and CLI reach the same application operations | Hulymcp parity precedent and the disposable MCP bridge support the separation. The [actual MCP-host experiment](invokee-mcp-host-results.md) passed with the original production bootstrap and independently repeated evidence. | One supported operation/result surface shared by adapters. A bridge experiment does not establish the final public API, nor require CLI to invoke MCP. |
| Graph/frontier reads are passive and current-first | Graph-stream experiment derives graph, frontier and status from one runtime publication and checks reconnect; [changing-graph validation](invokee-changing-graph-results.md) now reproduces topology discovery and capacity retention, plus a terminal-evidence rejection after delivery; it is not a clean Run-settlement pass. | Public task/edge/opaque-executor projection, stream closure and slow-client handling. Journal positions are not identifiers for every runtime update. Full historical replay is not an accepted requirement. |
| Work direction persists when caller disappears | [Interruption evidence](invokee-command-interruption-results.md) distinguishes interruption before command, inside append and after append. [Recovery investigation](invokee-command-recovery-results.md) examines the actual missed observer and host-owned command. | Exact meaning of “request work”; command ownership through accepted publication and callbacks; truthful outcome/reconciliation after lost response. A generic retry rule cannot substitute for operation-specific semantics. |
| Capacity uses existing bounded execution | Existing revision-aware capacity service and test map are in the first milestone; actual-host MCP capacity validation is separate. | Expose revision and conflict outcomes, reuse existing policy. No new caller executor selector or general allocation framework follows from this. |
| Tracker refresh reports no graph facts | Existing owner hints and timer provide full-root refresh seams; changing-graph probe exercises the timer path and records a subsequent terminal-evidence limitation. | Decide/document ID-only hint handling and sufficient read coverage. A full-root reread may implement an advisory ID hint without introducing arbitrary execution scope. |
| Uncertain external worker retains responsibility | Q23 accepts visible unresolved work and retained capacity when stopped state cannot be verified. | This is a separate executor/registration research track, not a missing implementation in the first milestone. Its current deeper investigation owns evidence and protocol alternatives. |

The callback recovery and actual MCP-host records now contain independently
repeated passing evidence. The dynamic graph record now contains a passing negative reproduction: discovery works, but Run terminal evidence is rejected.
See the [research conclusion](invokee-research-conclusion.md) for the integrated
evidence; this scope audit does not duplicate those investigations.

The changing-graph terminal-evidence rejection is a current technical gap for
that chronology. A specification may name and preserve the required correction;
a successful stream alone does not qualify completion. This is distinct from
later optional executor/recursion mechanisms and does not authorize weakening
the journal's causal evidence requirement.

## Important later work versus actual blockers

The first milestone does not depend on selecting an external-worker lease,
recursive planner credential, manual takeover protocol, parent/child message
service, task publication barrier, helper-agent budget or arbitrary task scope.
It must preserve enough of the existing opaque executor boundary that later
work can be researched without pretending these protocols already exist.

Q24 is accepted **later core Dalph work in the current planned set**: an
implementer discovers prerequisites, stops unfinished with exact stop evidence,
releases its execution position and later gets a permitted successor attempt.
The partial Git work disposition and unfinished-attempt outcome need a separate
chronology. That question applies to autonomous Dalph too. It is not necessary
to settle it before specifying attachment and inspection.

Before implementation, the [operational scenario gate](../docs/OPERATIONAL-SCENARIOS.md)
still requires chronological adapter scenarios, exact boundary results,
applicable interruption/retry cases, forbidden results linked to invariants,
and scenario-to-test mappings. Research acceptance seams and successful
throwaway probes do not fulfill that gate by themselves.

## Operator clarification resolved

The user accepted [Q27](invoker-invokee-interview.md#q27--start-work-preserves-pause):
“start work” preserves Pause, while explicit Resume/Unpause changes it. The
caller/API therefore uses distinct operations. An agent may invoke them under
existing instructions without an online human or parent handback.

No first-milestone product clarification remains from this audit. The research
can feed a later explicitly requested specification and ticket breakdown.
The remaining transport, current-state projection and adapter lifetime choices
are bounded design work, not automatically reasons to stop for permission.
Capacity revision conflicts already have semantics. Q22 and Q26 need no new
questions. Native human access is a standing compatibility requirement; a
provider limitation does not authorize expanding the milestone into custom
messaging. Research should stop for operator input when an actual incompatible
behavioral choice remains, not merely because another possible feature exists.

## Audit verification

Read the accepted interview, first milestone, attachment validation and older
recursive, human-interaction and executor investigations. Checked relevant
source/test mappings in the preceding read-only source audit. No live-provider
request, production edit, test creation or runtime gate was performed for this
prose-only audit. The file changes no Dalph behavior.
