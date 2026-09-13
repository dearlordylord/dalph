# Agents that subdivide their assigned work

Later interview decisions govern scope: planners initially edit the tracker
directly and send only refresh hints to Dalph. Q17 accepts execution from a
complete intermediate tracker state before blockers are authored; the publication
barriers and Dalph-authored graph proposals below are exploratory alternatives,
not initial requirements. Q24 retains unfinished implementer yielding as later
core work. Parent conversation, handback, grants and non-executable container
tasks are not required. See the [coverage audit](invokee-spec-readiness-audit.md)
and [accepted milestone](invokee-first-milestone.md) before deriving work from
these older candidate scenarios.


Status: research and candidate design, 2026-09-13. The user has added preserving
recursive planning as a requirement for the ongoing design exploration. The
specific protocols below remain proposals. This file changes no Dalph runtime
behavior, configuration, or accepted domain vocabulary. No provider mutations
or implementation tests were performed.

## Begin with the work Alice sees

Alice asks her orchestrator to deliver issue R with two executing task attempts
at once. R groups A and B. A's executor discovers that its assigned API change
requires a migration, an adapter, and a combined acceptance check. It asks Dalph
to add A1, A2, and A3 under A, with A3 blocked by A1 and A2. It supplies the
original acceptance criteria, the reason for the split, and evidence of any
work already done.

Dalph checks permission and current GitHub facts, applies a recoverable sequence
of tracker changes, and shows the new graph to Alice and the parent agent.
After Dalph has proof that the original executor stopped safely, another task
can use its execution position. The same repository coordinator admits the new
work within Alice's limit. A1 can later discover another useful subdivision.
None of this requires the original planning conversation to stay alive.

A remains an outstanding delivery requirement. A planning response is not an
accepted implementation, completion of A1 and A2 is not proof of A3, and A3's
result must satisfy the original acceptance criteria before A can close. If a
child needs a change outside A, the request must identify that boundary instead
of quietly expanding its permission.

This makes sense as a product requirement. The important distinction is between
**recursively asking agents to plan** and **recursively creating independent
schedulers**. The first can work with one scheduler and one shared bound. The
second adds ownership, recovery, and resource-accounting requirements that are
not necessary for the first.

## What the repository already supports

The following are source observations, not a claim that recursive planning is
implemented:

| Existing behavior | Consequence for this proposal |
| --- | --- |
| Later complete tracker reads can change tasks, grouping, dependencies, and lifecycle | The Run graph is already allowed to grow; a static graph assumption need not be introduced |
| Grouping descendants are included from the root; transitive prerequisites also enter the Run | Newly attached descendants can become Run work after sufficient observation |
| Supporting prerequisites do not bring their own grouping descendants automatically | Adding children to a shared prerequisite is insufficient unless explicit prerequisite edges connect required work |
| Grouping and prerequisites are separate edge types | Being a sub-issue does not itself block a parent or make its completion automatic |
| Eligibility checks open lifecycle and satisfied explicit prerequisites | An open parent with open children and no blockers can currently be eligible |
| Every attempt fixes task specification, Base SHA, branch, worktree, and executor association | A split cannot silently mutate an existing attempt into several new assignments |
| Safe suspension/terminal evidence releases task-work capacity; integration and cleanup remain separate obligations | Planning handback alone cannot release capacity or dispose files |
| One coordinator owns repository mutations | Multiple planner conversations should initially share this owner |

Sources: [tracker architecture](../docs/architecture/tracker-graph-and-claims.md),
[TaskDagSnapshot, including eligibleTaskIds](../packages/orchestrator/src/authorities/task-tracker/graph.ts),
[graph independence tests](../packages/orchestrator/src/authorities/task-tracker/graph.test.ts),
[architecture](../docs/ARCHITECTURE.md), and
[executor report contract](../packages/contracts/src/executor.ts).

A subtle detail: the actual attempt planner binds the focused normalized title
and body fingerprint. Adding a grouping edge or prerequisite does not itself
change that authored-content fingerprint. Graph eligibility can still change,
but this is a different phenomenon from changed instructions. The repository
also has a graph projection fingerprint helper used in projections; do not
mistake it for the specification fingerprint in the final planned attempt.
Sources: [task-work specification](../packages/contracts/src/task-work-specification.ts),
[attempt planner](../packages/orchestrator/src/workflow/protocols/task-attempt-planning/plan.ts),
and [planner properties](../packages/orchestrator/src/workflow/protocols/task-attempt-planning/plan.property.test.ts).

