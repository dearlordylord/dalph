# Dalph as invoker and invokee: design interview

Status: active interview. These notes change no Dalph runtime behavior. They
separate user requirements from recommendations and unanswered decisions.
Implementation is outside this interview until shared understanding is confirmed.

## First use case: the person starts autonomous delivery

Alice selects existing tracker work and a concurrency policy, then runs Dalph
without an orchestrator agent. Dalph reads the graph, admits eligible attempts,
uses exact Git worktrees, observes workers, and carries integration, tracker
reflection, and cleanup obligations. Alice can inspect the graph and intervene.
This is the baseline already being developed, not a new proposed replacement.
Accepted behavior and implementation completeness must be distinguished when
consulting the delivery story and current application boundary.

## Settled direction from the conversation

- The central pivot is supporting both invocation directions, potentially at
  the same time: Dalph invokes agents and is itself invoked by agents.
- Autonomous operation without a separate orchestrator remains a first-class
  use case.
- Graph and frontier are visible on demand and through updates. Initial graph
  granularity is tasks, whether assigned or not, with an optional assigned
  executor. Executors remain opaque; internal helper/session detail is later.
- Human access should feel organic and use provider/host-native interaction
  where possible. A custom interaction standard is not a selected solution.
- Recursive planning remains possible: continuing subtree planners and an
  implementer that adds child tasks are both open arrangements. "Handback" is
  not a requirement for a message, callback, or online parent.
- Already-authorized delivery continues without establishing whether its
  orchestrator is online. Dalph may be unable to determine that status.
- Decomposition approval belongs to the user's workflow and instructions.
  Dalph-owned parent/child conversation is not an agreed product feature.
- Separate important first-priority work from important later possibilities;
  limited support for poorly observable workers is conditional on small,
  natural implementation cost.
- Existing architecture is evidence and a constraint to discuss, not a design
  that this interview is obliged to ratify.
- New concrete terms will enter the glossary when resolved; ADRs record actual
  decisions with material trade-offs. Neither is a scratchpad for speculation.

## Current consolidation

[First invokee milestone](./invokee-first-milestone.md) consolidates answers
through Q26 into one chronological scenario, scope ledger, architecture gaps,
and proposed acceptance seams. It supersedes earlier recommendations where
later answers narrowed scope. No implementation is authorized by this note.

## Decision tree

Round 1 settled Q1 and Q2. Q3 was passed because its framing was unclear; it
remains unresolved. The user clarified that MCP is likely a reporting route,
but that reporting is unreliable. The specific causes and acceptable limits
are not yet settled. Round 2 established continued progress without an online
orchestrator and workflow-specific decomposition approval. Q4 is conditional,
not a commitment to build a degraded-executor subsystem.
Q10 is withdrawn: it conflated grouping with prerequisite semantics rather
than identifying an open product decision. Q11 supports both scope delegation
and requesting assignments. Q12 favors direct contact with Dalph to incorporate
or refresh task/dependency facts; task creation ownership is not settled.
Q13 accepted the autonomous-first anchor with the corrections below. Q14
accepted the second, orchestrator-centered story, with no redundant startup
refresh. The request for Dalph to start working remains to be specified; rooted delivery
exists in current source, whereas arbitrary subgraph selection is not established.
Q15 accepted the caller-host story with unresolved mechanics. The main-story
round is complete; the requirements interview remains active. Add short variants
only when a concrete decision requires them. Requesting a refresh means
only a full-graph refresh or a subgraph refresh identified by task IDs. Q7 is tentatively supported, qualified by the distinctions below. Q8 is a
tentative yes, with mechanisms deferred to research or a prototype. Q9 is
settled: task granularity with an optional opaque executor association;
more detailed execution views belong later.
Recommendations are not answers.

| Decision | State | Decisions it will unlock |
| --- | --- | --- |
| Q1: What work the invoking agent brings to Dalph | Settled: both Dalph-launched and externally launched workers are desired | Executor launch/adoption boundaries, session identity, supported provider capabilities |
| Q2: Whether an agent can enter and leave an already autonomous Run | Settled: yes, without a new Run or mutually exclusive mode | Direction ownership, disconnect policy, concurrent callers, lifecycle |
| Q3: Native interaction that bypasses Dalph messaging | Passed; do not treat the recommendation as accepted | Observation/reconciliation contract, manual edits, when stronger coordination is justified |
| Q4: Workers whose host cannot reliably expose execution state | Conditional: only if small and natural; otherwise later candidate | Reporting guarantees, degraded support, unresolved completion |
| Q5: Orchestrator disappearance after accepted direction | Settled: continue; no online-parent or handback requirement established | Continued progress, unanswered judgments, recovery |
| Q6: Permission for a worker to publish a decomposition | User workflow/instructions decide; no universal parent approval | Parent approval, graph-edit grants, acceptance preservation |
| Q7: First invokee use case | Tentative agreement; caller-started cases must be separated | Which executor/reporting/graph questions need early decisions |
| Q8: Caller launches after arranging work with Dalph | Tentative yes; registration/reporting/release unresolved | Launch protocol research or prototype |
| Q9: Task graph versus helper-agent visibility | Settled: tasks and optional opaque assigned executor; detail later | Default graph, execution detail, observation requirements |
| Recursive decomposition and optional notification | Waiting for scope/publication choices | Scope grants, partial graph publication, explicit prerequisites, scheduling |
| Capacity and integration across nested planning | Waiting for delegation/publication choices | Global versus partitioned budgets, waits, fairness, resource disposition |
| Graph presentation | Initial granularity settled; task-level states/interactions remain open | Native links, capability affordances, history/current view composition |
| Q20: Agent-facing interface | Settled: callable through MCP or CLI; hulymcp is a precedent to inspect | Shared application operations; standalone MCP deployment remains open |
| First implementation slice | Waiting for scenarios and architecture decisions | Accepted scenario-to-test mapping and explicit implementation authorization |

