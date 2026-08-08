# Build the exact two-parent integration candidate

Issue: [Build the exact two-parent integration candidate](https://github.com/dearlordylord/dalph/issues/57)

Status: accepted in the 2026-08-01 scenario interview. Numeric retry limits and
the lower-level candidate-submission adapter remain explicitly deferred.

These scenarios begin after issue #56 has durably started one integration
responsibility and after issue #139 has supplied current Git facts. They stop
before issue #59 verifies the candidate and issue #60 offers it to the target
ref.

At this specification level, the integration agent owns merge construction and
conflict resolution and explicitly submits one candidate M. A successful agent
exit, freeform response, or observed worktree tip is not a submission. The
transport that will carry the submission reliably is deliberately deferred;
CLI helpers, MCP tools, structured provider results, and private Git refs are
future adapter research rather than behavior selected by this scenario.

Every automatic retry, correction, or convergence loop in these scenarios is
bounded by a separately accepted positive limit and ends in an explicit
preserved wait, failure, or operator-repair disposition when exhausted. This
scenario does not choose the numeric limits. Exhaustion never silently starts
a replacement integration session. The long-lived coordinator may continue
observing new work indefinitely; that service lifetime is not repeated
attempts to complete one responsibility and is not subject to this bound.

## Dalph constructs a candidate on a compatible advanced target

### Starting situation

No person directly triggers this scenario. Dalph is coordinating Run R and has
already recorded an accepted executor result C for planned attempt P. P names
immutable Base commit B. The journal also contains the exact integration
responsibility for C, the configured repository/ref target, and the durable
integration-start occurrence. The live coordinator holds the process-local
serialized resource for that exact target.

Git reports current target head H. B is an ancestor of both H and C, so the
target may have advanced compatibly since P was planned. C has not been
promoted. No integration candidate has yet been recorded for this
responsibility.

### Trigger and chronological behavior

1. The ordinary integration frontier selects candidate construction for the
   started responsibility.
2. Dalph fixes one integration-session identity and one candidate identity,
   each bound to R, P, C, the exact repository/ref target, and expected target
   head H.
3. Dalph records its intent to start or continue the exact integration-agent
   responsibility before asking the execution substrate to work in the
   isolated integration resource.
4. The integration agent works in that resource, owns the merge and any
   conflict resolution, and explicitly submits candidate commit M for the same
   session and candidate identities. It does not update the configured target
   ref.
5. Dalph reads Git after that explicit submission. Git reports that M exists
   and has the ordered direct parents `[H, C]`.
6. Dalph records the observation. The resulting responsibility is ready only
   for issue #59 candidate verification; this scenario does not claim that M
   is verified or promoted.

If Dalph crashes after step 3 and before step 6, restart reconstructs the same
session and candidate identities. It reconnects to the exact integration-agent
session and inspects its existing isolated work before starting or continuing
work. An explicitly submitted matching M is recorded and reused; absence of a
submission may permit the same session to continue under the accepted bounded
protocol. Unreadable, conflicting, or contradictory facts do not permit a new
identity or a blind retry.

The first valid explicit submission fixes M for the session and candidate.
Repeating the same M is harmless. If the agent exits without a valid
submission, candidate construction is incomplete. If the agent or a person
creates later commits in the isolated resource, Dalph preserves them and warns
when it can observe the movement, but it does not silently replace M. A later
submission naming a different commit is a contradiction, not a revision of M.

An operator can inspect one candidate M associated with the started
responsibility. Dalph must not require B to equal H, reverse the parent order,
substitute a newer target head, mutate the target ref, create a second
integration session, infer M from process success or the newest worktree
commit, classify M as verified, or mark the tracker task complete.

### Acceptance evidence

- `builds one candidate with current target first and accepted result second`
- `requires explicit candidate submission instead of inferring worktree head`
- `keeps the first submitted candidate when later commits appear`
- `reopens an ambiguously constructed candidate before retrying it`
- `does not verify or promote the constructed candidate`
- Maintained cassette: `candidate conflict recovery stays in one isolated integration resource`, exercised by
  `runs maintained conflict, unreadable-Git, correction, exhaustion, and contradiction stories`
- Quint: `explicitExactCandidateFixesOrderedParentsTest` and
  `unreadableGitPreservesExplicitSubmissionAcrossRestartTest`, plus
  `candidateReadyRestartReconstructsNoTargetLeaseTest` for the process-local
  resource boundary

## Dalph rejects rewritten or unrelated target lineage before invocation

### Starting situation

The same Run, attempt, accepted result, integration responsibility, and target
resource exist. Git reports current target head H, but B is not an ancestor of
H. This is a target rewrite or unrelated lineage. No candidate-construction
intent has been recorded and no candidate boundary call has started.

### Trigger and chronological behavior

1. Fresh Git lineage facts reach the integration frontier.
2. Dalph derives the existing typed Git-lineage constraint for P.
3. Dalph records no candidate-construction intent and does not start an
   integration agent.
4. The integration responsibility remains preserved for the accepted
   reconciliation path.

There is no ambiguity-crossing effect, so crash and retry do not apply. After
restart, the persisted responsibility and fresh Git authority must again
permit construction before any invocation.

The operator sees a lineage constraint rather than a fabricated candidate.
Dalph must not reset or overwrite H, merge unrelated histories, rewrite C,
release the responsibility as completed, or silently choose a different Base.

### Acceptance evidence

- `rejects rewritten target lineage before candidate construction and preserves its accepted responsibility`
- `derives a target-rewrite constraint before proposing candidate construction`
- `continues after Git proves the target advanced from the planned Base`
- `isolates the affected attempt after Git proves an incompatible target rewrite`
- `records compatible target advancement and isolates a proven target rewrite in maintained cassettes`
- Quint: `compatibleAdvanceContinuesTest` and
  `incompatibleRewriteSuspendsOnlyAffectedAttemptTest`

## Conflict resolution remains inside the exact candidate session

### Starting situation

Dalph has recorded construction intent for session S and candidate identity K,
bound to expected target H and accepted result C. The integration agent has
encountered conflicts while constructing the two-parent merge in the isolated
candidate resource. The configured target ref still points to H.

### Trigger and chronological behavior

1. The integration agent encounters the conflict in the exact isolated
   resource identified by S, K, H, and C.
2. Dalph records that observation without changing the target ref or replacing
   S or K.
3. The same integration agent continues its merge and conflict-resolution work
   only in that isolated resource and session.
4. After edits, the agent explicitly submits M for S and K; Dalph then reads M
   from Git.
5. The submission is accepted only when Git reports the exact ordered direct
   parents `[H, C]`. A foreign session or resource, different parent, different
   target head, or different result remains a typed contradiction.

If Dalph crashes while conflict edits exist, restart preserves the isolated
resource and reads it before any request. It never creates a replacement
candidate merely because the prior response or editing process was lost.

The operator sees the conflict remain attached to one candidate session.
Dalph must not apply edits to the planned task worktree, start a second
candidate from a newer head, discard conflict work automatically, or treat a
clean working tree as proof of the required commit parents.

### Acceptance evidence

- `keeps conflict edits bound to the same candidate and integration session`
- `continues the fixed session after a later target rewrite observation`
- `preserves conflicting candidate work across restart`
- `returns an invalid parent structure and accepts the first exact corrected submission in the same session`
- `fails closed before Git and preserves involved sessions without automatic resubmission`
- Maintained cassette: `candidate conflict recovery stays in one isolated integration resource`, exercised by
  `runs maintained conflict, unreadable-Git, correction, exhaustion, and contradiction stories`
- Quint: `correctionReusesSessionAndAcceptsFirstCorrectedSubmissionTest`;
  sampled and exhaustive checks also include `sessionIdentityFixedAfterStart`

## The integration agent corrects an invalid candidate submission

### Starting situation

No person directly triggers this scenario. Integration-agent session S is
constructing candidate K from expected target head H and accepted result C in
its exact isolated resource. No valid candidate M has been accepted for K.

The agent explicitly submits object name X. Git gives a readable, definitive
answer that X does not exist, is not a commit, or is a commit whose ordered
direct parents are not exactly `[H, C]`. For example, X may name a tree, have
one parent, reversed parents, a third parent, a newer target head, or a
structurally valid merge as its own single parent after later manual work.

### Trigger and chronological behavior

1. The explicit submission of X triggers candidate validation.
2. Dalph asks Git whether X exists, is a commit, and has the required ordered
   direct parents. Git returns its concrete negative fact.
3. Dalph rejects X with that concrete reason. It does not fix candidate M,
   replace S or K, or start another integration agent.
4. Dalph returns the mismatch to the same integration-agent session. The agent
   continues in the same isolated resource, corrects the candidate, and
   explicitly submits another commit.
5. Only the first submission whose Git facts prove exact ordered direct parents
   `[H, C]` fixes M.

If Dalph crashes after observing the invalid submission but before the agent
corrects it, restart reconnects to S and preserves the existing isolated work.
It does not infer a candidate from the worktree tip or allocate another
session. If the same integration agent reaches the accepted positive correction
limit without producing a valid M, Dalph records this integration
responsibility as non-convergent, preserves the session and all Git work, and
leaves the task incomplete for operator action. It releases the serialized
integration-target position so unrelated accepted results are not blocked by
this exhausted responsibility. This scenario does not choose the numeric
limit.

The operator can see that X was rejected and that the same integration session
is correcting it. Dalph must not promote a missing or non-commit object,
silently reinterpret a wrong parent, discard the isolated work, treat the
invalid submission as a valid M, or restart candidate construction with a
newer target head.

### Acceptance evidence

- `returns an invalid parent structure and accepts the first exact corrected submission in the same session`
- `returns a missing or non-commit submission to the same integration agent`
- `reconciles a limit-reaching Git observation after a crash before another agent call`
- `preserves non-convergent work and leaves the task incomplete after correction exhaustion`
- `releases the integration target after non-convergence so unrelated work may continue`
- `releases the integration target after automatic continuation exhaustion so unrelated work may continue`
- `stops automatic agent continuation at the durable configured limit`
- Maintained cassettes: `candidate correction exhaustion preserves non-convergent work` and
  `candidate correction rereads unreadable Git without charging the agent`, exercised by
  `runs maintained conflict, unreadable-Git, correction, exhaustion, and contradiction stories`
- Quint: `correctionReusesSessionAndAcceptsFirstCorrectedSubmissionTest`,
  `correctionExhaustionPreservesWorkAndReleasesTargetTest`, and
  `automaticContinuationExhaustionPreservesWorkAndReleasesTargetTest`

## A submission contradicts its bound integration identity

### Starting situation

Integration-agent session S is intrinsically bound to candidate K and its
isolated resource. The future submission adapter receives a purported result
whose correlation contradicts that binding. This can arise from a stale or
misrouted provider response, an incorrectly scoped manual invocation, or an
adapter defect; it is not evidence that the agent constructed the wrong merge.

### Trigger and chronological behavior

1. The correlation contradiction is detected before Dalph reads or changes
   Git for the purported candidate.
2. Dalph rejects the submission and stops the affected integration operation.
3. Dalph preserves S, K, every possibly involved session, and their isolated
   work for operator diagnosis.
4. Dalph does not return this condition as merge-correction work and does not
   automatically retry the submission.

Because the deterministic contradiction stops the operation, no retry loop
applies. A separately accepted operator-repair protocol is required before the
work may continue.

The operator sees an infrastructure correlation contradiction rather than an
agent merge failure. Dalph must not touch either candidate, guess the intended
session, route the submission by worktree tip, or repeatedly ask an agent to
resubmit.

### Acceptance evidence

- `fails closed before Git and preserves involved sessions without automatic resubmission`
- `rejects every mismatched candidate report expectation during reconstruction`
- Maintained cassette: `candidate correlation contradiction fails closed before Git`, exercised by
  `runs maintained conflict, unreadable-Git, correction, exhaustion, and contradiction stories`
- Quint: `foreignCorrelationStopsBeforeGitAndKeepsSessionTest` and
  `correlationContradictionRestartReconstructsNoTargetLeaseTest`

## Git cannot validate an explicitly submitted candidate

### Starting situation

Construction intent for exact session S and candidate K is durable. The
integration agent has explicitly submitted X for K. No candidate M has yet been
fixed because Dalph has not validated X. The subsequent Git read times out,
fails, or returns an unreadable response, so Git has proved neither that X is
valid nor that X is invalid.

### Trigger and chronological behavior

1. The failed or unreadable Git validation response triggers this scenario.
2. Dalph records the typed boundary outcome when it can be represented as
   trustworthy evidence; a storage-level inability to record it remains a
   typed journal failure.
3. Dalph preserves X as the one pending submission for S and K. It does not
   reject X, ask the agent to resubmit it, or count this boundary failure as an
   integration-agent correction or convergence round.
4. A later activation rereads the same X from Git according to the accepted
   boundary retry policy. A readable valid result fixes M; a readable invalid
   result enters the same-session correction scenario above.
5. Dalph selects no verification, promotion, tracker-completion, cleanup, or
   replacement-candidate operation.

If Dalph crashes at any point, the durable intent and pending submission still
own S, K, and X. Restart rereads X from Git before it asks the agent to do more
work. It does not infer absence or invalidity from the crash or unreadable
response.

The operator sees candidate validation waiting on Git rather than an agent
failure. Dalph must not mutate the target ref, blame or restart the agent, lose
the accepted result, allocate another identity, or collapse unreadable,
invalid, and absent into one result.

### Acceptance evidence

- `keeps and rereads the same submitted candidate without charging an agent correction round when Git is unreadable`
- `resolves a later readable invalid Git result through same-session correction`
- `round-trips pending Git failure and correction-limit candidate evidence`
- Maintained cassette: `candidate correction rereads unreadable Git without charging the agent`, exercised by
  `runs maintained conflict, unreadable-Git, correction, exhaustion, and contradiction stories`
- Quint: `unreadableGitPreservesExplicitSubmissionAcrossRestartTest` and
  `correctionReusesSessionAndAcceptsFirstCorrectedSubmissionTest`

## Handoff boundary

The evidence above names the collected acceptance tests, maintained authored
cassettes, and collected Quint runs. The executable protocol tests inject the
integration-agent and Git boundaries directly; the maintained cassette tests
drive those same operations through the composed workflow. Exact external
correlation is represented by the TypeScript schemas and cassette projection,
while the Quint model deliberately uses small integer identities and checks the
same-session consequence rather than pretending to model provider payloads.
The model-based acceptance test
`replays accepted-result integration through production journal and candidate protocols`
also drives every executable Quint step through production admission, journal,
candidate-boundary, Git-observation, restart, and target-resource operations,
then compares the resulting state after every step.

The concrete CLI transport that carries an agent submission remains deferred.
Nothing in this handoff infers a candidate from freeform output or claims that
the integration agent adapter can yet survive independently of Dalph's process.
