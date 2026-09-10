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

### A newly acquired claim permits the next integration lineage check

Alice watches B finish in that Run. The tracker previously returned a successful
claim acquisition for B's exact owner, token, and operation, and Dalph durably
recorded `TaskClaimAcquired`, then read and recorded a complete G5 graph for the
Run's tracker target, and then fixed B's planned attempt. There is no later
coordinator recovery boundary and no redundant focused claim-read result.

B's executor publishes its accepted result. Dalph accepts that report and starts
B's separate integration responsibility. The successful claim acquisition is the
claim-check point before the complete graph observation: Dalph can now call Git
to read lineage for B's exact planned attempt and integration target. After that
read is durable, Dalph calls the Integrator for B. Alice sees integration progress
instead of a responsibility waiting forever for a claim read that is not owed.

A later acquired claim for C, or a different B owner, token, or operation, must
not stand in for B's authorized acquisition. A focused claim observation from
another tracker target must not authorize B's lineage check either. The focused
negative tests place those unrelated records after a recovery freshness boundary;
the old valid acquisition must stay stale, with no fresh claim-check point.
If the coordinator actually dies, its recovered freshness boundary still requires
new claim evidence; this change must not reuse the old acquisition or retry work.
The terminal-journal cuts below separately prove recovery without another Begin
or Resume. No live-provider retry occurs in these controlled tests.

The same fresh-claim rule applies when Alice replays the maintained two-task
pipeline, five-task diamond, or staggered double diamond in Reducer Lab. After
their first accepted result, Dalph now calls Git for lineage in that activation;
the authored boundary sequence must accept that call rather than demand an
unearned activation return and redundant claim reads. The runner publishes only
the real story, journal, runtime-owner, and delivery observations it captures.
Those existing examples must still execute their declared behavior, not fail
with an interaction mismatch or fabricate missing observation moments. This is
maintenance of their existing examples, not #279's seven-task composition.
In the five-task example, E already has its claim and plan when B takes the
integration target. The cassette holds E's worktree call until B's promotion,
then holds B's completion-claim read until E begins; E must therefore begin
before B settles. The double-diamond example retains its corresponding B-to-X
hold across restart. After C settles, X now receives its lineage check and
integration turn before the next graph read admits D. Neither example may
invent an activation return to postpone that available integration work.

### Task-work positions release independently of the integration target

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
| Exact fresh acquisition precedes complete graph, Git lineage, and B's Integrator call without a redundant claim read | `starts B integration after its exact acquired claim graph and lineage observations` |
| Unrelated or foreign claims cannot replace fresh exact evidence | `does not use unrelated acquired claims as fresh integration claim observations` and `keeps focused integration claim observations within the exact task target and freshness boundary` in `recovery-activation.test.ts` |
| Maintained authored examples accept the immediate lineage call and publish real moments | `preserves maintained authored moments after fresh-claim integration progress` in `issue-276-maintained-observations.test.ts`; Reducer Lab maintained-cassette smoke |
| Crash before executor-state observation | `recovers B at BeforeObservation without another executor command` |
| Crash after observation, before acceptance | `recovers B at AfterObservation without another executor command` |
| Crash after acceptance, before responsibility | `recovers B at AfterAcceptance without another executor command` |
| Unavailable evidence retains B's exact position | `retains every occupied position when B terminal evidence is Unavailable` |
| Foreign evidence retains B's exact position | `retains every occupied position when B terminal evidence is Foreign` |

Forbidden release and duplication preserve delivery invariants D12, D14,
and the executor/integration laws linked above. There is no live-provider retry:
all interruptions and responses are deterministic local boundary controls.

The DS-21 manifest remains `NotImplemented`: these tests establish its
position-release and serialized-order slice only. Issue #277 owns ordinary
finality and #279 owns uninterrupted composition; the settlement control here
is not evidence for either remaining acceptance boundary.
