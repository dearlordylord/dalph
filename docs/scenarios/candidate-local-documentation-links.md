# Codex repairs a relocated documentation link inside its integration candidate

The native Codex integration provider may repair a relative local Markdown
link after a clean merge in its exact candidate. It changes only the lexical
path or fragment destination identified by the required documentation check.
It never edits the accepted leaf, target ref, or tracker.

## Governing behavior

This refines private candidate preparation under
[the outer Integrator](introduce-outer-integrator.md#an-integration-ready-result-produces-a-usable-candidate)
and preserves [conclusive failure](introduce-outer-integrator.md#a-conclusive-unsuccessful-result-remains-visible-and-stops-automatically)
and [exact recovery/quarantine](recover-or-quarantine-integration-session.md).
The existing executable `wrong ordered parents do not qualify the explicitly reported M`
constrains candidate qualification. This prompt refinement introduces no workflow
operation, durable event, authority, or model action; Quint changes are inapplicable.

## P1: repair only the destination after the required check fails

The Operator has authorized integration of accepted C. Dalph owns one candidate
initially at H, with immutable planned Base and one exact native session/run.
H and C merge without conflict. The required documentation check reports a
broken relative local Markdown link after a historical document moved.

Codex reads the exact diagnostic and intended existing local target. When that
target is unambiguous, Codex changes only the link's lexical path/fragment in
candidate Markdown documentation. Labels, narrative, acceptance content,
runtime, tests, fixtures, raw evidence and manifest-bound bytes remain intact.
Codex runs focused `check:docs` and applicable already-required checks to exit0,
then creates the final merge with exact ordered direct parents [H,C]. It verifies
that target still H and accepted C is unchanged before reporting PreparedCandidate.
Dalph separately qualifies and promotes; Codex never pushes or publishes.

## P2: retain a conclusive boundary failure

If the target is absent or ambiguous, prose/acceptance/evidence content must
change, a non-documentation check fails, or preservation is uncertain, Codex
returns conclusive NotPrepared naming the exact boundary. A manifest-bound
document is immutable; only its owner may produce an explicitly accepted new
evidence artifact. No arbitrary repair, bypass, broad rerun, dropped evidence,
or weakened assertion is permitted. The Operator sees the retained failure;
ordinary activation cannot automatically retry it.

## P3: retain stopped or uncertain preparation

If Codex stops before successful checks/result, the exact candidate and native
custody remain retained. Existing recovery reconciles uncertain outcomes and
proves stopped writers before effects. Retry/FullRerun still requires explicit
fresh authorization under H/C/session/Q/run/resource rules. Missing or failed
checks and process exit never establish Prepared. Crashes before/after private
repair use the existing session and custody chronology; no new crash transition
or journal format is introduced.

## Scenario-to-test mapping

| Scenario | Executable boundary |
| --- | --- |
| P1 permission; P2 refusal instructions | `packages/dalph/src/application/codex-integrator.test.ts`: `instructs the exact provider turn to resolve conflicts and fail concretely inside its candidate` captures the actual single startTurn prompt, including lexical limits and refusal boundaries. |
| P1 native live preparation | `packages/dalph/src/application/codex-integrator-conflict-real-qualification.test.ts`: `repairs one moved historical link after a clean merge with the live model` uses Codex 0.162.1, an isolated authenticated home, a minimal live model, real Git/shell and a fixture-local documentation validator. Records initial docs exit2, final exit0 and successful required runtime checks before Prepared; verifies the exact repaired text, ordered [H,C], unchanged refs and runtime/check/evidence blobs, and post-close writer absence. This is not the repository-wide Lychee fixture or arbitrary-link judgment qualification. |
| P2 conclusive result and no second turn | `codex-integrator.test.ts`: parameterized `replays a sealed NotPrepared boundary (%s) without starting another turn` covers ambiguous/absent targets, content changes, non-doc check failure and manifest/preservation refusal. Controlled results prove sealing/replay, not live model refusal judgment. Existing `codex-integrator-envelope.test.ts` and integrator `protocol.test.ts` cover malformed results, conclusive quarantine and ordered-parent rejection. |
| P3 unchanged recovery/custody | `codex-integrator.test.ts`: `recovers a lost turn response without allocating a second token`, `fails closed while an owned writer remains live`, and sealed NotPrepared replay; `packages/orchestrator/src/workflow/protocols/integrator/reconstruction.test.ts` and `protocol.test.ts` cover retained session recovery. |

The original historical file is absent from this task's H. This fixture does
not import #501, rewrite its accepted C, or qualify the parent #491 again.
Delivery and original-run explicit recovery remain with Dalph.

## Focused qualification evidence and limits

On 2026-10-10, planned Base was
`1e2f91afe41304debc9beb94c694d8452f82d6d6`; implementation candidate was
`ea9985cfb061e699aa2d0b7e98ee2de3dd9255a2`. Tested source blobs:
provider `e4d903d4827c17517be49149034a57a521522233`,
controlled provider tests `4523f9a5343253ff401fb5a47c8613919a1c53e3`,
native fixture `5c32af376a8228ded51f57b8ed60ce6b12a5a3cf` (after review repair).
The fixture observation repair below followed that implementation commit;
subsequent documentation-only evidence and mapping updates do not change the
listed tested source bytes.

- Focused owner/consumer command: `mise exec -- pnpm exec vitest run`
  with the five files mapped above (provider, envelope, protocol, reconstruction,
  Git candidate): exit0, 136 tests, 5.06 seconds;
  `/tmp/link-repair-focused-final.log`.
- Native command: `DALPH_RUN_REAL_CODEX_QUALIFICATION=1`
  `DALPH_LINK_REPAIR_CODEX_BIN=/workspace/typescript/dalph-worktrees/issue-491-runtime/node_modules/.bin/codex`
  `DALPH_CONFLICT_CUSTODY_EVIDENCE=/tmp/link-repair-reviewed-live-custody.json`
  `mise exec -- pnpm exec vitest run packages/dalph/src/application/codex-integrator-conflict-real-qualification.test.ts`:
  exit0, both tests passed in 40.58 seconds; `/tmp/link-repair-reviewed-live.log`.
  Final live case used Codex 0.162.1 and model `gpt-6.1-sol` at low reasoning.
  The local deterministic endpoint handled only the unchanged conflict control;
  live repair made zero calls to that endpoint.
- Live fixture H `071959bba57d7249c30aeb7dc3b813a158391e4e`,
  C `49e72859d2b89430fde05290bc5458083379df81`,
  M `06dd43af011be5434658f3685d2eef8e007ca2ea`.
  Git's clean merge-tree result had no conflicts. M differed from that complete
  tree only in `docs/evidence/moved/historical.md`, whose exact expected text
  preserved the label/narrative and changed `../target.md#existing-target` to
  `../../target.md#existing-target`. Required docs exits were [2,0].
  Both ordered parents and unchanged refs, runtime/check/raw evidence/manifest
  and hashed Markdown blobs were asserted. Required runtime validation recorded [0] before Prepared was received,
  before the test independently reran it.
- Native custody receipt: `/tmp/link-repair-reviewed-live-custody.json`,
  PID 1333564, incarnation
  `c8ebe5c2-16ad-4f1a-beed-17212600597a|linux%3A36135211`,
  post-close census `Absent`, passed true. Stop time was 09:20:00 UTC;
  completion preceded it. Disposable successful resources were removed after
  custody proof; the receipt retains exact identities and observations.
- `DALPH_DIAGNOSTICS_BASE=1e2f91afe41304debc9beb94c694d8452f82d6d6 mise exec -- pnpm check:fast`:
  exit0, fresh typecheck, changed-file lint and 14 Base-selected quality controls;
  `/tmp/link-repair-reviewed-fast.log`. Stop was 09:15:30 UTC; completion preceded it.

An initial native fixture attempt failed at Vitest registration before any
provider process launched (exit1, `/tmp/link-repair-live.log` was subsequently
reused for the corrected successful first live run). Correcting the unsupported
registration chaining produced the focused live pass; no failed qualification
was reused. The final strengthened whole-tree/hashed-document fixture above is
separate passing evidence. No `check:all`, parent combined qualification, target
publication, original historical evidence edit, or full provider suite was run.
The live case proves this small unambiguous relocation; controlled refusals
prove instructions and conclusive protocol handling rather than arbitrary live
model refusal judgment. Workflow and recovery tests retain their existing scope.

The first fresh medium-reasoning reviewer found one blocker: the fixture's
independent runtime check after Prepared did not prove Codex had run it before
returning Prepared. The fixture now records successful runtime checks outside
the candidate only after its assertions pass and reads/asserts that observation
before the test's own rerun. The same native fixture passed on those final bytes
with docs [2,0], runtime [0], and stopped Absent as recorded above. The old
conflict scenario's mapped sealed-refusal name was updated to the parameterized
control without changing its accepted outcomes.

Repository `mise exec -- pnpm check:docs` passed exit0 on the scenario/evidence
and mapping edits (`/tmp/link-repair-docs-reviewed.log`); this is the pinned
Lychee repository scan, separate from the live fixture-local validator.

## Applicable required checks and optional diagnostics (#511)

The provider selects required checks from the accepted task/scenarios and the
repository documented route. An invoked optional diagnostic does not acquire
mandatory status. For a mixed application-test/evidence candidate, the hosted
docs-only whitespace route is inapplicable. A required whitespace gate, required
runtime/docs failure, or uncertain byte preservation still blocks Prepared.

P1 starts with exact H/C/Base and manifest-bound raw evidence containing trailing
whitespace. After a clean merge and the bounded lexical repair above, the
provider runs required docs/runtime checks before Prepared. The extra staged
whitespace diagnostic fails; its actual exit and output are retained without
editing evidence. The live fixture maps P1 to the existing live link-repair case:
whole-tree comparison except the lexical path, raw SHA256, ordered parents,
unchanged H/C and exact stopped-writer census remain asserted.

P2 maps to the actual prompt contract and sealed NotPrepared replay cases for
required whitespace/runtime failures and uncertain preservation. Controlled
results prove instructions and replay, not arbitrary live refusal judgment.
The live case proves one small applicable route, not #501 capacity profiles.
No production check or arbitrary file exemption changes.

P3 permits existing explicit human Retry on the same S2/H/C/resource after
conclusive NotPrepared, without a numeric Retry cap, automatic retry or S3.
Existing custody/replay mappings above remain applicable. Uncertain writers and
outcomes must be reconciled before effects. This changes prompt/check-selection
instructions only: workflow operations, events, journal formats and control
algebra are unchanged, so no new model action or crash fixture is applicable.
The parent owns preview mounting, original #501 Retry and later native
publication; the leaf does not publish or edit the original task/target.