## Round 1

**Q1 — What does the invoking agent bring?** An agent is already helping Alice
and decides to use Dalph. Must it be able to ask Dalph to deliver tracker work
and have Dalph launch the workers, bring workers it already launched for Dalph
to coordinate, or both?

Recommendation: include both as desired use cases, but permit adoption of
already-running workers only where their host supplies sufficient identity and
lifecycle observations. Do not pretend that a conversation ID alone meets that
condition. This is a recommendation, not an agreed requirement for first release.

**Q2 — Can an agent join an existing autonomous Run?** Alice starts Dalph with
no orchestrator. Later she asks an agent to inspect that same Run, revise its
plan or give direction, then leaves the agent conversation. Should that work
without starting another Run or selecting a mutually exclusive mode?

Recommendation: yes. Support coexistence and entry/exit; the exact decisions
the agent may make and the effect of its disappearance remain later questions.

**Q3 — How far should native human interaction go?** Alice opens a worker in
its ordinary provider client and gives it instructions without sending those
messages through Dalph. Is that a supported path, with Dalph learning relevant
changes from the provider, tracker, and Git afterward, or must some interactions
first be coordinated through Dalph?

Recommendation: allow native conversation and observation. Identify specific
unsafe conflicts before introducing additional coordination. Do not silently
extend this answer to simultaneous human/agent filesystem writing; exclusive
manual editing and its guarantees are a later decision.

## Round 1 answers

- Q1: user answered yes; both forms of invoking Dalph remain desired. This
  does not select a first release or settle minimum adoption guarantees.
- Q2: user answered "yes of course"; an agent can join the same already
  autonomous Run. Its departure policy and exact decision permissions remain
  open.
- Q3: user did not accept either alternative and asked to pass. Preserve the
  organic/native interaction requirement; revisit only with a concrete case.
- Reporting clarification: MCP will most likely be one route for reporting to
  Dalph. "Unsure" meant unreliable, not merely undecided protocol choice.
  Do not assume reporting is guaranteed. Agent omission, lost messages, and
  missing host observations are different possible failure cases to examine,
  not causes the user has already selected.

## Round 2

**Q4 — What about a worker Dalph cannot reliably observe?** An orchestrator
brings a worker whose host cannot establish whether it is still running. That
worker can report through MCP, but sometimes no report arrives. Should Dalph
support it with explicitly limited guarantees, or reject that executor?

Recommendation: permit visibility/bookkeeping with an explicit unknown state;
require adequate execution evidence before promising automatic capacity release,
replacement, or cleanup. Whether that limited mode belongs in the product is
for the user to decide.

**Q5 — What happens when the orchestrator disappears?** An agent has asked
Dalph to deliver A and B, and then its conversation closes or loses context.
Should Dalph continue already-authorized delivery without that agent?

Recommendation: continue within accepted scope and policy; retain any new
judgment it cannot resolve as an explicit question. Do not infer cancellation
or new authority from the missing conversation.

**Q6 — Does every decomposition need parent approval?** A worker assigned A
realizes it needs A1 and A2. Their work stays within A's acceptance criteria.
May it publish the child tasks and dependencies under standing permission,
or must its parent approve that particular plan first?

Recommendation: allow publication under an explicit delegated scope, without a
parent round trip for every split. Changes to acceptance or work outside that
scope require another decision. Depth, growth budgets, partial publication,
writer stop, and parent completion are subsequent questions.

## Round 2 answers

- Q4: limited support is acceptable only if it is small and natural to add.
  Otherwise retain it as a later possibility. Do not expand this answer into a
  requirement for a new fallback framework.
- Q5: yes, continue. The user's reason is that Dalph cannot necessarily know
  what is happening with its orchestrator. An online orchestrator must not be
  presumed necessary to "hand back"; whether any handback exists remains open.
- Q6: whether a split needs approval is up to the user, workflow, and
  instructions. It is not settled that Dalph provides parent/child conversation
  at all, in any form. A configurable conversation/approval system is not
  implied by this answer.

## Priority ledger

