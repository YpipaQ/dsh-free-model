import { createHash, randomBytes } from 'node:crypto'
import { exportJWK, generateKeyPair, importJWK, SignJWT } from 'jose'
import type { CodeArtsCredential } from './types.js'

/** CodeArts Agent 的 OAuth client_id（即其 URI scheme，来自 product.json）。 */
export const CLIENT_ID = 'codearts-agent'
/** 本地回调路径（对齐真实插件的 AUTH_REDIRECT_URL）。 */
export const REDIRECT_PATH = '/oauth/callback'
/** 华为 STS token 端点（对齐真实插件的 IAM_TOKEN_API）。 */
export const STS_TOKEN_ENDPOINT = 'https://sts.cn-north-4.myhuaweicloud.com/v1/oauth2/tokens'
/** token 请求超时（与真实插件一致）。 */
export const TOKEN_TIMEOUT_MS = 60_000
/** OAuth 授权码换取。 */
export const GRANT_AUTHORIZATION_CODE = 'authorization_code'
/** OAuth 刷新令牌换取。 */
export const GRANT_REFRESH_TOKEN = 'refresh_token'

/** PKCE 配对：验证器 + S256 挑战。 */
export interface PkcePair {
  codeVerifier: string
  codeChallenge: string
}

/** DPoP ES256 公钥 JWK（不含私钥材料）。 */
export interface DpopPublicJwk {
  kty: 'EC'
  crv: 'P-256'
  x: string
  y: string
}

/** DPoP ES256 私钥 JWK（仅持久化 privateKeyJwk）。 */
export interface DpopPrivateJwk extends DpopPublicJwk {
  d: string
}

/** DPoP 密钥对（JWK 形式）。 */
export interface DpopKeyPair {
  privateKeyJwk: DpopPrivateJwk
  publicKeyJwk: DpopPublicJwk
}

/** /v1/oauth2/tokens 的响应体（换取所需字段）。 */
export interface TokenResponse {
  credentials?: {
    access_key_id?: string
    secret_access_key?: string
    security_token?: string
    expiration?: string
  }
  refresh_token?: string
  error?: string
  error_code?: string
  error_msg?: string
}

/** 生成 PKCE 配对：verifier 随机 48 字节 base64url，challenge 为 S256。 */
export function generatePkcePair(): PkcePair {
  const codeVerifier = randomBytes(48).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}

/** 生成 ES256（P-256）DPoP 密钥对，JWK 形式。 */
export async function generateDpopKeyPair(): Promise<DpopKeyPair> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true, crv: 'P-256' })
  return {
    privateKeyJwk: (await exportJWK(privateKey)) as DpopPrivateJwk,
    publicKeyJwk: (await exportJWK(publicKey)) as DpopPublicJwk,
  }
}

/** 用持久化的 DPoP 私钥签发 dpop+jwt JWS（htm=HTTP 方法，htu=完整 URL）。 */
export async function signDpopJws(keyPair: DpopKeyPair, htm: string, htu: string): Promise<string> {
  const key = await importJWK(keyPair.privateKeyJwk, 'ES256', { extractable: false })
  const payload = {
    htm,
    htu,
    iat: Math.floor(Date.now() / 1000),
    jti: randomBytes(32).toString('hex'),
  }
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: keyPair.publicKeyJwk })
    .sign(key)
}

/** refresh_token 已失效/被拒绝时抛出的错误；调度器据此停止续期。 */
export class RefreshTokenExpiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RefreshTokenExpiredError'
  }
}

