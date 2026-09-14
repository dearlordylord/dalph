# Local full qualification runs formal verification only for a relevant candidate

This scenario changes repository qualification tooling only. It does not change
a Dalph runtime command, workflow decision, provider request, journal fact,
retry, concurrency rule, cleanup action, or delivery-visible result.

## A maintainer qualifies a candidate with no formal-input change

A maintainer has frozen one candidate checkout at commit H and declared its
planned Base commit B with `pnpm check:all --candidate=B`. Git contains both
commits and B is an ancestor strictly earlier than H. No Quint checker or server
has started. An earlier interrupted full-gate run may have proved a contiguous
application-stage prefix for this same B and H.

After admission, the quality command asks Git for the exact paths changed from B
to H. It reads the checked-in formal-input projections at both commits so a
deleted input remains relevant, and compares the changed paths with their union.
The candidate changes no projected formal input. The resumable runner records
the exact B, H, changed paths, empty affected-path set, and an explicit
`not-applicable` formal disposition in its composite evidence. It then executes
or reuses the ordinary application stages. It starts zero Quint checkers and
zero formal servers, including when every application stage was reused.

The maintainer sees a formal-not-applicable report before application
qualification and can inspect the same disposition in the completed run. A
resume recomputes the same exact B-to-H classification; it does not reinterpret
an earlier formal success record as the reason to skip work.

The command must not enter the complete formal workflow, fabricate an executed
formal receipt, omit formal disposition evidence, compare against a moving
branch, or let an unavailable path/projection read count as unaffected.

## A maintainer qualifies a candidate with a formal-input change

The starting facts and trigger are the same, except at least one changed path is
a selected `.qnt` model, a formal command/helper/toolchain input, or an
executable model-conformance adapter or one of its TypeScript-resolved helper,
type, or governed implementation dependencies named by the checked-in
projection. The classification records that affected path. After preflight succeeds, the local
runner enters the existing complete formal workflow exactly once. That workflow
either executes the complete profile or reuses one independently applicable
complete success, retains its observer through application qualification, and
records its existing `executed` or `reused` disposition in the composite.

A resume recomputes the exact classification and still enters that workflow
once; it does not run one formal workflow per reused or executed application
stage. The command must not turn an affected result into `not-applicable`, weaken
the complete profile, or change explicit `pnpm check:quint` and hosted formal
verification.

## Git or projection evidence is unavailable

The maintainer supplies B and H as above, but Git cannot enumerate the exact
change, either projection cannot be read and validated, an identity is malformed,
or the comparison is otherwise ambiguous. The classifier reports the concrete
failure and the local gate exits nonzero before preflight, Quint checkers,
formal servers, or application qualification start. Retrying repeats the exact
classification boundary; there is no cached unavailable result and no fallback
allowlist.

No external provider, Dalph process, or journal participates. There is no Dalph
runtime crash or retry point because the changed process is the repository's
local qualification harness.

## Scenario-to-test mapping

| Scenario outcome | Acceptance test |
| --- | --- |
| An unchanged or nonformal B-to-H path set records `not-applicable` and starts zero formal workflows/checkers/servers | `scripts/local-formal-relevance.test.mjs`: `an unaffected candidate records formal not applicable and starts no formal workflow` |
| A selected `.qnt` model, executable conformance adapter, adapter helper, or governed implementation source enters one complete formal workflow | `scripts/local-formal-relevance.test.mjs`: `a model or executable conformance adapter requires exactly one formal workflow`; `scripts/classify-docs-only-change.test.mjs`: `marks an adapter helper and governed source affected while leaving the non-model resolution control unaffected` |
| Missing or malformed Git/projection evidence fails before any preflight, formal, or application child | `scripts/quality-command-routing.test.mjs`: `unavailable local formal classification fails before the resumable quality boundary`; `scripts/local-formal-relevance.test.mjs`: `unavailable formal classification fails closed before qualification children` |
| A fully reused application prefix retains exact classification and a validated not-applicable composite without formal execution receipts | `scripts/gate-resume-integration.test.mjs`: `an unaffected candidate resumes proven stages with not-applicable formal evidence and no formal workflow`; `scripts/gate-quality-evidence.test.mjs`: `not-applicable formal evidence completes the composite only for the exact unaffected classification` |