| Item | Current disposition |
| --- | --- |
| Autonomous Dalph remains useful | Baseline to preserve |
| Simultaneous Runs in one repository | One Run initially; keep it simple |
| Caller executor selection | Not required; capacity is the relevant initial control |
| Capacity at startup | Candidate argument; existing selector remains relevant |
| Invoker and invokee coexist; agents can join an existing Run | Core direction |
| Existing authorized work does not require an online orchestrator | Core direction |
| Graph and frontier visibility | Tasks whether assigned or not, plus optional opaque executor association |
| Detailed executor/helper views | Later work; not an initial graph requirement |
| Native human access | Standing requirement; use native provider facilities where possible |
| Implementer yields for newly authored prerequisites (Q24) | Accepted later work within the current planned core Dalph feature set |
| Caller launches with prior Dalph involvement | Intended direction; separate research/prototype track after Q25 milestone selection |
| Caller or worker reports work after launch | Separate alternatives; investigate rather than lump together as caller-started |
| Workers lacking reliable lifecycle observations | Optional if small/natural; otherwise later candidate |
| Parent/child messaging, notification, or handback service | Not an agreed requirement |
| Mandatory parent approval of every split | Not a universal Dalph rule; workflow decides |

## Round 3

**Q7 — What is the first useful invokee experience?** An agent points Dalph
at tracker work and can inspect or direct the same delivery that Dalph already
runs autonomously. Dalph starts and supervises the workers. Is that enough for
the first useful version, or must that version also coordinate workers the
calling agent has already started?

Recommendation: start with the existing autonomous path made callable and
inspectable. Keep adopting caller-started workers as an important later use
case unless it is essential to the first workflow the user wants. This is a
priority decision, not abandonment of the broader direction or authorization
to implement it.

## Round 3 answers and correction

Q7 received tentative agreement. The user identified a conflation in
"caller-started workers": launch, registration, reporting, and accepted
responsibility must be considered separately. Tentative agreement does not
place all externally launched work in a later release.

The follow-up **Q8** asked whether a caller using native spawn tools could first
arrange an assignment with Dalph and then start the worker. Recommendation was
to preserve this as a core design scenario with implementation priority open.
The user is inclined to yes, with explicit uncertainty; do not record a final
architecture decision.

The user also identified distinct alternatives:

- Caller asks Dalph to launch work.
- Caller arranges work with Dalph before launching through its own host.
- Caller starts work and subsequently reports/registers it with Dalph.
- Worker reports/registers itself, potentially with something passed by caller.
- Work happens independently and is not registered with Dalph.

A "lease" obtained from Dalph and passed to the worker is one hypothesis, not
an accepted term or protocol. It is not decided who registers, who reports
progress, who requests release, or how Dalph discovers completion. Requiring
an agent to remember another MCP call may recreate the bookkeeping burden.
Do not assume a missing release or expired lease proves execution stopped.

## Deferred research/prototype: launch, registration, reporting, release

This branch needs concrete technical evidence before further mechanism choices.
No prototype or implementation is authorized by recording this research docket.
Compare the alternatives above on a minimal fixture and test these boundaries:

- Caller disappears after Dalph grants an assignment but before launch.
- Worker starts, but caller or worker's registration response is lost.
- Worker completes without sending a final report/release.
- Parent conversation is unavailable while worker reports or finishes.
- A report is repeated, stale, or names a different assignment.
- Any proposed lease expires while the worker still writes.

Compare effort, observability, whether the execution bound can actually be
promised, recoverability, and how much the model must remember. Discriminate
small natural support from a substantial optional feature. These are candidate
experiment seams, not passing acceptance tests or a settled requirement that
all hosts support every case.

## Round 4

**Q9 — Which children should the graph show?** Task A's worker asks two short-lived
helpers to investigate files and review its change; neither helper has a tracker
task. Should the graph show these helpers, or only the tracked delivery work?

Recommendation: keep tracked work and its frontier as the default graph, with
expandable helper/session detail where the host exposes it. Visible helper
activity need not imply a separate task or Dalph-owned lifecycle. This is a
presentation requirement question independent of who launches or registers work.

## Round 4 answer

Q9: the graph currently has task granularity, regardless of whether an executor
is assigned. Show the task plus its optional assigned executor. Executors remain
opaque. The recommendation to add expandable helper/session detail now was not
accepted; more detailed views are later work.

The user identified a related compositional question: an MCP lease may turn out
to be a kind of executor. Preserve this hypothesis for the deferred registration
research. Do not assume a lease is already a second independent resource model,
or add a LeaseExecutor type before defining what it does and how its reports
fit the existing opaque executor contract. Nor does this hypothesis establish
that lease expiry proves execution stopped.

## Round 5

**Q10 — Withdrawn: what completes the parent after decomposition?** A's worker creates
child tasks A1 and A2. Both are later delivered. Should A then be completed
from its children's completion alone, or can A still need work to establish
that its own acceptance criteria are met?

Recommendation: child completion does not by itself complete A. Keep A's
acceptance criteria explicit; the user's workflow can provide the remaining
verification through A or a declared verification task. No parent-agent
conversation or online orchestrator is implied. The precise policy and first
implementation behavior remain the user's decision.

## Round 5 correction: grouping is not blocking

