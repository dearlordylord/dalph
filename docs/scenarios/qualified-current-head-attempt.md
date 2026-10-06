# Dalph fixes a new attempt to the qualified integration head

Status: accepted by the maintainer on 2026-10-06. This replaces the fixed
configured starting commit for new ordinary production attempts. The configured
SHA becomes the lineage anchor. Existing acknowledged plans and explicit
Restart keep their separate contracts. The maintainer also chose to preserve
the invalid dogfood Run as forensic evidence and start a fresh Run; this does
not authorize journal repair or retrospective termination.

## Governing behavior

When Dalph admits a new ordinary task attempt, this scenario refines
[pipeline admission](refresh-complete-task-pipelines.md) and preserves
[Git reconciliation](reconcile-git-facts.md) and
[explicit Restart](clean-restart-changed-attempt.md). It supersedes the
configured fixed starting SHA for new production attempts only. The governing
[D1–D2 identity laws](../DELIVERY-INVARIANTS.md#identity),
[D21–D23 intent and evidence laws](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence),
and [D29–D32a recovery laws](../DELIVERY-INVARIANTS.md#process-and-durability)
continue to apply. The model owners are `freshTaskAdmission.qnt` (accepted
Base stages and retained capacity), `gitReconciliation.qnt` (`baseSelectionStep`)
and `runActivation.qnt` (pinned policy and historical recovery).

The person starts or reopens a Run; the coordinator selects each ordinary
attempt after the tracker authorizes it. Task-specific external mutations are
outside this read-only selection stage. S3 owns process-loss and lost-response
cuts; S4 owns unreadable and deadline outcomes. The maintainer approved S4's recorded explicit retry on 2026-10-06; ordinary
activation, timers and tracker notifications grant no retry authority.

## S1 — Dalph starts a dependant with already delivered prerequisite code

A new Run fixes its head-selection policy, exact integration repository/ref,
execution repository and configured lineage anchor A at its beginning. The
tracker supplies fresh task identity, eligibility, prerequisites, exact owned
claim and specification. After those observations, Dalph records the intent
for one bounded Git read with their causal predecessors. Git resolves head H
from the exact integration target, proves A is an ancestor of H, and proves H
is a commit available in the execution repository. Dalph records that witness
and acknowledges one complete immutable plan based on H. Worktree preparation
creates that plan's exact worktree/branch at H. Later ordinary admission,
execution, integration, publication and tracker completion remain required.
The dependant can read prerequisite code delivered before selection; Git alone
cannot satisfy a tracker dependency or authorize execution.

Acceptance owners: production configuration/planning tests, real Git authority
tests, fresh-workflow journal/composition tests, and a fresh four-task diamond
dogfood Run with independent evaluator checks, terminal history and settled
cleanup. These checks must prove the selected Base and initial worktree HEAD,
not merely successful ref resolution.

## S2 — Dalph retains one selection when the head advances

The S1 Git read selects H. An outside writer advances the integration ref to H2
before plan acknowledgement or preparation. Dalph retains the observed H and
its witness; it does not reread until stable or rewrite the complete plan.
Existing later tracker and Git checks determine whether the exact attempt may
cross its next boundary. Compatible advancement is permitted; incompatible
lineage refuses at its existing boundary. Acceptance owners: changed-head
controlled composition test and real worktree initial-HEAD assertion.

## S3 — Dalph reconciles a crash or lost acknowledgement before planning again

A crash can cut before the Git-read intent, after intent before observation,
after the qualified observation, or after plan persistence before its response.
Recovery first reads accepted history. A pending read is reconciled under its
exact recorded operation; a recorded witness is reused; an acknowledged plan
retains its Base, identity, revision, branch and worktree. Only a choice never
recorded may be observed afresh. A process-local ordinal cannot authorize a
replacement or deduplicate durable history. No worktree or provider Begin
precedes an acknowledged complete plan. Acceptance owners: journal crash-cut
and lost-acknowledgement tests, fresh workflow reconstruction, and immutable
plan property tests.

## S4 — Dalph refuses unavailable or incompatible Git facts

After fresh tracker authorization, the exact target/ref is missing, unreadable
or divergent from A, or H is unavailable as a commit in the execution
repository. Dalph records the precise failed read boundary and refuses before
plan acknowledgement, worktree creation or provider Begin. A distinct bare
target is read at that target; a healthy execution clone cannot substitute for
it. No automatic fetch, fallback Base, force update or mutation retry follows
this refusal. Acceptance owners: real separate-target and unavailable-object
negative tests plus journal intent-before-read assertions. An Operator may submit `RetryTaskAttemptBase` naming the Run, task, exact
refused read and stable request identity. Dalph records
`TaskAttemptBaseRetryRequested` before any further tracker or Git call. Exact
redelivery returns the original receipt, including after Run termination while
the recorded Run remains served. Closed-Run replay only reads that receipt; it
cannot append a request, wake the Run or call tracker/Git. A new request on a
closed Run remains refused; another request for the same refusal,
a pending read, a Qualified read, a foreign task/Run or an acknowledged plan
is refused. Prior observations remain immutable.

The recorded request permits one fresh complete graph read, one focused exact
claim read and one focused specification read, in that order. The graph must
still authorize the task, the tracker must confirm the same owned claim, and
the specification must remain the refused read's revision. Missing, foreign,
unreadable or changed authority blocks the retry before Git. These reads use
request-derived stable identities. Their accepted outcomes are reused after
crash. Only this complete causal chain permits one successor Base read. Its
Qualified result fixes the plan permanently; another Refused result needs a
new explicit request naming that successor. Timers, tracker notifications,
StartWork, Refresh, Unpause and process restart cannot mint retry requests.
A pending successor is reconciled under its existing identity.

Crash cuts: before request append there is no authority; after append or lost
acknowledgement redelivery reuses the receipt; after each tracker read intent
or outcome recovery reuses that read; after successor intent it reuses the
successor; after Qualified observation or plan acknowledgement it never
selects another head. No claim mutation is part of this protocol.

Concrete acceptance: `task-attempt-base-retry.test.ts` owns request refusal,
idempotency, exact tracker chronology and crash-prefix progression;
`production-running-host.test.ts` ("an operator retries one refused Base") owns
actual HTTP ingress, repaired Git ref, one claim/two reads/one plan/provider
Begin, exact receipt replay, cassette replay and completion.
`running-host-base-retry.test.ts` owns HTTP/CLI/MCP transport parity. `freshTaskAdmission*_test.qnt`,
`runActivation*_test.qnt`, `gitReconciliation*_test.qnt` and the activation/Git
MBT drivers own bounded retained capacity, explicit retry authority and
immutable Qualified selection. Existing journal Base tests retain the
lost-observation/plan-acknowledgement cuts.

## S5 — Dalph preserves tracker authority and explicit recovery

The specification, lifecycle, prerequisites or claim changes after selection.
H does not override those facts: existing fresh boundary checks refuse stale
authority before executor effects. A retained rejected, suspended or terminal
attempt does not become a new ordinary attempt because H moved. Continue
retains its exact plan; explicit Restart requires its own accepted direction,
fresh authority and stopped-writer proof and records its distinct successor.
Acceptance owners: fresh admission changed-authority tests, immutable planner
property tests, and existing public result-recovery composition tests.

## S6 — Dalph pins the policy at the new Run boundary

Configuration changes during a Run cannot change its policy, anchor or target.
An older Run without the current-head policy is not silently migrated. Its
acknowledged plans remain recoverable under their existing exact contracts;
new ordinary admission requires an explicit supported Run policy. Fresh
production entry records the selected policy before new task effects.
Acceptance owners: new-Run/reopen configuration tests, missing-policy refusal
and unchanged acknowledged-plan reconstruction tests. This change does not
repair malformed historical journals; the failed dogfood journal remains
immutable forensic evidence outside the fresh qualification Run.

The Run and plan journal records own workflow decisions and observations only.
Git owns ancestry, objects and refs; the tracker owns task facts; the execution
substrate owns stopped writers. The selected head is one observation, not an
atomic tracker/Git snapshot or exclusion of outside writers.


## Scenario-to-test mapping

| Scenario | Concrete acceptance checks | Remaining evidence |
| --- | --- | --- |
| S1 | `production-workflow-git.integration.test.ts`: “qualifies the exact separate target head and refuses unavailable execution commits”; `git-reconciliation.mbt.test.ts`: “replays pre-plan Base qualification through exact Git commands and accepted journal lineage” | Fresh four-task diamond, actual dependant executor Begin, terminal journal and settled cleanup. Native test proves exact prepared HEAD; it does not alone prove delivery. |
| S2 | Same native Git test advances the target after selection; `journaled-task-attempt-base.test.ts`: “records the Base intent before Git and reuses the selected head after acknowledgement loss” | Fresh diamond supplies the production composition. |
| S3 | Both journal Base tests cover pending intent, lost observation acknowledgement and lost plan acknowledgement; `production-configuration.test.ts` checks reconstruction from the same durable ordinal; immutable-plan `plan.property.test.ts` | No credit for unrun crash cuts outside these seams. |
| S4 | `task-attempt-base.property.test.ts` generates immutable heads and checks precise refusal boundaries and typed unsettled custody; the journal custody test forbids an observation/plan while stopped Git custody is unproven; separate-target native test rejects unavailable objects and divergent lineage | `task-attempt-base-retry.test.ts` covers request guards, immutable receipt, changed authority and reconstruction at all three tracker intent/outcome cuts; `git-reconciliation.mbt.test.ts` executes the full successor path; `running-host-base-retry.test.ts` covers HTTP/CLI/MCP and receipt correlation; `production-running-host.test.ts`: “an operator retries one refused Base” exercises real host ingress. Final coherent qualification remains required. |
| S5 | Existing fresh admission reconstruction and changed-authority acceptance tests; `active-work-authority-refresh.acceptance.test.ts` checks actual Continue; `delivery-proposal-routes.test.ts` checks Resume receipt transfer; historical immutable plans remain unchanged | Integrated broader fresh-authority suite and live composition still required. |
| S6 | Memory/SQLite `store.test.ts` policy-pinning test; `run-activation.mbt.test.ts`: “recovers an exact historical attempt while refusing fresh admission without a pinned Base policy” and “reopens the recorded qualified Base policy after configuration changes and a process crash” | Final coherent candidate qualification. |

`production-hermetic-qualification-source.test.ts` additionally proves selected
Base authorization through cassette fold, ordinary trace reader, source guard,
and reversible identity renaming. The cassette vocabulary test round-trips the
new read intent and observation. These checks prevent diagnostic adapters from
mistaking the configured anchor for a later selected Base.