The low-level GitHub client already has `CreateIssue`, `AddSubIssue`, and
`AddBlockedBy`, and qualification tests use those operations. That is useful
plumbing, not the full agent-authorized graph-change protocol: the research did
not find an existing production workflow implementing scoped proposal admission,
partial application, creation recovery, and handback together.
Sources: [GraphQL client](../packages/orchestrator/src/authorities/task-tracker/github/graphql-client.ts),
[qualification fixture](../packages/orchestrator/src/authorities/task-tracker/github/qualification-issue-72.test.ts),
and [previous exploration](agent-driven-dalph.md).

## Keep several relationships distinct

1. **Task grouping:** A1 is part of the delivery scope of A. The tracker owns it.
2. **Dependency:** A3 cannot proceed until A1 and A2 succeed. The tracker owns it.
3. **Conversation ancestry:** agent W asked agent V for help. The executor owns it.
4. **Permission:** V may request particular edits within A. A future delegation
   boundary must own this; it is not inferred from conversation ancestry.
5. **Workflow responsibility:** Dalph still owes completion reflection or exact
   cleanup even when V is gone. Its journal retains the relevant history.
6. **Acceptance:** the original obligation is satisfied by specified evidence;
   the number of finished conversations or child issues does not prove it.

These are descriptions of distinct proposed phenomena, not newly accepted
canonical terms. In particular, dependency closure is a visibility/read rule,
not a grant to edit every prerequisite it includes.

## Three viable ways to arrange planners

### A planner publishes a decomposition and returns

This is the simplest useful initial arrangement. It creates a proposal, obtains
a durable outcome reference, and returns it to its caller. Dalph can reconstruct
the applied changes and continue without that caller. The next eligible leaf is
chosen by the existing shared admission machinery, rather than by a permanently
running parent loop.

A planning-only conversation outside an existing attempt need not consume a
repository task-work position. Its model session can still consume a separate
host/session budget. Today every planned task attempt requires an exact Base
and worktree, so a cheaper planning assignment needs an explicit new contract;
it cannot be achieved by silently making those existing fields optional.

### A planner remains a supervisor for its subtree

The planner can monitor progress, answer questions, and propose later changes
under the same scoped permission. It is a client of the shared coordinator.
Waiting should not require an active model generation or occupy a task-work
position. Its disappearance must not erase child tasks or cleanup obligations.
This supplies recursive judgment without nested scheduler ownership.

### Each subtree gets its own durable orchestrator

Keep this possible, but defer selecting it. A child must draw from the ancestor's
resource budget, preserve claims across overlapping dependencies, and retain
its descendants when its own conversation or process exits. Static partitions
waste capacity; independent per-parent limits multiply the actual total.
Giving each subtree its own Run in one repository also conflicts with the
current V1 activation/lifecycle constraints and single mutation owner unless
explicitly redesigned. Distributed or separately administered repositories may
justify this later; mere recursive decomposition does not.

Recommendation: make the first arrangement work and keep the second compatible.
Use the third only when a concrete deployment requires independent ownership.

## What handback must mean

An illustrative proposal should name the exact Run, delegated scope, source
attempt if one exists, relevant observed facts, original acceptance obligations,
new task descriptions, grouping edges, blocking edges, preserved existing work,
and the requested future disposition of the parent.

Its outcome should distinguish: proposed, partially applied, confirmed applied,
rejected, and uncertain external result. These are candidate semantics, not an
API commitment. The parent receives the exact task references and reasons; it
does not have to recreate the plan from an informal transcript.

Three events must remain independent:

- The decomposition has been recorded/applied.
- The planner has finished explaining or relinquished its permission.
- The executor and all owned activity have stopped safely.

Only the last supplies the evidence needed by the applicable capacity protocol.
A returned tool handle, expired permission, or chat message cannot stop a shell
already writing. The current executor terminal variants are Accepted,
Completed, and Failed. Do not reinterpret one as “split into children” without
an accepted contract defining its effect on outstanding task delivery.

