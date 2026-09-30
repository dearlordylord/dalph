# Local full qualification records formal relevance and leaves proof opt-in

This scenario changes repository qualification tooling only. It does not change
Dalph runtime commands, workflow decisions, provider requests, journal facts,
retries, concurrency rules, cleanup actions, or delivery-visible results.

## A maintainer qualifies a candidate without a formal-input change

A maintainer freezes candidate commit H and supplies its exact planned Base B to
`pnpm check:all --candidate=B`. Git contains both commits, B is an ancestor of
H, and both checked-in formal-input projections are readable. Before it builds
or starts application stages, the runner enumerates the exact B-to-H paths and
classifies them against the union of those projections. No Quint checker or
server has started.

The candidate changes no projected formal input. The runner retains the exact
`unaffected` classification, including its Base, candidate, changed paths, and
empty affected-path list. It records `formalDisposition: "not-requested"` and
executes the selected application manifest. The manifest contains no formal
stage, and the runner starts zero local Quint checkers and servers. Its report
does not replace the classification with `not-applicable`.

## A maintainer qualifies a candidate with a formal-input change

The starting facts and trigger are the same, except at least one changed path
is a selected `.qnt` model, a formal command/helper/toolchain input, or an
executable model-conformance adapter or one of its TypeScript-resolved helper,
type, or governed implementation dependencies named by the checked-in
projection. The runner retains the exact `affected` classification and its
affected paths, records `formalDisposition: "not-requested"`, and executes the
selected application manifest without a formal stage or local Quint process.
It does not erase or downgrade the relevance result.

Formal proof remains available through the explicit `pnpm check:quint` command
and the independent CI formal workflow. CI continues to use the exact formal
classification to decide whether its complete formal workflow is required.
Making local proof opt-in does not weaken either path.

## Git or projection evidence is unavailable

The maintainer supplies B and H, but Git cannot enumerate the exact change,
either projection cannot be read and validated, an identity is malformed, or
the comparison is otherwise ambiguous. The local candidate runner fails before
it constructs or executes the application manifest. It must not treat
unavailable evidence as unaffected or record `not-requested` as proof that no
formal input changed.

No external provider, Dalph process, or journal participates. There is no Dalph
runtime crash or retry point because the changed process is the repository's
local qualification harness.

## Scenario-to-test mapping

| Scenario outcome | Acceptance test |
| --- | --- |
| Local `check:all` retains the exact affected or unaffected classification, records `not-requested`, and executes no formal stage | `scripts/candidate-checks.test.mjs`: `local candidate report preserves exact formal relevance and not-requested without a formal stage` (writes and reads both classifications through the production report path) |
| The candidate runner records and executes the same selected application manifest and keeps failed stages failed | `scripts/candidate-checks.test.mjs`: `candidate runner records and executes the same chosen manifest without reader substitution`; `scripts/candidate-checks.test.mjs`: `actual failure remains a failure and never manufactures a repair permit` |
| A formal classification cannot be inferred from unavailable Git or projection evidence | `scripts/classify-docs-only-change.test.mjs`: `one exact classifier accepts an unchanged candidate and rejects unavailable identities`; `scripts/classify-docs-only-change.test.mjs`: `fails closed for missing identities, unsupported events, empty diffs, and unavailable projections`; `scripts/classify-docs-only-change.test.mjs`: `rejects malformed hosted formal projections instead of hiding missing inputs` |
| Manual formal verification and CI formal verification remain available with their existing routing | `scripts/quint-ci-contract.test.ts`: `exposes complete CI and independently runnable quality/formal subgates` |
| Lower-level resumable `check:ci:quality` formal evidence keeps its separate `not-applicable` semantics | `scripts/gate-resume-integration.test.mjs`: `an unaffected candidate resumes proven stages with not-applicable formal evidence and no formal workflow`; `scripts/gate-quality-evidence.test.mjs`: `not-applicable formal evidence completes the composite only for the exact unaffected classification` |

The lower-level resume tests concern `check:ci:quality` evidence. They do not
define the local `check:all` report disposition; that policy is covered by the
candidate-check test above.