/** 向 STS token 端点发起一次带 DPoP 的 token 请求。 */
export async function requestToken(
  body: Record<string, string>,
  keyPair: DpopKeyPair,
  fetcher: typeof fetch = fetch,
): Promise<TokenResponse> {
  const dpop = await signDpopJws(keyPair, 'POST', STS_TOKEN_ENDPOINT)
  let response: Response
  try {
    response = await fetcher(STS_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        DPoP: dpop,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error(`CodeArts token request network error: ${String(error)}`)
  }
  let data: TokenResponse | null = null
  try {
    data = (await response.json()) as TokenResponse
  } catch {
    data = null
  }
  if (!response.ok || !data?.credentials) {
    const message = `CodeArts token request failed: ${response.status}${data ? ` ${JSON.stringify(data)}` : ''}`
    // 终态判定：**只认 refresh_token 自己失效的那两种信号**。
    //
    // ⚠️ `InvalidDPoPHeader` 已从这里**移除**（真实缺陷：CodeArts 账号被永久标成
    // 「不可续期」、重启也不自愈）。它说的是「这次 DPoP proof 没通过校验」
    // —— 时钟偏差让 `iat` 落在窗口外、proof 被判定重放、网关抖动，全都是
    // **一次请求层面**的拒绝，跟「refresh_token 还能不能用」无关。
    // 把它当终态的代价是把账号材料完好（refresh_token 还有十几天寿命、
    // code_verifier 与 DPoP 私钥都在）的账号一步标死，用户只能重新登录；
    // 而把它当普通失败的代价只是 10 分钟后再试一次一个 HTTP 请求。
    // 两相对比，这里选择后者。
    const errorCode = String(data?.error_code ?? '')
    if (
      data?.error === 'invalid_grant'
      || errorCode.includes('ExpiredRefreshToken')
      // ⚠️⚠️ **`STS5.1806` 必须是终态**（上游 7167acb0 第 2 项，本 fork 2026-11-02 移植）
      //
      // 它是「一次性 token 已被消费」的专属错误码：
      // `{"error_code":"STS5.1806","error_msg":"invalid refresh token: 'the
      // refresh token has been used'"}`。华为 STS 的 refresh_token **一次性轮换**，
      // 一旦被兑换过就**永久失效** —— 重试一万次还是同一报文。
      //
      // ## 为什么漏判会造成「静默死号」而非报错
      //
      // 落到 `throw new Error(message)`（非终态）时：各家 `refreshAll` 的 catch
      // 把它当临时故障 ⇒ 只记 warn、**不标 `refreshable: false`** ⇒ 下一轮继续
      // 拿同一份已消耗的 token 去兑换 ⇒ 再撞 1806 ⇒ 日志被去重、面板照常显示
      // 「自动续期」⇒ 用户只有主动用才看到 400。
      //
      // 本 fork 有**真机证据**：2026-10-19 officeace 那次日志里就是
      // `STS5.1806 invalid refresh token: 'decode jwt header failed'`（当时那是
      // 测试污染，但这个码本身的语义是确定的）。
      //
      // ## ⚠️ 两条腿**必须都在**（上游实测的变异陷阱）
      //
      // 首版只写了 `error_code` 腿；变异验证时删掉它，用例**仍全绿** —— 因为
      // `error_msg` 那条兜底把它完全遮盖了。⇒ 两条腿的报文**刻意互不重叠**，
      // 各自有用例锁住，才不是假守卫。
      || errorCode.includes('STS5.1806')
      // 中文/英文报文腿：`error_code` 缺失时靠正文兜底
      //（`invalid refresh token: 'the refresh token has been used'`）
      || /refresh\s*token\s+has\s+been\s+used/i.test(message)
    ) {
      throw new RefreshTokenExpiredError(message)
    }
    throw new Error(message)
  }
  return data
}

/** 授权码换取（登录回调收到 code 后调用）。 */
export async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
  port: number,
  keyPair: DpopKeyPair,
  fetcher: typeof fetch = fetch,
): Promise<TokenResponse> {
  return requestToken({
    client_id: CLIENT_ID,
    code,
    code_verifier: codeVerifier,
    grant_type: GRANT_AUTHORIZATION_CODE,
    redirect_uri: `http://127.0.0.1:${port}${REDIRECT_PATH}`,
  }, keyPair, fetcher)
}

/** 刷新令牌换取（静默续期）。 */
export async function exchangeRefreshToken(
  refreshToken: string,
  codeVerifier: string,
  keyPair: DpopKeyPair,
  fetcher: typeof fetch = fetch,
): Promise<TokenResponse> {
  return requestToken({
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
    grant_type: GRANT_REFRESH_TOKEN,
    refresh_token: refreshToken,
  }, keyPair, fetcher)
}

/** 将 token 响应组装为持久化凭据 JSON（含刷新所需字段）。 */
export function credentialFromTokenResponse(
  token: TokenResponse,
  pkce: PkcePair,
  keyPair: DpopKeyPair,
): CodeArtsCredential {
  const credentials = token.credentials ?? {}
  return {
    access_key_id: credentials.access_key_id ?? '',
    secret_access_key: credentials.secret_access_key ?? '',
    security_token: credentials.security_token ?? '',
    expires_at: credentials.expiration ?? '',
    refresh_token: token.refresh_token,
    code_verifier: pkce.codeVerifier,
    dpop_private_key_jwk: keyPair.privateKeyJwk,
  }
}

/** 从持久化的私钥 JWK 恢复 DPoP 密钥对（公钥可从私钥 JWK 的 x/y 字段重建）。 */
export function keyPairFromStoredJwk(jwk: DpopPrivateJwk): DpopKeyPair {
  return {
    privateKeyJwk: jwk,
    publicKeyJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
  }
}