The user identified Q10 as a conflation. Dalph does not need a special
"parent-task completion" rule merely because tasks are grouped. Explicit
blocker/prerequisite relationships determine dependency readiness. Completing a
blocker does not complete the blocked task. Q10 restated this existing semantic
instead of exposing a new decision, and is withdrawn.

Grouping remains relevant to graph membership and grouping-scoped controls in
existing Dalph. Do not turn this correction into removal of all grouping facts.
When discussing decomposition, identify the new tasks and explicit prerequisite
edges separately from tracker grouping and agent conversation ancestry. Earlier
research alternatives concerning automatic grouping-parent completion are not
selected behavior.

The user explicitly requested clarification in master's `docs/CONTEXT.md` if
needed. This is a documentation clarification of existing semantics, not a new
runtime requirement or an ADR-worthy behavior decision.

## Round 6 answers

**Q11:** user supports both asking Dalph to progress a scope and requesting
individual eligible assignments. This does not settle executor/lease mechanics.

**Q12:** user favors direct Dalph interaction, potentially through MCP to ask
for a dependency rescan or inspection of two specific tasks. Do not infer from
this that Dalph necessarily creates those tasks; publication versus notification
was initially open; Q13 clarified this notification: it says only "refresh your
graph" or "refresh the subgraph of these IDs". It carries no task-creation or
plan-publication payload.

The user welcomes supplied scenarios as options and wants one full user story
to give the interview shared context. This is not a request to replace all
scenario suggestions with an unstructured interview.

## Story 1: autonomous delivery gains an agent participant

Status: user accepted this story at Q13 with the corrections incorporated below.
It is an interview anchor, not a complete accepted implementation specification.
Recovery and recursive decomposition can be variations. It describes intended
use, not a claim that the entire live CLI is already shipped.

Alice wants CSV import in her application. The tracker has task A for parsing,
B for validation, and C for the import command; C explicitly depends on A and
B. C is the Run root and A/B are its supporting prerequisites. Git has a known
target head, there are no existing attempt claims or worktrees for this work,
no workers have begun, and there is no recorded Run for this invocation.

1. Alice starts autonomous Dalph for this work with capacity two. There is no
   separate orchestrator agent. Dalph establishes the Run, reads tracker facts,
   and begins the ordinary claim, exact Git planning, and executor protocols
   for eligible A and B. Required effect intents precede their boundary calls.
2. Alice opens the task graph. A and B show their assigned opaque executors;
   C is blocked by their unfinished prerequisites. Executor-internal helpers
   are not nodes in this initial view.
3. While A and B run, Alice opens Codex and asks it to help coordinate this
   delivery. The agent reads the existing Run through Dalph. It does not start
   another Run or duplicate either assignment.
4. The agent notices a missing documentation task D, which should depend on C
   and be included in this Run's tracker scope. It asks Dalph directly to
   "refresh your graph" or "refresh the subgraph of these IDs". D and its
   dependency have been authored in the tracker; the notification contains only
   the refresh request and, for a focused request, task IDs. Dalph reads the
   tracker through the applicable observation boundary.
5. Alice inspects B through its provider's normal client and, if that specific
   worker accepts direct input, helps clarify its behavior. This step involves
   conversation, not exclusive manual checkout editing. It does not itself
   change B's lifecycle, prove completion, or require a custom Dalph chat UI.
6. Alice closes the orchestrator conversation. Dalph continues authorized work
   without needing to detect that closure or deliver a handback message to it.
7. A and B are delivered. Dalph admits C through ordinary checks.
8. C is delivered; D becomes eligible through its own prerequisite facts and is
   then delivered. Claims, exact resource cleanup, and any outstanding workflow
   obligations settle according to their existing protocols.
9. Alice sees the completed task graph and final Run outcome after the required
   final tracker confirmation. A later agent can inspect the same recorded
   outcome without needing the original orchestrator's conversation.

No crash occurs in this base story; lost responses, an absent report, or a
caller dying between assignment and launch belong to named follow-on variants.
No provider mutation or test was performed to establish this proposed story.
Forbidden results: duplicate work when the agent joins; admission from partial
new-task facts; releasing execution capacity from a chat message; requiring an online orchestrator to finish; or
claiming all obligations settled while unresolved ones remain.

Candidate scenario-to-test seam AS1: a controlled end-to-end chronology asserts
one Run and exact attempts, capacity two, task-only projection, incorporation
of D before finality, no duplicate Begin on client join, continued delivery
without that client, C/D admission only after their prerequisite proofs, and
final disposition only after ordinary settlement and tracker reconfirmation.
Refresh-request and client boundaries need their accepted scenarios before
this can become an implementation test, rather than an illustrative fixture.

**Q13:** Is this a useful anchor story, or should the first full story instead
start with Alice asking an orchestrator agent to initiate delivery?

Recommendation: anchor on autonomous Dalph with an agent joining partway
through, because it exercises coexistence while preserving the baseline already
being developed. The agent-first and caller-spawned alternatives remain later
story variants, not exclusions from the design.

## Q13 answer and story corrections

- Story 1 is accepted as an interview anchor; keep multiple full stories.
- A person is not the only possible initiator: an executor could also start
  Dalph. Alice starting it is acceptable for this particular story.
