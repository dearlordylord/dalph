<!-- provenance: {"dalphRevision":"1f365307f","modelRevision":"1f365307f","modelSha256":"2c042fe67afd4a84e8481179ec82fc67bd72b198dffed58ec1c9150aaf8243a1","projectionVersion":3,"quintVersion":"0.32.0","rendererVersion":"observed-dag-prototype@1","seed":"131137","step":"reconstructionStep","init":"initCapacityOneResponsibilityFirstProfile","traceKind":"sampled"} -->
# sampled trace

| Position | Action / picked task | Coordinator | Capacity | Frontier | Admission | Occupied | Reserved | Explanations | Comparison |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| S0 | initCapacityOneResponsibilityFirstProfile | Running | 1 | [{"modelOperationId":"-1","modelTaskId":"0","transitionTag":"CommitFreshTaskClaimIntent"},{"modelOperationId":"3","modelTaskId":"2","transitionTag":"CheckTaskClaim"}] | [{"modelOperationId":"3","modelTaskId":"2","transitionTag":"CheckTaskClaim"}] | [] | ["2"] | [{"modelTaskId":"0","tag":"CapacityWait","wakeCondition":"CapacityReleasedOrReconstructedStateChanged"}] | NotSupplied |
