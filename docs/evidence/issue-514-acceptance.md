# Issue #514 qualification

The Run owner now seals an exact interrupted Integrator turn as NotPrepared only
after the original provider's stopped custody, complete owned native history and
fresh full Absent census are proved. Source qualification is complete; native
publication, typed production cleanup and task closure remain owned by Dalph.
This packet does not claim retained #513/#512/#511 have been delivered.

Source candidate: `e4f76d9ddae2feb31726db596ddb38c006ad05f5`, planned Base
`a57cd6ec018ec109978aec386e52b6c7dd91d8df`. Qualified #513 source
`4a4fd74b9aec372afa4dd1b16ea236ae39d492db` was composed by ordinary merge
`f660fcc221cce6090098a2c606c1b0fbab2da082` before implementation. The
[source hashes](issue-514/source-hashes.json) cover the combined Base-to-candidate
scope, including inherited accepted repairs. The subsequent evidence commit
changes no application source.

## Acceptance observations

The [accepted chronology](../scenarios/interrupted-integrator-negative-recovery.md)
names each test; the receipts below refer to full passing files, not aggregate
counts as a substitute for scenarios.

| Requirement | Direct passing observation and receipt |
| --- | --- |
| R1 interrupted/stopped/Absent/no hint | Owner `R1/R4 seals exact interrupted recovery as NotPrepared and replays response loss without another turn` in [final owner/cleanup run](issue-514/provenance-final.log.gz). Native [external receipt binding](issue-514/native-external-receipts.json) retains the reviewed raw receipt establishing the same X/T/K and ordinal across TurnObserved to InterruptedTurnSealed/NotPrepared. Existing NotPrepared/quarantine consumers pass in [focused consumers](issue-514/focused-final.log.gz). |
| R2 completed/no hint pending | Owner `keeps a completed Integrator turn pending after reopen when its matching notification was not replayed`, in final owner run. No private seal or replacement turn is admitted. |
| R3 prohibited negatives | Owner named `R3 refuses interrupted recovery with $name and retains TurnObserved`, duplicate turn/unavailable RPC and inProgress cases, in final owner run: foreign/missing/tokenless identities, wrong tokens/correlation, live/unknown old custody and incomplete/nonAbsent census cannot seal. |
| R4 cuts/response loss | Owner `R4 reconciles %s interrupted seal cut before replaying one negative result` covers BeforeWrite/AfterWrite; R1/R4 covers response loss. Native separate-process reopen and replay record zero additional turns. |
| R5 late hint/contradiction | Owner `R5 ignores a late exact hint after interrupted seal without publishing a second result` and `R5 rejects contradictory %s history after interrupted seal without mutation`, in final owner run. |
| R6 fresh authority/compatibility/cleanup | Owner `R6 admits one explicit Retry after interrupted NotPrepared on the same owned candidate` and `R6 retains each interrupted run owner across Retry, interrupted run2 and old-seal replay`; cleanup `R6 typed cleanup proves both original interrupted owners after Retry changes record ownership`, in final owner/cleanup run. Private decoder `R6 decodes interrupted negative seals and legacy completed/failed records through restart and typed cleanup` passes in [owner/private/current public-provider run](issue-514/owner-final.log.gz). Existing protocol `conclusive NotPrepared is retained for quarantine and is not automatically retried`, `rejects non-Retry, conflicting, stale-lineage, and wrong-quarantine evidence before run two`, and `rejects a FullRerun successor that reuses predecessor identities` pass in focused consumers. |

Each interrupted seal stores its original provider incarnation. A newly authorized
run records the current provider owner rather than permanently inheriting run1's
incarnation. Retry verifies prior seals with fresh full history and Absent census;
old-seal replay and typed cleanup retain exact original custody proofs. Completed
without an exact completion notification remains pending and failed remains its
existing distinct disposition.

## Actual native boundary

