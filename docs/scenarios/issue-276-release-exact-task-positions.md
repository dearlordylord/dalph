# B, C, and D release positions while their integration waits

## Governing behavior

This controlled G5 fixture refines [#256 DS-21](https://github.com/dearlordylord/dalph/issues/256)
and [#276](https://github.com/dearlordylord/dalph/issues/276). When an executor
reports terminal work, preserve the [planned executor boundary](planned-attempt-executor-boundary.md)
and `executingAndUnsettledWorkRetainsPosition`, `terminalReleasesPosition` in
[`plannedAttemptExecutor.qnt`](../../specs/plannedAttemptExecutor.qnt).
When the next result asks to integrate, preserve [accepted-result admission](issue-56-queue-accepted-integration.md)
and the target ordering laws in [`acceptedResultIntegration.qnt`](../../specs/acceptedResultIntegration.qnt).
This fixture does not extend #275's stopped G5 discovery recording. #277 owns
completion finality, #278 owns termination, and #279 owns uninterrupted A settlement
and composition of the whole story.

## Starting situation and chronology

Alice observes a controlled Run whose complete G5 graph contains A through G.
A is already successful and has no outstanding responsibility. B, C, and D
have distinct claims, planned attempts, branches, worktrees, and executing reports;
they hold all three positions. E, F, and G are open and unstarted. Git owns one
shared target ref. The executor, tracker, Git, Integrator, evidence store, and
Journal are controlled boundaries interpreting the production workflow.

No person commands an executor to finish. B's executor independently makes its
exact terminal Accepted report available through the passive report boundary.
Dalph records the correlated executor observation and then accepts the terminal
report durably. Only then does B's position become available. Dalph creates B's
separate integration responsibility and admits E in graph order. Hold B's
Integrator response while C then D report acceptance: F then G must begin,
although B still occupies the integration target. E, F, and G subsequently
report acceptance in that order. Release the controlled Integrator calls in
B/C/D/E/F/G order. Each receives its own result, session, candidate resource,
and head current at its turn; Git qualifies its distinct candidate.

Alice sees three independent executor positions and a separately serialized
integration target. Executor acceptance alone is never tracker success or Run
termination. The fixture uses ordinary completion boundaries only to let the
next integration responsibility proceed; their detailed finality proof remains
#277's responsibility.

## Crash and retry

Cut B's terminal path before its executor-state observation is durable, after
that observation but before terminal acceptance, and after terminal acceptance
but before integration responsibility. Rebuild the application with the same
Journal and executor-owned report. Before acceptance the exact position stays
held. Restart projects or accepts the pending exact report, reuses the same
attempt, and creates one responsibility. It sends no second Begin or Resume
and records no duplicate terminal report. Unavailable or foreign report evidence
retains the position and authorizes no E admission.

## Scenario-to-test mapping

| Scenario | Acceptance test in `issue-276-position-release.test.ts` |
| --- | --- |
| B/C/D release only after durable acceptance, admitting E/F/G while B integrates | `releases B C and D positions to E F and G while B holds integration` |
| Integration retains B/C/D/E/F/G order and distinct identities | `serializes distinct B through G sessions resources and candidates in accepted order` |
| Crash before executor-state observation | `recovers B at BeforeObservation without another executor command` |
| Crash after observation, before acceptance | `recovers B at AfterObservation without another executor command` |
| Crash after acceptance, before responsibility | `recovers B at AfterAcceptance without another executor command` |
| Unavailable evidence retains B's exact position | `retains every occupied position when B terminal evidence is Unavailable` |
| Foreign evidence retains B's exact position | `retains every occupied position when B terminal evidence is Foreign` |

Forbidden release and duplication preserve delivery invariants D12, D14,
and the executor/integration laws linked above. There is no live-provider retry:
all interruptions and responses are deterministic local boundary controls.

When Dalph has just acquired the exact authorized task claim, that successful
GitHub boundary result already establishes the claim-check chronology. After
checking the graph, Dalph must proceed to the Git lineage read and Integrator
without waiting for a redundant focused claim read. The six-session test covers
this path for freshly acquired B through G. Recovery retains the existing
freshness baseline, exact claim identity, and focused-observation target guards.

The DS-21 manifest remains `NotImplemented`: these seven tests establish its
position-release and serialized-order slice only. Issue #277 owns ordinary
finality and #279 owns uninterrupted composition; the settlement control here
is not evidence for either remaining acceptance boundary.
