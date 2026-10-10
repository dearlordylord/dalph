# Codex resolves content conflicts inside the exact integration candidate

The Operator authorizes integration of accepted C. Dalph gives Codex the exact
session/run and candidate worktree starting at fixed H; H and C descend from the
planned Base. This refines the private provider work already owned by
[the outer Integrator](introduce-outer-integrator.md) and
[#68 recovery/quarantine](recover-or-quarantine-integration-session.md).
Git remains the authority for commits, ordered parents, and refs.

## P1: preserve both accepted changes

One small content conflict admits a solution preserving both requirements.
Codex reads H/C, their changes from Base, repository guidance and accepted
scenarios/source authorities, attempts the merge, resolves inside that candidate,
and runs focused affected checks. It reports M only after checking exact ordered
direct parents [H,C] and unchanged target H. Dalph's ordinary Git qualification
and promotion remain separate.

Codex must not blindly select a whole side, edit accepted C or its leaf, rebase,
cherry-pick, create another leaf attempt/claim, update/push the target, or fabricate
success. No new outer provider turn is introduced by this repair.

## P2: preserve a concrete failure

If both requirements cannot be preserved, resolution is unsafe, scoped checks
fail, or authorities contradict, Codex returns concrete conclusive NotPrepared.
The existing quarantine retains C, claim, session, resource, and evidence;
only exact Operator direction permits Retry/FullRerun. Mere textual conflict
does not justify skipping resolution. No automatic outer retry is introduced.

## P3: retain existing crash and custody boundaries

A crash before/after private resolution or terminal result uses the same exact
session, resource, owned turn, and fresh writer census. Existing recovery
reconciles ambiguous outcomes and replays sealed results without another turn.
This prompt change adds no persistence, journal events, workflow/model laws,
cleanup decisions, or publication semantics. The existing #68 crash chronology
applies; new crash transitions are inapplicable.

## Scenario-to-test mapping

All paths below are repository-relative.

| Scenario | Exact executable controls |
| --- | --- |
| P1 prompt boundary | `packages/dalph/src/application/codex-integrator.test.ts`: `instructs the exact provider turn to resolve conflicts and fail concretely inside its candidate` captures the actual startTurn prompt and proves one turn; `creates one candidate and returns the exact prepared envelope`. |
| P1 physical Git / real provider | `packages/dalph/src/application/codex-integrator-conflict-real-qualification.test.ts`: `resolves one physical conflict preserving H and C without promoting the target`. Installed Codex app-server, local deterministic Responses endpoint, real shell and Git; observes CONFLICT, checks both enabled behaviors, exact [H,C], unchanged target and accepted refs. |
| P2 output / ordered parents | `packages/dalph/src/application/codex-integrator.test.ts`: `replays a sealed NotPrepared boundary (%s) without starting another turn`, `sanitizes malformed output only after the writer census is absent`, `seals a failed provider turn only as sanitized NotPrepared`; all `codex-integrator-envelope.test.ts` controls. |
| P2 integration consumers | `packages/orchestrator/src/workflow/protocols/integrator/protocol.test.ts`: `conclusive NotPrepared is retained for quarantine and is not automatically retried`, `wrong ordered parents do not qualify the explicitly reported M`; `packages/orchestrator/src/authorities/git/integrator-candidate.test.ts` Git qualification controls. |
| P3 recovery / custody | `codex-integrator.test.ts`: `recovers a lost turn response without allocating a second token`, `fails closed while an owned writer remains live`, `replays a sealed NotPrepared boundary (%s) without starting another turn`; `protocol.test.ts`: `process loss before the outer result reuses the same unfinished session`; all focused `integrator/reconstruction.test.ts` controls. |

## Retained repair evidence and limits

On 2026-10-10, against planned Base
`f999cbd82f0a563d2777f7cbd665c0de4c79a088`, the five mapped controlled files
passed 127 tests in 24.77 seconds. Log: `/tmp/conflict-focused.log`.
The opt-in physical/real-provider test first passed in 16.33 seconds.
After fixture-only receipt/cleanup edits and formatting, the same minimal control
passed on final source bytes in 10.10 seconds (2.57 test seconds);
log: `/tmp/conflict-real-final.log`. It was bounded to 120 seconds with absolute
stop 04:21:00 UTC. Exact app-server PID 161747, incarnation
`1b45e481-7d04-4c5a-98c6-7b6e9423263e|linux%3A34369247`,
had post-close process-group census `Absent`; retained receipt:
`/tmp/dalph-conflict-custody.json`. Three deterministic model calls drove one
native provider turn. This proves the native prompt/tool/Git boundary, not
autonomous model judgment on arbitrary conflicts.

The original #495 FullRerun is for the root after mounting this repair.
Combined coherent check:submit and resource acceptance remain with #501.
No check:all or full codex-real-host file is credited or requested here.


Tested/reviewed source Git blob identities (relative to the Base above):
provider `78062897e0a5bad23bca3dbd05d3dcedc2f4d756`;
controlled provider test `ee60ec330026191435e0a6f5b81e4ce53585df40`;
real-provider fixture `0b92b051f51c5f90d6f6203df90fd6aed97752eb`.
The provider's only post-controlled-run edit is a lint suppression retaining the
existing fail-closed undefined guard: `recordRunIntent` explicitly returns
undefined for invalid private phases/history. Initial check:fast typecheck passed
but lint failed on that guard; this failed run is uncredited.
Focused lint repair passed (`/tmp/conflict-lint-repair.log`).
Documentation links passed (`/tmp/conflict-docs.log`).

Two fresh read-only scoped reviewers, each using the task model at medium
reasoning, reviewed Base-to-dirty-candidate scope and reported no reasonable
blocking findings. Review 1's evidence freshness observation was closed by the
final minimal fixture rerun; review 2's receipt identity observation was closed
by updating this note to that exact receipt. Neither review claimed broad
qualification or edited the candidate.

Final Base-scoped `mise exec -- pnpm check:fast` passed, including fresh
 typecheck, changed-file lint, and 14 selected quality fixture controls in three
files (`/tmp/conflict-fast-final.log`); stop was 04:22:00 UTC.
Final documentation links passed (`/tmp/conflict-docs-final.log`).