The minimum fixture uses the qualified Codex 0.162.1 executable at
`/workspace/typescript/dalph-worktrees/issue-491-runtime/node_modules/.bin/codex`.
The [native test log](issue-514/native-final.log.gz),
[external first-controller and reopen receipt bindings](issue-514/native-external-receipts.json) and
[stopped-process census](issue-514/native-stopped.json) establish one actual native
turn, exact interruption, old provider shutdown and a separate controller's
ordinary reopen. Reopen records zero hints, zero turn starts and zero provider
model requests. Both fresh owned censuses are Absent; both provider process groups
are Absent after disposal. Native status remains interrupted. The fixture uses an
isolated test repository and local model endpoint, not retained production runs.

The [raw receipt](issue-514/native-raw-receipt.json) retains pre-seal hash and size;
its canonical private-store projection matches the hash captured before sealing.
External #513 diagnostic summaries are hashed and sized in the source packet but
are not custody/history acceptance evidence. Original production private JSONL,
candidates and journals were neither rewritten nor used as substitute proofs.
The commit scanner reported ownership-token fields in the two native raw
receipts. Those originals remain external, unchanged, with paths/hashes/sizes
retained; no scanner exception, token rewriting or compressed substitute was used.

## Qualification and review

All Node/pnpm commands used `mise exec --`; frozen dependencies were already
prepared by Dalph. Focused owner, private decoder, typed cleanup, public provider
and unchanged workflow consumers passed. Artifacts, Base-scoped fast and docs
checks passed. The first ordinary `pnpm check:submit` was interrupted without a final exit;
its [observed log](issue-514/submit-interrupted-observed.log.gz) and
[diagnostic](issue-514/submit-interrupted-diagnostic.json) remain uncredited for
the final cassette stage. Parent proved all 12 old launches stopped before
continuation-3. The [focused normal-termination cassette](issue-514/cassette-interruption-focused.log.gz)
then passed with actual exit 0. Continuation-3 submission was deliberately
stopped after parent identified a native command allowance mismatch: the wrapper
had the default ten-minute limit despite its longer internal deadline. Its
[actual interrupted receipt](issue-514/submit-continuation3-exit.json) and
[exact stopped group proof](issue-514/submit-continuation3-stopped.json) remain
uncredited for cassette completion. The experiment changed to one exact simple
direct command under the existing immutable fifteen-minute native allowance.
The first native stopped ledger confirms LimitReached/Elapsed at exactly
600,000 ms for the wrapper. No tool policy was replaced and no budget bypass
was used. Parent proved all 18 previous launch records stopped before
direct-submit-4. The final ordinary submission ran against the same frozen
candidate with an under-fifteen-minute expectation, absolute stage stop
14:07:30 UTC and host stop 14:13 UTC recorded in its manifest. Its exact stage exits and captured log are retained in
[submission receipt](issue-514/submit-exit.json) and
[submission log](issue-514/submit-full.log.gz). One formal/fast tool-return
chunk hit the prescribed 10,000-token cap and retains its explicit truncation
marker (27,284 original tokens); no missing console text is reconstructed or
credited. Sequential stage launches and the actual final exit establish stage
completion independently. Later cassette output was polled frequently and retained.

Fresh medium-reasoning Standards and Spec reviewers found no reasonable blocking
findings against Base-to-candidate; see [review receipt](issue-514/reviews.json).
The submission check runs artifacts, formal controls, fast, lint census and
memory cassettes. No full local gate, coverage rerun or unchanged capacity proof
was run. The new provider disposition reuses existing NotPrepared/quarantine
algebra; no generic workflow, journal/control schema or Quint model changes.
Inherited accepted formal behavior is preserved; submission formal controls pass.

Earlier failed fixture stages are retained alongside focused repairs: initial
owner assertions assumed no recovery read; controlled fixtures needed fresh
resume snapshots; typecheck/lint found fixture diagnostics; a same-controller
reopen correctly retained its live controller lease. The discriminating native
experiment changed to two controller processes rather than bypassing custody.
Passing repairs precede later qualification. Raw artifacts were never rewritten.

[Artifact manifest](issue-514/artifact-hashes.json) binds the retained packet.
There are no untested source acceptance criteria. Production delivery and the
parent's later stopped-writer recovery/FullRerun of retained tasks are subsequent
native actions, outside this leaf's source qualification.
