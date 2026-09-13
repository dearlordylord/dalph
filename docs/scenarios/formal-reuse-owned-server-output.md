# Fresh formal verification keeps generated server output outside candidate inputs

A maintainer merges the qualified formal-reuse branch with current master and
runs `pnpm check:all` on that frozen integration candidate. Git identifies the
exact worktree and base; the admitted run owns its helper and server processes.
No applicable formal success exists for the combined source. GitHub task
claims, Dalph executors and the workflow journal do not participate because
this changes repository verification tooling only.

After preflight passes, the formal helper starts its identified Apalache server
and executes the complete profile. Apalache writes generated server diagnostics.
During the observed run `306cc2fc-3871-4a7d-9647-d4691927a847`, all 105 commands
passed and formal success was recorded, but the enclosing candidate observer
then rejected creation beneath `_apalache-out/server/` in the checkout. The
handoff correctly failed; the formal success alone did not qualify it.

The server must receive Apalache's supported global `--out-dir` argument before
its `server` command. The exact destination is
`<original-run-directory>/owned-server-output/<formal-helper-obligation-id>`.
The admitted helper identity already names that directory, and its server
receipt records the exact argument. Evidence validation reconstructs the same
destination from the original run and helper receipt. The process working
directory, Java home, configuration lookup and all 105 checker obligations
remain unchanged.

The candidate observer starts before the server launches and stays active
through checking and planned server shutdown. Generated output beneath the
admitted run directory must not dirty the checkout; the final candidate and
formal observations must both agree before handoff succeeds. Removing only the
output argument in the controlled regression must reproduce a candidate-change
refusal. The implementation must not suppress checkout observation or treat
arbitrary output destinations as equivalent.

There is no new crash or retry protocol: existing complete-profile failure,
planned shutdown, custody reconciliation and fresh-or-reuse rules still apply.
The maintainer retains the failed handoff and its complete formal evidence;
a corrected source requires new formal applicability and a passing handoff.
This changes no Dalph workflow or outside-system protocol.

| Event and required outcome | Acceptance test |
| --- | --- |
| Fresh owned server writes diagnostics, then stops; candidate observation stays unchanged and cwd is preserved | `quint-owned-server.test.mjs`: `fresh owned server output stays in its admitted helper directory without changing candidate inputs` |
| Fixture drops only `--out-dir`; generated checkout output rejects qualification | `quint-owned-server.test.mjs`: `dropping only the owned server output argument makes native candidate observation refuse fresh qualification` |
| Saved server command points outside its exact original helper output directory | `formal-success-evidence.test.mjs`: wrong owned-server output destination cannot attest complete success |
| Ordinary fresh and warm wrappers retain exact command evidence and zero warm launches | `formal-gate.integration.test.mjs`: complete-success/reuse and quality-handoff cases |
| Combined candidate completes all stages and final no-checker validation | Final `pnpm check:all --candidate=06d1661f8a2af9a65022e3807643e3f58b5ab969`, then ordinary `pnpm check:quint` before master integration |

During subsequent merge qualification, an independent writer replaced the
shared Git configuration while the candidate observer was active. The observer
must continue refusing a lost watch and report its exact path and event mask,
so the maintainer can distinguish an input replacement from generated output.
`formal-input-policy.test.mjs`: `watch removal reports the exact lost input path
and refuses qualification` removes a watched input and proves both refusal and
the path diagnostic. This diagnostic-only change alters no Dalph runtime
behavior or input-observation policy.
