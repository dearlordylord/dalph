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
| P1 native live preparation | `packages/dalph/src/application/codex-integrator-conflict-real-qualification.test.ts`: `repairs one moved historical link after a clean merge with the live model` uses Codex 0.162.1, an isolated authenticated home, a minimal live model, real Git/shell and a fixture-local documentation validator. Records initial docs exit2 and final exit0; verifies the exact repaired text, ordered [H,C], unchanged refs and runtime/check/evidence blobs, and post-close writer absence. This is not the repository-wide Lychee fixture or arbitrary-link judgment qualification. |
| P2 conclusive result and no second turn | `codex-integrator.test.ts`: parameterized `replays a sealed NotPrepared boundary (%s) without starting another turn` covers ambiguous/absent targets, content changes, non-doc check failure and manifest/preservation refusal. Controlled results prove sealing/replay, not live model refusal judgment. Existing `codex-integrator-envelope.test.ts` and integrator `protocol.test.ts` cover malformed results, conclusive quarantine and ordered-parent rejection. |
| P3 unchanged recovery/custody | `codex-integrator.test.ts`: `recovers a lost turn response without allocating a second token`, `fails closed while an owned writer remains live`, and sealed NotPrepared replay; `packages/orchestrator/src/workflow/protocols/integrator/reconstruction.test.ts` and `protocol.test.ts` cover retained session recovery. |

The original historical file is absent from this task's H. This fixture does
not import #501, rewrite its accepted C, or qualify the parent #491 again.
Delivery and original-run explicit recovery remain with Dalph.
