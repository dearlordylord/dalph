import { Duration, Schema } from "effect"

/**
 * A finite, positive duration used by a local control-plane boundary.
 *
 * A tracker, Git, or execution-substrate response is not this value: those
 * systems own their response latency and are measured or bounded by their
 * exact protocol instead.
 */
const finitePositiveDuration = Schema.DurationFromString.check(
  Schema.makeFilter((duration) =>
    Duration.isFinite(duration) && Duration.isPositive(duration)
      ? undefined
      : "control-plane durations must be finite and greater than zero"
  )
)

/** The interval between local descriptor/path ownership observations. */
export const CoordinatorOwnershipObservationInterval = finitePositiveDuration.pipe(
  Schema.brand("CoordinatorOwnershipObservationInterval")
)
export type CoordinatorOwnershipObservationInterval = typeof CoordinatorOwnershipObservationInterval.Type

/** The fixed V1 local application Exit drain limit. */
export const ApplicationExitDrainDuration = finitePositiveDuration.pipe(Schema.brand("ApplicationExitDrainDuration"))
export type ApplicationExitDrainDuration = typeof ApplicationExitDrainDuration.Type

const coordinatorOwnershipObservationSeconds = 1
const applicationExitDrainSeconds = 5

/** One local ownership observation per second after the previous comparison completes. */
export const coordinatorOwnershipObservationInterval = CoordinatorOwnershipObservationInterval.make(
  Duration.seconds(coordinatorOwnershipObservationSeconds)
)

/** Five seconds from the first Exit admission cutoff, without reset or extension. */
export const applicationExitDrainDuration = ApplicationExitDrainDuration.make(
  Duration.seconds(applicationExitDrainSeconds)
)
