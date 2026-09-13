# Alice receives an exact, safe qualification artifact

## Status and governing behavior

This document specifies the accepted [#340](https://github.com/dearlordylord/dalph/issues/340)
qualification slice before implementation. Writing it changes no Dalph runtime
behavior and does not claim that its acceptance tests already pass.

When the built controller finishes one invocation, it preserves
[#261's evidence/provenance and fixture-ownership contract](https://github.com/dearlordylord/dalph/issues/261)
and consumes #339 as its immediate caller. It preserves the controller's
[exact fixture authorization and setup-failure behavior](issue-339-fixture-authorization-and-setup-failure.md),
[public failure channels](issue-339-public-runner-failure-channels.md), and
[killed-child stdout framing](issue-339-killed-child-stdout-framing.md).
Exact cleanup and preservation remain constrained by
[Locality](../DELIVERY-INVARIANTS.md#locality),
[Ambiguity and evidence](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence), and
[Process and durability](../DELIVERY-INVARIANTS.md#process-and-durability).
This qualification layer adds no workflow transition, journal event, provider
retry rule, or formal-model transition; the existing production protocols remain
the only workflow interpreters.

#340 remains blocked by #339. #303 retains the convergence gate and its
downstream blocking edges. #304–#306 retain their named behavioral negative
controls; this artifact does not waive or replace them. #307 owns protected live
mutation qualification; actual execution still requires the operator's approval.
Every GitHub cleanup test below uses a
controlled adapter, not credentials or a live disposable repository.

## Scenario 1 — Alice receives evidence from one completed controller invocation

### Starting facts and trigger

Alice invokes the existing built hermetic controller for one named scenario Q.
The controller creates its exact local fixture and runs the built public CLI
with real Git and SQLite and controlled outer GitHub and Codex providers. The
fixture manifest and creation receipts name the actual resources created by Q.
No evidence document authorizes a workflow action or fixture deletion.

The qualification source SHA names the actual candidate commit being qualified;
its source Base SHA names the declared comparison base, not that candidate.
The built entry and lockfile have separately measured digests. Fixture H is the
initial commit in the disposable Git repository, not the qualification source
SHA. The controller retains the actual selected Run, task, attempt, integration
correlation, journal positions, and H/C/M/T facts when those facts exist. A
scenario that stopped earlier declares later facts inapplicable rather than
inventing them. Its actual workflow result and child-process result may differ,
as when application Exit leaves an unfinished recoverable Run.

### Ordered boundaries and visible result

1. The controller captures child stdout internally. The qualification seam
   validates each canonical version-one NDJSON record before adding it to
   controller records or publishing it as evidence or user-visible stdout.
   Validation includes the original input fields; decoding must not silently
   discard forbidden unknown fields and then call the result safe.
2. It constructs schema-versioned `ProductionMvpQualificationEvidence` with the
   scenario and hermetic tags, Q and start/end times, exact qualification source
   SHA/Base, binary and lockfile digests, OS/architecture/Node/pnpm versions, and
   safe fixture identities and configuration digest. It includes applicable
   actual workflow identities, ordered boundary/event tags, safe operation
   counts, and the digest of the canonical validated transcript. It never copies
   raw configuration, provider data, or private-store contents.
3. It validates provenance applicability. A local hermetic invocation reports
   hosted and dedicated/stressed profile provenance as not applicable when none
   was supplied; it cannot claim live qualification or fabricated hosted jobs.
   Any supplied hosted or profile evidence must bind to this same qualification
   source SHA and the supported Node 24.20 line. Applicable #153 evidence retains
   dedicated/stressed job identities, negative-control provenance, the current
   ordered 105-command inventory and 15/46/23/21 phase counts, measured
   setup/install margin within the unchanged 16-minute hosted limit, and later
   accepted additions. Historical Node 22 or older Node 24 data is comparison
   evidence only. Existing inventory/profile parsers are reused; they do not
   themselves prove source-SHA or hosted-job identity.
4. Before cleanup, the controller reads final controlled GitHub lifecycle and
   exact claim facts and the real Git target head. The evidence records what
   those authorities actually report, not success inferred from an earlier
   acknowledgement or child exit status.
5. It consumes the original exact local creation receipts and a schema-decoded
   disposable-GitHub manifest only for fixture cleanup. Fresh ownership checks
   precede deletion. It removes only proven exact resources and rereads their
   absence; it neither searches by Q prefix nor deletes a broad container.
6. It records the resulting cleanup disposition and publishes the validated
   artifact at its explicitly selected location outside Q's disposable fixture.
   Cleanup cannot remove the artifact it is reporting. A local
   `RemovedResources` result still retains its container and must report that
   locator truthfully; it is not proof that every local locator disappeared.

Alice receives exact source/build provenance and independent Run/process
results with either proven cleanup or exact retained safe locators. An empty
retained manifest is permitted only when absence is proven for every resource
it represents; the deliberately retained local container is never omitted.
No provider-private thread, turn, session, prompt, response, credential, raw
environment, stack trace, or arbitrary home path appears in the published data.

### Crash and retry

Death between final reads, cleanup, and artifact publication does not alter the
Run or authorize another provider request. There is no automatic qualification
rerun or resume protocol in this slice. If publication cannot finish, the
controller reports only facts and retained resources it can prove, without
claiming a successfully written artifact.

## Scenario 2 — controlled unsafe child data is rejected before publication

The controlled input seeds sentinel credentials and provider-private identities
in an otherwise plausible child record, including free `Failure.detail` or
subject text, and separately in an unknown field. Raw child stdout is internal
qualification input, not already approved public evidence.

When that record reaches the qualification seam, the controller rejects it
before controller-record, evidence, or user-visible stdout publication. It does
not sanitize the record after publication, echo rejected bytes in an error, or
change the ordinary production failure protocol. The rejection leaves the
actual child result and accepted SQLite Run history unchanged. Existing owned
child/transport teardown and exact cleanup still apply; the rejection grants no
extra cleanup permission and starts no replacement child or provider retry.
Alice sees a safe qualification failure and truthful retained resources, not
the sentinel or private identity. A valid record's original safe payload is
preserved rather than silently rewritten.

## Scenario 3 — exact cleanup succeeds or preserves an unproved resource

After the scenario's final tracker/Git reads, the controller has original local
creation receipts and a controlled disposable-GitHub manifest containing Q,
exact repository identity, issue number/node identity, and fixture-created
label node/name pairs with their proven fixture fingerprint.

For an unchanged owned resource, it rereads the exact identity, deletes that
exact resource once, and checks absence before reporting removal. A label
already proved absent requires no deletion. For a foreign invocation or
repository, changed node/fingerprint, replacement local object at the same
locator, or unreadable ownership/absence, it preserves the unproved resource.
Path equality, configuration equality, and Q-marker equality do not override a
changed local creation identity. `ChangedPrivateStore` therefore remains a
truthful retained outcome, not successful deletion by locator alone.

If one controlled GitHub cleanup mutation is throttled, the controller records
that one attempt and does not sleep, retry, substitute an identity, or rerun the
qualification. If deletion succeeded but its absence reread is unreadable, it
does not claim proven removal. Partial cleanup reports exactly the proven
removed resources and the unresolved retained resources, including the retained
local container. Alice receives `QualificationCleanupIncomplete` with safe
exact locators and manual commands that identify those resources; no broad-root
or prefix-deletion command is supplied.

Cleanup failure does not reinterpret workflow success, application Exit, or a
child failure. No executor restart applies here: qualification cleanup acts on
fixture ownership, not on executor sessions or workflow responsibilities.

## Scenario 4 — output or artifact writing fails

The controller has an actual child result and accepted Run facts, and its
validated evidence is ready for publication outside Q. The controlled output
writer or artifact writer then fails, including after cleanup has partly or
fully completed.

The controller reports a safe qualification publication failure when the
remaining output channel permits it. It preserves the independent Run and
process dispositions and the actual removed/retained inventory. It does not
claim that the artifact exists, convert an unfinished Run into normal
termination, launch another child, repeat a provider mutation, or rerun cleanup
because writing failed. If all output channels fail, absence of a report is not
evidence of success; publication is best-effort, not workflow authority.

## Required scenario-to-test mapping

These are planned focused acceptance seams, not passing-test receipts.

| Scenario | Minimum module/caller and acceptance proof |
| --- | --- |
| 1: exact safe artifact | `production-mvp-qualification-evidence.ts` and adjacent tests decode actual built-controller output; prove complete applicable identities, source SHA distinct from fixture H, exact digests, unchanged safe payload, canonical transcript digest, and artifact outside Q. Existing controller built-child tests consume the same helper. |
| 1: provenance | Evidence tests prove honest local N/A, supplied same-SHA hosted/profile binding, supported Node 24.20, current independent inventory and negative controls, and setup/install margin; reject stale/substituted evidence without fabricating missing data. |
| 2: prepublication rejection | Evidence tests and the existing controller caller seed sentinel/private values in free failure text and unknown fields; prove rejection before record/evidence/user-output publication, safe failure reporting, unchanged child/Run truth, and no rerun. |
| 3: exact GitHub cleanup | `disposable-github-qualification-cleanup.ts` and adjacent controlled tests prove fresh exact repository/issue/label ownership, one exact deletion, and absence reread; foreign, changed, unreadable, and throttled cases prove preservation and exact retained commands. No live provider is called. |
| 3: local cleanup | Reuse existing `disposeHermeticFixture` tests and its controller caller; prove changed same-locator identity retained, partial removal truthful, and `RemovedResources` still reports the retained container. |
| 4: publication failure | Evidence/controller writer-failure tests preserve independent Run/process dispositions and actual cleanup results, claim no artifact success, and prove no automatic child/provider/cleanup rerun. |

The minimum implementation is the two qualification-only modules and their
focused tests plus narrow existing-controller wiring. This is not a new
controller, package API, artifact framework, legacy migration, or MBT lane.
