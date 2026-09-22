import { Effect, Layer } from "effect"
import { RemoteBaselineGit } from "../../src/workflow/protocols/direct-publication/baseline-events.js"
import { RemotePublicationGit } from "../../src/workflow/protocols/direct-publication/events.js"

/** Explicit forbidden boundaries for fixtures whose scenario ends before remote delivery. */
export const unexpectedRemoteDeliveryLayer = Layer.merge(
  Layer.succeed(
    RemoteBaselineGit,
    RemoteBaselineGit.of({
      catchUp: () => Effect.die("this scenario must not catch up a remote baseline"),
      observe: () => Effect.die("this scenario must not read a remote baseline"),
      reconcileCatchUp: () => Effect.die("this scenario must not reconcile remote baseline catch-up")
    })
  ),
  Layer.succeed(
    RemotePublicationGit,
    RemotePublicationGit.of({
      admit: () => Effect.die("this scenario must not admit a remote destination"),
      observe: () => Effect.die("this scenario must not observe remote publication"),
      prepareSenderCustody: () => Effect.die("this scenario must not reserve a publication sender"),
      reconcileSenderCustody: () => Effect.die("this scenario must not reconcile a publication sender"),
      push: () => Effect.die("this scenario must not push")
    })
  )
)
