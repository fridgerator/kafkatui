import { generateAuthToken, generateAuthTokenFromProfile } from "aws-msk-iam-sasl-signer-js"
import type { IamAuth } from "../../config/types"

export interface OauthBearerToken {
  value: string
}

interface CachedToken {
  token: string
  expiryTime: number
}

interface TokenSource {
  generate(auth: IamAuth): Promise<CachedToken>
}

/**
 * `generateAuthToken`'s type signature accepts `awsProfileName`, but the installed
 * implementation ignores it and always resolves the default credential chain — a named
 * profile only takes effect via the separate `generateAuthTokenFromProfile` call. Confirmed
 * by reading the compiled package, not the README.
 */
const defaultTokenSource: TokenSource = {
  generate: (auth) =>
    auth.profile
      ? generateAuthTokenFromProfile({ region: auth.region, awsProfileName: auth.profile })
      : generateAuthToken({ region: auth.region }),
}

/** MSK IAM tokens are fixed at a 900s TTL — refresh a bit early rather than racing expiry mid-handshake. */
const REFRESH_BUFFER_MS = 60_000

/**
 * Builds a kafkajs `oauthBearerProvider`. Tokens are cached and only regenerated once within
 * `REFRESH_BUFFER_MS` of expiring — kafkajs calls this fresh on every new connection's SASL
 * handshake, so without caching this would hit AWS credential resolution far more than needed.
 */
export function createMskIamOauthBearerProvider(
  auth: IamAuth,
  deps: { tokenSource?: TokenSource; now?: () => number } = {},
): () => Promise<OauthBearerToken> {
  const tokenSource = deps.tokenSource ?? defaultTokenSource
  const now = deps.now ?? Date.now
  let cached: CachedToken | null = null

  return async () => {
    if (!cached || cached.expiryTime - now() < REFRESH_BUFFER_MS) {
      cached = await tokenSource.generate(auth)
    }
    return { value: cached.token }
  }
}