- The notification says only "refresh your graph" or "refresh the subgraph
  of these IDs". It does not send a new graph, create tasks, or publish a plan.
- Remove redundant exposition of already-established blocker semantics from
  the story. Keep that rule in its owning glossary rather than repeatedly
  explaining that removing blockers does not complete a task.

## Story 2: the orchestrator plans and directs delivery

Status: user accepted Story 2 at Q14, with the corrections below. It is an
interview anchor, not a complete implementation specification. It uses Dalph's
existing opaque executor boundary. Caller-launched and lease-backed implementations remain
separate unresolved variants; this story does not choose their mechanism.

Alice opens her coding agent and asks it to plan and deliver CSV import. The
repository exists, but the feature's tracker tasks have not yet been authored.
There is no Dalph Run or active task attempt for this feature. The agent has
access to the repository and the user's tracker workflow.

1. The orchestrator examines the repository and discusses any needed product
   choices with Alice. It writes tracker tasks A for parsing, B for validation,
   and C for the command, with C depending on A and B.
2. It starts or connects to Dalph and asks it to start working, with the user's
   execution bound. The exact start request and scope selection remain open;
   do not presume that an arbitrary-subgraph command already exists. In this
   story, work is delegated across the selected scope; requesting individual
   assignments remains a separate supported design scenario.
3. Dalph reads the tracker at startup and subsequently on its schedule. The
   orchestrator inspects the resulting tasks, frontier, and optional opaque
   executor associations. Alice can inspect the same task graph. There is no
   required explicit refresh request at startup.
4. Dalph admits A and B within the bound and runs their executor workflows.
   The orchestrator can continue examining requirements instead of remembering
   the workers' individual cleanup and completion calls.
5. The orchestrator discovers that C also needs an example-data task E. It
   authors E and the explicit dependency in the tracker before C has started,
   then sends "refresh the subgraph of [C, E]" to Dalph. The request contains
   IDs, not the dependency facts themselves. Dalph's tracker reader owns which
   additional facts must be read to obtain a sufficient observation.
6. The orchestrator inspects updated progress when useful, responds to Alice,
   and uses the user's normal workflow for any further decisions. The story
   does not require Dalph to host parent/child conversations or push a handback.
   If Alice opens a worker directly, supported native interaction applies.
7. The orchestrator conversation becomes unavailable. Dalph continues the
   authorized scope. As A, B, and E deliver, C is admitted and delivered through
   the normal executor, Git, tracker, and cleanup protocols.
8. Alice or a later agent asks Dalph for the outcome. They see the completed
   tasks and recorded result without reconstructing it from the original chat.

The starting event is Alice's request to the agent. External boundaries are
tracker authoring by the agent's normal tracker tools, Dalph scope/direction and
refresh requests, tracker reads, and the existing executor/Git/journal workflow.
No crash occurs in this normal path. The unavailable conversation in step 7
need not be detectable by Dalph. Transport-response loss and partial tracker
editing need later failure variants; no new guarantees are inferred here.

Candidate scenario-to-test seam AS2: one controlled chronology covers tracker
creation through the ordinary tracker tools; initial and scheduled reads
without a required client refresh; explicit later refresh payloads containing
only a whole-graph request or IDs; authoritative observation before admission;
shared execution bound;
new prerequisite E observed before C starts; continued scope progress without
the invoking conversation; and final outcome inspectable from a later client.
The minimal refresh interface must not be mistaken for a new transactional
tracker-publication protocol. Tests must separately address partial or raced
tracker edits rather than pretending a refresh notification makes them atomic.

**Q14:** Does Story 2 capture the orchestrator-centered workflow, or should its
main path instead have the orchestrator request individual assignments and
launch workers through its own host?

Recommendation: keep Story 2 as the scope-directed case and give caller-launched
assignments their own Story 3, so the unresolved executor/lease protocol does not
become an implicit assumption of every agent-centered story.

## Q14 answer and startup correction

The user accepted Story 2. The agent need not request a graph refresh merely
because it starts Dalph: startup and scheduled reads already supply that path.
An explicit later refresh remains possible after tracker edits. The agent can
ask Dalph to start working, but the exact API and meaning of the selected scope
are not yet settled. The user specifically requested checking whether starting
work on a subgraph exists; this is a repository fact to investigate, not a
question for the user to remember.

## Current-source check: starting work and graph refresh

Read-only lookup in this interview worktree established:

- The public binary enters `productionCliApplication`; `application/live-cli.ts`
  supports `dalph run <target> --production --config ...`, with a GitHub issue
  target. The older dry-only `application/cli.ts` is not this public entry.
- Delivery starts from one selected root task. The graph includes that root,
  grouping descendants, and supporting prerequisites. An arbitrary set of task
  IDs or narrowing an existing Run's scope is not the same supported input.
- Startup and scheduled reactivation read tracker facts. No explicit client
  refresh is required just to begin. The production timer defaults to one minute
  and is configurable; notification opportunities also exist.