## Parent acceptance and the fixed Base

Two plausible parent policies remain open:

- A remains an executable final acceptance task blocked by the children. After
  they deliver, a new permitted attempt validates the original requirement.
- A becomes a grouping obligation with a declared aggregate acceptance rule,
  potentially including an explicit final validation child.

The second requires a new tracker/workflow distinction; the current graph does
not contain a non-executable container task kind. The first fits existing
eligibility better, but still requires an explicit disposition for an existing
attempt and permission to start its successor. Neither policy should erase
previous acceptance scenarios or blocking edges. Removing an existing blocker
or narrowing acceptance requires a separately authorized decision.

An existing safely suspended attempt keeps its original Base SHA and worktree.
If children integrate into the target while it waits, “resume the parent” does
not mean “quietly move it to the new target.” Options are a separately qualified
same-attempt operation consistent with its original lineage, or an authorized
successor attempt planned against the now-current target. Prefer the latter
for a fresh combined acceptance phase, subject to defining that transition.

If A already has dirty work, the proposal needs a concrete disposition: retain
it for later investigation; finish an accepted foundation change before
children; or explicitly transfer selected evidence/commits through a qualified
protocol. Copying a dirty directory into children, force-resetting it, and
relabeling it as a different attempt are not implied by accepting a split.
Git ownership remains exact throughout.

## GitHub supports hierarchy, but publishing it is not one atomic action

GitHub documents up to 100 sub-issues per parent and eight nested levels. Treat
that as a provider constraint, not a promise that Dalph supports arbitrary depth
or width. Dalph separately bounds graph reads to 1,000 tasks and ten pages per
relationship connection. The graph viewer should explain a limit rather than
publish a truncated frontier. [GitHub sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues),
[Dalph bounds](../docs/architecture/tracker-graph-and-claims.md).

