import { Match } from "effect"
import type { CurrentDeliveryStatus, DeliveryStatusEntry, DeliveryStatusProjectionError } from "@dalph/orchestrator"
import type { AuthoredDeliveryStatusRead } from "../../../packages/dalph/src/cassettes/authored-delivery-status.ts"

/** Presentation of one canonical entry retains its exact fact instead of inventing a dominant task status. */
const entryLabels: Readonly<Record<DeliveryStatusEntry["_tag"], string>> = {
  DependencyWait: "Waiting for prerequisites",
  TrackerFactWait: "Waiting for tracker facts",
  TaskWorkCapacityWait: "Waiting for task-work capacity",
  ProposedDeliveryAction: "Proposed delivery action",
  LiveDeliveryAction: "Live delivery action",
  AcceptedFactPublicationWait: "Waiting for accepted fact publication",
  IntegrationTargetWait: "Waiting for integration target",
  EvidenceUnavailable: "Evidence unavailable",
  EvidenceConflict: "Evidence conflict",
  Settlement: "Delivery settlement",
  Relinquishment: "Responsibility relinquished"
}
export const deliveryStatusEntryLabel = (tag: DeliveryStatusEntry["_tag"]): string => entryLabels[tag]

const projectionErrorLabel = Match.type<DeliveryStatusProjectionError>().pipe(
  Match.tagsExhaustive({
    DeliveryStatusRunMismatch: () => "DeliveryStatusRunMismatch",
    DeliveryStatusRunIdentityUnavailable: () => "DeliveryStatusRunIdentityUnavailable",
    DeliveryStatusProjectionConflict: () => "DeliveryStatusProjectionConflict"
  })
)

export interface DeliveryStatusPresentation {
  readonly tag: string
  readonly label: string
  readonly exact: string
  readonly entries: ReadonlyArray<{
    readonly entry: DeliveryStatusEntry
    readonly label: string
    readonly exact: string
  }>
}

const statusPresentation = (status: CurrentDeliveryStatus): DeliveryStatusPresentation => {
  const label = Match.value(status).pipe(
    Match.tagsExhaustive({
      DeliveryStatusNotReady: () => "Canonical delivery observation is not ready",
      DeliveryStatusAvailable: () => "Canonical delivery status",
      TaskAbsentFromCurrentGraph: () => "Task absent from the current graph",
      DeliveryStatusClosed: () => "Canonical delivery source closed (not Run completion or application Exit)"
    })
  )
  const snapshot = status._tag === "DeliveryStatusClosed" ? status.final : status
  const entries = snapshot?._tag === "DeliveryStatusAvailable" ? snapshot.entries : []
  return {
    tag: status._tag,
    label,
    exact: JSON.stringify(status, null, 2),
    entries: entries.map((entry) => ({
      entry,
      label: deliveryStatusEntryLabel(entry._tag),
      exact: JSON.stringify(entry, null, 2)
    }))
  }
}

/** No authority services, replay controls, task selection, graph tone, or viewport enter this pure boundary. */
export const presentDeliveryStatusRead = (read: AuthoredDeliveryStatusRead): DeliveryStatusPresentation =>
  Match.value(read).pipe(
    Match.tagsExhaustive({
      Unobserved: () => ({
        tag: "Unobserved",
        label: "No coherent runtime status read has been observed",
        exact: "",
        entries: []
      }),
      Status: ({ status }) => statusPresentation(status),
      ProjectionFailed: ({ error }) => ({
        tag: error._tag,
        label: projectionErrorLabel(error),
        exact: JSON.stringify(error, null, 2),
        entries: []
      })
    })
  )

export const renderDeliveryStatusRead = (host: HTMLElement, read: AuthoredDeliveryStatusRead): void => {
  const presentation = presentDeliveryStatusRead(read)
  host.replaceChildren()
  host.dataset.status = presentation.tag
  const heading = document.createElement("h5")
  heading.textContent = presentation.label
  host.append(heading)
  for (const { entry, label, exact } of presentation.entries) {
    const item = document.createElement("section")
    item.dataset.role = "delivery-status-entry"
    item.dataset.entryTag = entry._tag
    item.dataset.classification = entry.classification
    const title = document.createElement("h6")
    title.textContent = `${entry.classification} · ${label} · ${entry.subject._tag === "Task" ? `task ${entry.subject.taskId}` : `Run ${entry.subject.runId}`}`
    const evidence = document.createElement("pre")
    evidence.textContent = exact
    item.append(title, evidence)
    host.append(item)
  }
  const details = document.createElement("details")
  const summary = document.createElement("summary")
  summary.textContent = "Exact canonical read"
  const exact = document.createElement("pre")
  exact.textContent = presentation.exact
  details.append(summary, exact)
  host.append(details)
}