Sources: `packages/dalph/bin/dalph.ts`,
`packages/dalph/src/application/live-cli.ts`,
`packages/dalph/src/application/production.ts`,
`packages/orchestrator/src/coordination/run/run-reactivation-owner.ts`,
`packages/orchestrator/src/authorities/task-tracker/github/graph-reader.ts`,
and `docs/CONTEXT.md` (Run root task and Run task graph).
This is current-source evidence, not a live provider or installed CLI test.
Earlier research inspected a different original-workspace snapshot; the index
records that provenance distinction.

## Story 3: an orchestrator uses its own worker host

Status: user accepted Story 3 at Q15 as an interview anchor. Launch, registration,
reporting, and release mechanisms remain unresolved. This is not approval of a
lease or registration implementation.

Alice is already working in an agent host whose worker-launch and conversation
features she wants to use. The tracker contains the work and its dependencies.
Dalph has capacity to admit another task; no worker for that next assignment
has started. The caller may itself be executing a broader assignment: invoking
Dalph does not require a permanently distinct orchestrator persona.

1. Alice asks her agent to continue the tracked work using that host's workers.
2. The agent connects to Dalph and requests an eligible assignment. Dalph checks
   the task/dependency facts and the execution bound before accepting it.
3. The caller starts a worker through its host. How that start is coordinated
   with Dalph, and whether caller or worker reports the association, is the
   explicitly deferred executor/lease research. No startup protocol is assumed.
4. Alice and the caller see the task with its opaque assigned executor in Dalph.
   Alice can use the host's ordinary worker interaction where supported.
5. The worker does the task. Through the eventual executor contract, Dalph
   obtains the evidence required to progress integration, tracker reflection,
   capacity accounting, and exact cleanup.
6. The caller inspects progress and requests further assignments when useful.
   Completing accepted work does not require a return message to an online
   caller. Whether Dalph can independently start further unassigned workers
   depends on the permission and executor arrangement, not merely on the
   caller disappearing.
7. Alice or another agent later inspects the task graph and settled outcome.

No crash is included in this normal path. The deferred prototype docket owns
start-response loss, absent registration, missing final reports, and expired
leases with active writers. This story is only feasible for executor arrangements
that satisfy the selected guarantees; ordinary MCP self-reporting is not assumed
sufficient. Low-observability support remains conditional on small/natural effort.

Candidate scenario-to-test seam AS3: once the start/registration contract is
selected, assert admission before caller-host work begins, exact assignment
association, task-level progress, retained responsibilities without an online
caller, no duplicated launch after ambiguous responses, and ordinary finality
only from adequate executor/tracker/Git evidence. This is not an implemented
or accepted executable test.

**Q15:** Is this the caller-launch story to keep beside Stories 1 and 2, with
step 3 deliberately left for research/prototyping?

Recommendation: retain it at the user-story level without deciding a lease,
reporting actor, or manual release call yet.

## Q15 answer and story-round closure

The user accepted Story 3 and asked whether the story work is complete. Three
main stories now anchor the interview:

1. Autonomous Dalph, with an agent optionally joining the same Run.
2. An orchestrator plans tracker work and directs Dalph's delivery.
3. An orchestrator requests assignments and uses its own worker host.

No further full story is necessary before continuing the design interview.
Short failure, human-intervention, or recursive-planning variants can be added
when they resolve a concrete question. Q16–Q17 subsequently settled initial
selection and intermediate-edit behavior; Q18–Q19 are answered below; Q20 is answered below; standalone MCP deployment is under investigation. Story acceptance does not settle the
executor/lease protocol, graph-scope commands, reporting guarantees, or first
implementation priorities, and does not authorize implementation.

The next interview stage should use these stories to define the caller-facing
responsibilities and interactions, leaving technical feasibility questions in
the research/prototype docket rather than asking the user to guess at them.

## Round 7: selection and intermediate tracker edits

**Q16 — Who chooses the next task?** The user chose Dalph selection for first
implementations. Caller-selected tasks and prioritization are later work,
possibly using a more general task-tracker facility. The assistant's initial
recommendation to support both selection forms immediately was not accepted.
This does not remove support for requesting an individual assignment: Dalph
chooses which assignment to offer.

**Q17 — Tracker edits are observed between calls.** If an agent creates D and
adds blockers in a later call, the first implementation may admit D from the
intermediate graph with no blockers. The user explicitly accepts this behavior
for now. Do not require a pause, graph-edit transaction, or publication barrier
as part of the first implementation. This concerns a real observed intermediate
tracker state, not treating incomplete/unreadable provider evidence as complete.

Later readiness mechanisms may make an unfinished task or graph edit visible:
a ready-for-agent label, drafts, not-ready tags, or another configurable tracker
condition. No mechanism is selected. Reuse tracker capabilities where appropriate
rather than presuming a new Dalph edit-state service.

## Priority updates from Q16–Q17

| Item | First implementation | Later possibilities |
| --- | --- | --- |
| Task selection | Dalph chooses eligible work | Caller preferences or tracker-owned prioritization |
| Multi-call tracker editing | Act on the observed graph, including intermediate authored states | Visible readiness conditions, drafts, tags, or editing state |
| Explicit refresh | Whole-graph or ID-scoped refresh request; no publication payload | Additional mechanisms only if subsequently selected |

