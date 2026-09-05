import { describe, expect, test } from "bun:test"
import { createMskIamOauthBearerProvider } from "./mskIam"
import type { IamAuth } from "../../config/types"

function fakeTokenSource(tokenPrefix: string) {
  let calls = 0
  return {
    calls: () => calls,
    generate: async (_auth: IamAuth) => {
      calls++
      return { token: `${tokenPrefix}-${calls}`, expiryTime: 0 } // expiryTime overridden per-test via `now`
    },
  }
}

describe("createMskIamOauthBearerProvider", () => {
  test("first call always generates a token", async () => {
    const source = fakeTokenSource("tok")
    const provider = createMskIamOauthBearerProvider(
      { type: "iam", region: "us-east-1" },
      { tokenSource: { generate: source.generate }, now: () => 0 },
    )
    const result = await provider()
    expect(result).toEqual({ value: "tok-1" })
    expect(source.calls()).toBe(1)
  })

  test("reuses the cached token when well within its TTL", async () => {
    const source = fakeTokenSource("tok")
    let clock = 0
    const provider = createMskIamOauthBearerProvider(
      { type: "iam", region: "us-east-1" },
      {
        tokenSource: {
          generate: async (auth) => {
            const { token } = await source.generate(auth)
            return { token, expiryTime: clock + 900_000 } // 15-minute TTL, same as the real signer
          },
        },
        now: () => clock,
      },
    )

    await provider()
    clock += 60_000 // well before the 60s refresh buffer kicks in relative to a 900s TTL
    const result = await provider()

    expect(result).toEqual({ value: "tok-1" })
    expect(source.calls()).toBe(1)
  })

  test("regenerates once the cached token is within the refresh buffer of expiring", async () => {
    const source = fakeTokenSource("tok")
    let clock = 0
    const provider = createMskIamOauthBearerProvider(
      { type: "iam", region: "us-east-1" },
      {
        tokenSource: {
          generate: async (auth) => {
            const { token } = await source.generate(auth)
            return { token, expiryTime: clock + 900_000 }
          },
        },
        now: () => clock,
      },
    )

    await provider() // expiryTime = 900_000
    clock = 900_000 - 30_000 // 30s left, inside the 60s refresh buffer
    const result = await provider()

    expect(result).toEqual({ value: "tok-2" })
    expect(source.calls()).toBe(2)
  })

  test("routes to generateAuthTokenFromProfile-equivalent source when auth.profile is set", async () => {
    const defaultSource = fakeTokenSource("default")
    const profileSource = fakeTokenSource("profile")
    const provider = createMskIamOauthBearerProvider(
      { type: "iam", region: "us-east-1", profile: "staging" },
      {
        tokenSource: {
          generate: async (auth) =>
            auth.profile
              ? { ...(await profileSource.generate(auth)), expiryTime: 900_000 }
              : { ...(await defaultSource.generate(auth)), expiryTime: 900_000 },
        },
        now: () => 0,
      },
    )

    const result = await provider()
    expect(result).toEqual({ value: "profile-1" })
    expect(profileSource.calls()).toBe(1)
    expect(defaultSource.calls()).toBe(0)
  })

  test("routes to the default source when auth.profile is unset", async () => {
    const defaultSource = fakeTokenSource("default")
    const profileSource = fakeTokenSource("profile")
    const provider = createMskIamOauthBearerProvider(
      { type: "iam", region: "us-east-1" },
      {
        tokenSource: {
          generate: async (auth) =>
            auth.profile
              ? { ...(await profileSource.generate(auth)), expiryTime: 900_000 }
              : { ...(await defaultSource.generate(auth)), expiryTime: 900_000 },
        },
        now: () => 0,
      },
    )

    const result = await provider()
    expect(result).toEqual({ value: "default-1" })
    expect(defaultSource.calls()).toBe(1)
    expect(profileSource.calls()).toBe(0)
  })
})
