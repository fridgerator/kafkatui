import { Kafka, logLevel } from "kafkajs"
import type { ClusterProfile } from "../config/types"
import { createMskIamOauthBearerProvider } from "./auth/mskIam"
import { createFileLogCreator } from "./fileLogger"

export class UnsupportedAuthError extends Error {}

export function createKafkaClient(profile: ClusterProfile): Kafka {
  const clientId = "kafka-tui"
  // kafkajs's default logger writes to the terminal, corrupting the TUI — see fileLogger.ts's
  // doc comment. `createFileLogCreator()` shares one timestamped file per process run across
  // every client this function constructs.
  const logCreator = createFileLogCreator()

  switch (profile.auth.type) {
    case "none":
      return new Kafka({
        clientId,
        brokers: profile.brokers,
        logLevel: logLevel.INFO,
        logCreator,
      })

    case "iam":
      // Spec §4: aws-msk-iam-sasl-signer-js + sasl.mechanism 'oauthbearer', not the built-in
      // 'aws' mechanism (that one wants static keys and a broker-side LoginModule MSK doesn't
      // have). TLS is required alongside SASL/OAUTHBEARER; the user's config supplies the
      // correct MSK bootstrap string (typically port 9098) — this doesn't rewrite ports.
      return new Kafka({
        clientId,
        brokers: profile.brokers,
        ssl: true,
        sasl: {
          mechanism: "oauthbearer",
          oauthBearerProvider: createMskIamOauthBearerProvider(profile.auth),
        },
        logLevel: logLevel.INFO,
        logCreator,
      })

    case "sasl-scram":
    case "sasl-plain":
      // Present in the config schema (spec §3) but never assigned a build phase in spec §11.
      throw new UnsupportedAuthError(
        `Profile "${profile.name}" uses auth.type "${profile.auth.type}", which isn't implemented yet.`,
      )
  }
}