The partial-publication barriers proposed in earlier research and AS1/AS2 are
not first-implementation requirements after Q17. Update any selected acceptance
story to assert the accepted observed-graph behavior; do not claim a guarantee
that D waits for an edit Dalph cannot know is unfinished. Existing completeness
and reconciliation requirements at the tracker-read boundary remain distinct.

## Round 8

**Q18 — A second delivery in the same repository.** Dalph is already working on
one root task when another agent asks it to work on a different root in the same
repository. Does the first version need to run both simultaneously, or can it
report the existing Run and require the caller to wait or use that Run?

Recommendation: one active Run per repository initially. Multiple callers can
inspect/direct that Run. Independent simultaneous Runs need an explicit shared
capacity and overlapping-task policy and can remain later work.

**Q19 — Choosing an executor.** When asking Dalph to start work, must the caller
choose an executor configuration, or is the repository's configured default
sufficient initially?

Recommendation: use the configured default first, with executor selection kept
as an explicit future capability. The native-launch/lease-backed executor path
remains a desired separate scenario; this question does not decide its protocol
or introduce executor-private stages into the graph.

## Round 8 answers

- Q18: one Run per repository for now; choose the simplest arrangement. Multiple
  callers can use that Run. Independent simultaneous Runs are not initial scope.
- Q19: the caller need not select an executor. The user emphasized the existing
  capacity selector and suggested capacity as a startup argument. Keep capacity
  separate from executor identity or implementation selection. Startup argument
  spelling, defaults, and existing-Run behavior are not selected by this answer.

## Round 9

**Q20 — First agent-facing entry point.** Is MCP required for the first useful
invokee version, or would an agent calling a CLI with structured results satisfy
that first step?

Recommendation: use MCP as the intended agent-facing entry point, reusing the
same application operations as the CLI. Do not let choosing the transport imply
new executor/lease or parent/child conversation protocols. If this choice is
still uncertain, record it for the bounded interface prototype rather than
forcing a premature commitment.

## Round 9 answer and follow-up research

- Q20: application operations should be callable through either MCP or CLI.
  The user points to `../hulymcp` as a concrete precedent for their distinction
  and architecture. This does not select a lease or conversation protocol.
- The user also identifies possibly standalone MCP in `../dnd`: MCP may be
  detached from the main server. Investigate the actual arrangement before
  choosing whether it applies to Dalph. Independent transport deployment,
  ownership of an active Run, and continued work after a caller disconnects
  are separate questions; no daemon or deployment topology is selected yet.

## Standalone MCP precedent check

Read-only local source research confirms two different precedents:

- Hulymcp CLI calls shared `operation.execute` directly
  (`../hulymcp/packages/huly-cli/src/runner.ts:228`); MCP adapts the same operation
  (`../hulymcp/src/mcp/tools/registry.ts:341`). Its CLI parity contract explicitly
  excludes proxying CLI through MCP. Shared code does not imply shared process.
- Dnd standalone stdio hosts application services (`../dnd/packages/mcp/src/index.ts:7`).
  Public HTTP composes SQLite and authorization (`public-index.ts:75`) and local
  application services (`public-http-server.ts:58`). ADR 0008 describes both
  transports as projections of one application. This is standalone hosting,
  not merely forwarding to the UI server.
- Dnd's stdio and public HTTP do not automatically share a live session owner;
  `../dnd/packages/mcp/README.md:130` says the stdio tunnel does not use the public
  database. This precedent does not establish independent worker supervision.

Dalph implication (inference, not a selected architecture): separate deployment
of MCP and the UI is compatible with shared operations. A single active Run
still needs coordinated scheduling and capacity ownership. Standalone MCP may
host that owner or connect to it elsewhere. Shared code or persistence alone
cannot establish that coordination. Caller disappearance is already covered by
Q5; the remaining deployment question includes what happens when the MCP host
process itself exits. Do not conflate those failures or invent a daemon mandate.

## Round 10

**Q21 — The agent host closes its MCP process.** An orchestrator starts Dalph
work through MCP. The user then closes the agent application, which also stops
its local MCP process. Should the accepted work keep running in the first useful
version?

Recommendation: yes for the agent-facing workflow. Allow MCP to connect to an
independently running Dalph Run; do not yet require automatic background startup
or pick a daemon implementation. Standalone MCP deployment and Run hosting
remain separate decisions.

## Round 10 answer

- Q21: yes, accepted Dalph work must continue when the agent application and
  its local MCP process terminate. The user emphasizes the deployment case
  where each agent client launches its own MCP process.
- In that case, the MCP processes connect to the same active Dalph Run rather
  than independently owning its scheduling or capacity. Their process lifetime
  must not determine the Run lifetime. This does not select an IPC protocol,
  daemon manager, or automatic startup mechanism, nor imply every MCP transport
  requires a separate server process per agent.

## Round 11

