import { Kafka } from "kafkajs"
import { describe, expect, test } from "bun:test"
import { createKafkaClient, UnsupportedAuthError } from "./client"
import type { ClusterProfile } from "../config/types"

function profile(auth: ClusterProfile["auth"]): ClusterProfile {
  return { name: "test", brokers: ["localhost:9092"], auth }
}

describe("createKafkaClient", () => {
  test("none: constructs without error", () => {
    expect(createKafkaClient(profile({ type: "none" }))).toBeInstanceOf(Kafka)
  })

  test("iam: constructs without error, no profile", () => {
    expect(createKafkaClient(profile({ type: "iam", region: "us-east-1" }))).toBeInstanceOf(Kafka)
  })

  test("iam: constructs without error, with a named profile", () => {
    expect(
      createKafkaClient(profile({ type: "iam", region: "us-east-1", profile: "staging" })),
    ).toBeInstanceOf(Kafka)
  })

  test("sasl-scram: still unimplemented", () => {
    expect(() => createKafkaClient(profile({ type: "sasl-scram", username: "u", password: "p" }))).toThrow(
      UnsupportedAuthError,
    )
  })

  test("sasl-plain: still unimplemented", () => {
    expect(() => createKafkaClient(profile({ type: "sasl-plain", username: "u", password: "p" }))).toThrow(
      UnsupportedAuthError,
    )
  })
})
