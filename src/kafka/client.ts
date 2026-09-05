import { Kafka, logLevel } from "kafkajs"
import type { ClusterProfile } from "../config/types"

export class UnsupportedAuthError extends Error {}

export function createKafkaClient(profile: ClusterProfile): Kafka {
  const clientId = "kafka-tui"

  switch (profile.auth.type) {
    case "none":
      return new Kafka({ clientId, brokers: profile.brokers, logLevel: logLevel.NOTHING })

    case "iam":
      // Spec §4: aws-msk-iam-sasl-signer-js + sasl.mechanism 'oauthbearer'. Lands in phase 9,
      // built and tested against real MSK last so AWS-specific debugging stays isolated.
      throw new UnsupportedAuthError(
        `Profile "${profile.name}" uses auth.type "iam", which isn't implemented until phase 9.`,
      )

    case "sasl-scram":
    case "sasl-plain":
      // Present in the config schema (spec §3) but never assigned a build phase in spec §11.
      throw new UnsupportedAuthError(
        `Profile "${profile.name}" uses auth.type "${profile.auth.type}", which isn't implemented yet.`,
      )
  }
}