GitHub exposes separate creation, attachment, and dependency operations. Adding
a sub-issue can replace its existing parent when explicitly requested, and the
REST attachment endpoint requires the same repository owner. Therefore a
shared prerequisite should normally keep one grouping parent and have multiple
dependants. Moving it or editing its acceptance is a separate cross-scope
request. [Sub-issue API](https://docs.github.com/en/rest/issues/sub-issues),
[dependency API](https://docs.github.com/en/rest/issues/issue-dependencies),
[issue creation API](https://docs.github.com/en/rest/issues/issues).

A multi-step publication can expose a child before its blockers exist. It needs
an explicit recoverable admission barrier covering affected work. Possibilities
include a durable workflow publication responsibility that inhibits affected
admission until confirmed, or tracker facts that express a publication hold.
Which is appropriate remains undecided. A process-local mutex alone fails after
a crash; a journaled responsibility is not a second authoritative task graph.
Creating issues outside the selected root first reduces exposure but cannot
prove they are absent from every other Run or client. Partial issues must also
remain discoverable after a lost attachment response.

Likewise, the clientMutationId sent by the existing GraphQL client is not proof
of server-side issue-creation deduplication. A lost creation response requires
recoverable tracker correlation with explicit uniqueness/coverage semantics,
or an unresolved outcome that forbids blind creation retry. An eventually
consistent text search returning no hit is insufficient proof that nothing was
created. No live mutation experiment was performed to invent stronger semantics.

Concurrent GitHub edits remain possible while Dalph acts. The adapter has no
transaction-wide graph version. Scope, current parent, blockers, and acceptance
need their relevant fresh checks; a previously rendered graph cannot supply a
compare-and-swap guarantee the provider does not have.

## Candidate operational scenarios and acceptance seams

These scenarios are research candidates, not accepted implementation authority.
The tests named are required seams, not tests run by this investigation. They
must be expanded/accepted under [the scenario gate](../docs/OPERATIONAL-SCENARIOS.md)
before implementation. Existing runtime obligations retain their own governing
protocols rather than being redefined here.

| Scenario and chronology | Visible/forbidden result; acceptance seam |
| --- | --- |
| RP1: Alice grants planning scope A; A has no active attempt, no claim/worktree, and no pending edit. Planner proposes A1/A2/A3. Dalph records request, checks GitHub, applies exact edits, observes complete required facts, then returns confirmed references. | Alice and parent see the same expanded graph. A3 cannot run before blockers are known. `publishes children and blockers before admitting affected work`. No Git/executor calls are needed for this planning-only request. |
| RP2: Alice's A and B each occupy the two positions and both propose children. Dalph retains both positions until exact executor stop evidence, then admits eligible children from one shared pool. | Progress becomes possible without exceeding two executing task attempts. `all parents handing back do not deadlock children or release running writers`. Crash at either stop boundary reconstructs exact outstanding activity before admission. |
| RP3: GitHub creates A1, but the creation response is lost before observation is journaled. Dalph restarts and checks the declared tracker correlation. | Reuse an exactly established match, or expose uncertainty and retain the admission barrier. Never silently create another A1. `lost child creation response never causes blind duplicate create`. |
| RP4: Dalph attaches A1, then crashes before adding A1's prerequisite. On restart it reconstructs the unfinished publication and checks actual GitHub edges. | The graph can show partial work honestly; A1 is not admitted prematurely. `restart between attachment and dependency preserves publication hold`. Include external concurrent edge edits and a provider throttle; do not retry throttled mutations. |
| RP5: A has a planned attempt at H with uncommitted work. Worker proposes a split. Dalph observes exact executor/Git facts and waits for a declared work disposition and stop proof. | Alice sees preserved work and pending decision; no implicit reset, copy, deletion, or replacement Base. `dirty implementation split retains exact worktree until disposition qualifies`. Crash after stop but before disposition still retains files. |
| RP6: Children finish and integrate after A suspended at H; target is now J. Dalph follows the selected parent policy, plans a successor only if authorized, and checks original acceptance. | “Children completed; parent acceptance pending” stays visible. `children success neither closes parent nor rebases its existing attempt`. A lost tracker-completion response uses the existing completion reconciliation protocol. |
| RP7: A's planner asks for a dependency on shared S outside A. Another planner already uses S. Dalph checks edge-edit permission independently from read closure and observes S. | One shared task with multiple dependants; no duplicate S, implicit reparent, or expanded mutation grant. `cross-scope prerequisite requests preserve shared task ownership`. Crash recovery checks exact requested edge before retry. |
| RP8: Alice moves a child outside A or revokes the grant while a stale planner holds a request. Dalph checks current scope and grant at the command boundary. | Stale edit rejected before mutation; existing attempts/cleanup remain discoverable. `subtree moves and revocation do not authorize stale edits or forget obligations`. No crash is required for this race; a lost response still reconciles any already-sent effect. |
| RP9: Planner's parent conversation disappears after confirmed publication but before receiving handback. A replacement parent inspects the Run. | Existing child IDs, acceptance, receipts, and waits survive; no duplicate publication and no dependence on return delivery. `parent replacement discovers existing decomposition`. No new Git operation is needed to recover the planning outcome. |
| RP10: A descendant proposes a ninth nested GitHub level, a cycle, or a graph larger than the accepted read bound. Dalph validates what is knowable and returns a typed rejection/failure. | No partial graph is treated as complete or eligible frontier. `recursive expansion respects provider and graph bounds`. Include negative cycle controls and partial provider failures. |

## Open decisions to retain in future design work

- Whether initial planning is an independently budgeted assignment or always
  happens inside an executor; existing task-attempt invariants remain intact.
- Whether a split parent is final executable acceptance work or a separately
  modeled grouping obligation, and how its old attempt is dispositioned.
- What exact evidence permits publishing a multi-call plan and recovering an
  ambiguous issue creation; provider acknowledgement alone is insufficient.
- Whether scope is the current grouping subtree, an explicit set, or a grant
  that can extend to subsequently created descendants. Reparenting must not
  silently transfer permission.
- How fairness, session budget, total task growth, and decomposition depth are
  controlled. A bound on executing attempts alone does not bound plan size or
  model cost.
- Whether parent conversations are notified, awakened, or merely inspectable;
  this should not decide who owns scheduling or durable obligations.

The compatibility requirement to preserve now is: any authorized worker may
ask to decompose its work; the resulting durable tasks can be scheduled and
further decomposed without requiring every ancestor conversation to remain
active. A fully recursive orchestrator deployment can remain an option.
