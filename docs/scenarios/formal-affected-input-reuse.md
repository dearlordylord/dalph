# Formal success follows the inputs the formal command actually consumes

After a maintainer has completed the local formal profile, they may repair an
unrelated test under `scripts/`, add or remove an experimental Quint model, or
edit documentation before the next local handoff. The formal success record,
its stopped checker/server custody evidence, the installed toolchain, and the
effective profile are unchanged. GitHub, Dalph executors, and the workflow
journal do not participate because this is repository verification tooling,
not Dalph runtime behavior.

When the maintainer runs the formal gate again, it parses the JavaScript admission
runner, formal entry points, and spawned profile helper, then follows their
repository-local imports. It reads model paths
from the effective Quint command arguments and follows the pinned Quint
resolver recursively. It compares those files, resolved installed tools,
environment, profile, absent Apalache configuration, and custody evidence with
the completed record. The unrelated repair remains outside that closure, so
the gate reports reuse and starts zero checkers and zero servers. Raw package,
lock, workspace, npm, patch, and hosted-CI files are not local formal inputs;
the resolved toolchain and effective profile already retain the portions the
local command consumes.

If the maintainer instead changes a formal entry point, a helper it imports, a
selected model (including a selected negative-control model), or a model that
the selected model imports, the input identity changes and the complete profile
runs. A newly added repository-local import enters the closure automatically.
Non-literal dynamic repository imports are refused because their affected input
cannot be established without executing source discovery.

A short observer watches repository source and the already-resolved tool/configuration
roots before dependency discovery; Git state, generated run/output trees, and
installation trees outside the resolved tools remain excluded.
After discovery, the retained observer watches only the computed files and the
existing tool/configuration roots. Both observers overlap while the closure and
bytes are derived again; the broad observer is drained before it closes. Thus a
relevant replace-and-restore during discovery is rejected, while an unrelated
sibling edit during the long checker run does not dirty the retained observer.
The final snapshot derives the closure again. A missing import target, changed
symlink resolution, or newly introduced dependency fails closed.

There is no new crash, retry, or outside-system protocol. Existing observer,
custody, success-publication, and final-comparison rules apply. One shared
evidence contract owns the input, observer, and success-policy generations;
observation validation always uses the input-policy generation. Evidence
recorded by a former input policy is a clean miss rather than compatibility
state.

| Event and required outcome | Acceptance test |
| --- | --- |
| Resolve a formal executable when the first `PATH` directory is absent | `formal-input-policy.test.mjs`: `formal executable lookup continues from a missing PATH entry to the later executable` |
| Add, edit, or delete an unrelated `scripts/*.test.*`; edit docs, raw workspace metadata, or an unselected model | `formal-input-policy.test.mjs`: `retains formal reuse across unrelated edits without binding HEAD index or base` |
| Edit a direct or transitive JavaScript helper; add a new static import target | `formal-input-policy.test.mjs`: `discovers direct and transitive JavaScript helpers without including their siblings`; `reruns after selected content, mode, or newly imported target changes` |
| Edit the spawned admission runner or one of its transitive identity/slot helpers | `formal-input-policy.test.mjs`: `tracks the spawned admission entry and its transitive helpers`; the zero-launch integration also asserts the actual closure contains all three files |
| Import through a symlink or use extensionless CommonJS resolution | `formal-input-policy.test.mjs`: `resolves a symlink-imported module's children from the real importer`; `uses distinct exact ESM and Node CommonJS resolution rules` |
| An extensionless CommonJS candidate or requested package directory resolves through a symlink whose lexical inputs are not retained | `formal-input-policy.test.mjs`: `fails closed when extensionless CommonJS selection would lose a lexical symlink`; `fails closed when CommonJS selection starts through a symlinked directory` |
| Edit a selected model, selected negative-control model, or recursively imported model; leave an experiment unselected | `formal-input-policy.test.mjs`: `discovers selected, negative-control, and recursively imported Quint inputs only` |
| Edit an unrelated sibling while retained observation is active; remove an imported dependency | `formal-input-policy.test.mjs`: `retained exact observation ignores unrelated script mutation but rejects imported dependency disappearance` |
| Replace and restore a relevant file during discovery | `formal-input-policy.test.mjs`: `rejects edit and revert before initial hashing returns any formal identity` |
| Use an unidentifiable dynamic dependency or a symlink outside the worktree | `formal-input-policy.test.mjs`: `rejects non-literal repository dependency discovery`; `refuses unidentifiable current inputs: undeclared target and cycle` |
| Read success evidence written under the old policy | `formal-success-evidence.test.mjs`: `reruns when required evidence is malformed truncated old-policy or mismatched; distinguishes optional logs` |
| Validate input/observer/success generations at publication and handoff | `formal-success-evidence.test.mjs`: `shared formal evidence contract owns input observation and success generations`; `gate-quality-evidence.test.mjs` composite cases |
| Retry after an unrelated test-only repair | `formal-gate.integration.test.mjs`: complete-success/reuse scenario asserts the reuse message and zero checker/server launches |
