# Counterexample analysis

The counterexample module deliberately adds three transitions that the accepted
protocol forbids. Each transition is checked against the same property used for
the safe model.

| Weakened rule | Expected violated property | Meaning |
| --- | --- | --- |
| Apply a claim effect without first recording the operation intent | `everyEffectHasIntent` | A boundary effect cannot be reconstructed or reconciled because no durable operation identity authorizes it. |
| Apply the same current-boundary effect a second time | `noDuplicateAuthorityEffect` | Retrying after ambiguity crossed the boundary twice instead of rereading the authority and retaining one operation identity. |
| Send a request after restart without a new authority observation | `noStaleAuthorityUse` | Pre-crash knowledge was treated as current authority after the coordinator activation changed. |

The bounded checks and shortest traces are recorded in `VERIFICATION.md`. These
are intentionally failing model profiles; failure is the expected result and
demonstrates that the properties are not tautologies.

During construction, the safe model also produced one property counterexample:
`branchLocalConstraintDoesNotStopC` initially required task `C` to be
immediately startable while the coordinator was crashed. The trace was:

1. commit task `A`'s claim intent;
2. crash the coordinator;
3. evaluate branch progress before restart.

The protocol was correct—the only legal coordinator action was restart. The
property was corrected to scope immediate branch progress to a running
coordinator. This distinction is retained because “nonterminal with an exact
wake action” is not deadlock.