**Q22 — No Dalph is running yet.** An agent asks its MCP process to start work,
with no Dalph Run currently running. Must that request start Dalph independently,
or may the first version require the user to start Dalph beforehand?

Recommendation: retain agent-initiated startup as the intended behavior, as in
story 2. Investigate the smallest lifecycle implementation before deciding
whether automatic startup belongs in the first milestone. An explicit startup
operation is sufficient; merely connecting or inspecting need not start work.

## Round 11 answer

- Q22: choose the simplest solution for now. Working interpretation stated to
  the user: start Dalph separately initially; MCP/CLI connect to it. Automatic
  agent-triggered background startup is later work. This narrows the first
  milestone of story 2 without removing agent-initiated startup as a later
  possibility. No process manager or startup command syntax is selected.

## Round 12

**Q23 — A worker stops reporting.** For the possible caller-launched worker
path, Dalph has admitted a task, but MCP reports stop and the execution host
cannot establish whether its worker is still running. Can the first version
leave the attempt visibly unresolved and keep its capacity occupied until
execution can be checked or the user intervenes?

Recommendation: yes. Silence alone must not free capacity or trigger worktree
cleanup while the worker could still be using it. Automatic release would need
an enforceable way to stop or exclude continued execution. This question does
not select a heartbeat or lease protocol or commit to shipping caller-launched
workers in the first milestone.

## Round 12 answer

- Q23: accepted. If a caller-launched worker stops reporting and Dalph cannot
  determine whether it is still running, leave the attempt visibly unresolved
  and retain its capacity slot until verification or user intervention. Silence
  alone does not authorize release or worktree cleanup. The intervention
  mechanism and evidence required for release remain unspecified.

## Round 13

**Q24 — An implementer adds prerequisites for its own task.** While executing B,
its worker discovers more work, creates D and E in the tracker, and makes them
prerequisites of B. With capacity one, keeping B's worker running while it waits
would prevent D and E from starting. Should the worker be able to end this
attempt as unfinished, so Dalph can release its slot after verifying execution
has stopped, execute the prerequisites, and later attempt B again?

Recommendation: yes as the intended recursive-planning behavior. Initially the
worker can exit rather than require suspended sessions. Preserving useful Git
work and distinguishing this outcome from failure need design; no cleanup or
attempt-outcome protocol is selected by accepting the story.

## Round 13 answer

- Q24: accepted, but later. The user places this behavior within the current
  planned set of core Dalph features. It also serves autonomous execution and
  is not specific to MCP or the invokee pivot. This records product placement,
  not a verified existing implementation or ticket. Preserving partial Git
  work and the unfinished-attempt protocol remain unresolved.

## Round 14 and answer

**Q25 — First useful milestone.** An agent connects to an already-running
Dalph, inspects its graph/frontier, requests work, and adjusts capacity, using
existing Dalph-managed executors. Keep caller-launched workers and their
registration/release mechanics as a separate research/prototype track within
the intended direction.

- Q25: accepted. Application operations remain callable through MCP or CLI.
  This settles the initial product slice, not the exact work-request scope,
  transport/deployment implementation, or authorization to implement.

## Remaining initial-scope question

**Q26 — Which work can the caller request?** Is the existing single Run root
and its tracker-derived graph sufficient initially, or does the first milestone
need arbitrary selected task IDs within that graph?

Recommendation: use the existing rooted graph initially. Arbitrary task-set
selection remains later scope unless required by an accepted story. This does
not imply grouping creates blockers, nor select how a request starts/resumes
work within an already-running Dalph process.

## Q26 answer and milestone scope

- Q26: the existing single-root Run graph is sufficient. The user explicitly
  says not to plan arbitrary task selection. It is outside the plan, not a
  deferred feature or backlog commitment. Earlier suggestions to defer it are
  superseded. Refreshing specified task IDs remains distinct from selecting
  arbitrary tasks for execution.
- Initial milestone: agents use MCP or CLI to connect to separately started
  Dalph, inspect the task graph/frontier, request work within the existing
  root-based scope, and adjust capacity. Dalph chooses eligible tasks and uses
  existing Dalph-managed executors. One Run per repository; caller/MCP process
  exit does not stop accepted work.
- The initial product-scope questions are settled. This does not settle the
  application hosting/connection mechanism or constitute implementation
  authorization. Next design work should consolidate the accepted operational
  story and check existing operations against it, preserving the independent
  research track for externally launched workers and later core recursive
  planning. Do not reopen deferred mechanics as initial-milestone blockers.

## Records and provenance

The eight research notes and their index additions were moved from
`/workspace/typescript/dalph` to this worktree and byte-verified before removal
from their original paths. The original research index retains its preexisting
content; only this conversation's additions were transferred. Unrelated original
workspace changes were left in place.

Worktree: `/workspace/typescript/dalph-worktrees/invoker-invokee-interview`.
Branch: `research/invoker-invokee-interview`.
Base: `76696349e30912e5d71c5f649aeee4d06e90d9ff` (`master` at creation).

No implementation plan or new runtime acceptance claim has been made. Existing
research scenario-to-test mappings are candidate seams; later accepted scenarios
will name the selected outcomes and governing behavior.
