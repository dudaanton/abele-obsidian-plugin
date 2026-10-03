import { secrets } from '@/secrets/SecretStore'
import { mcpToolName } from '@/ai/mcp/names'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  checkKeyDestination,
  checkRequestDestinations,
  initializeDestinations,
} from '@/secrets/destinations'
import { httpOrigin } from '@/secrets/DestinationPolicy'
import { encodeBasicCredentials } from '@/secrets/basicAuth'
import { allowKeyRecipient } from '@/secrets/manualConsent'
import { checkKeyTransport } from '@/secrets/keyTransport'

const PLACEHOLDER = /\$\{abele_key:([^}]+)\}/g
const KEY_TOOLS = new Set(['fetch', 'download_image', 'download_file'])
export function secretNames(value: unknown): string[] {
  if (typeof value === 'string') return [...value.matchAll(PLACEHOLDER)].map((m) => m[1])
  if (value && typeof value === 'object')
    return [...new Set(Object.values(value).flatMap(secretNames))]
  return []
}
export function secretRequestForTool(tool: string, args: unknown): SecretRequest | null {
  if (KEY_TOOLS.has(tool))
    return args && typeof args === 'object' ? snapshotSecretRequest(args as SecretRequest) : null
  if (tool.startsWith('mcp_')) {
    const server = AbeleConfig.getInstance().ai?.mcpServers?.find((s) =>
      s.tools.some((t) => mcpToolName(s.name, t.name) === tool)
    )
    if (server) return snapshotSecretRequest({ url: server.url, headers: server.headers })
  }
  return null
}
export function needsSecretApproval(tool: string, args: unknown): boolean {
  const request = secretRequestForTool(tool, args)
  if (!request || !secretNames(request).length) return false
  try {
    return secretRequestInfo(request).missing.length > 0
  } catch {
    // Invalid recipients or unknown keys must not bypass the human approval boundary.
    return true
  }
}
export interface SecretRequest {
  url: string
  headers?: Record<string, string>
  body?: string
  basicAuth?: { username: string; password: string }
}
/** Keep the recipient and unresolved credentials fixed while a human question is pending. */
export function snapshotSecretRequest(request: SecretRequest): SecretRequest {
  return {
    url: request.url,
    headers: { ...request.headers },
    body: request.body,
    ...(request.basicAuth ? { basicAuth: { ...request.basicAuth } } : {}),
  }
}
function named(name: string) {
  const secret = AbeleConfig.getInstance().ai?.secrets?.find((s) => s.name === name)
  if (!secret?.keyId) throw new Error(`No saved key named ${name}`)
  return secret
}
/** No values are read when preparing an approval. Placeholders cannot choose the recipient. */
export function secretRequestInfo(request: SecretRequest) {
  if (request.basicAuth) {
    const { username, password } = request.basicAuth
    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      secretNames(username).length
    )
      throw new Error(
        'Basic authentication requires a plain username and a password or saved-password placeholder'
      )
    if (Object.keys(request.headers ?? {}).some((name) => /^authorization$/i.test(name)))
      throw new Error('Choose Basic authentication or an Authorization header, not both')
    encodeBasicCredentials(username, password)
  }
  const names = [...new Set(secretNames(request))]
  const origin = httpOrigin(request.url)
  if (!origin && names.length)
    throw new Error('A saved key cannot choose the address or URL credentials')
  return {
    origin: origin ?? '',
    names,
    bindings: names.map((name) => ({ name, keyId: named(name).keyId })),
    missing: names.filter((name) => {
      const secret = named(name)
      try {
        if (!(secret.allowedOrigins ?? []).includes(origin!)) return true
        checkKeyDestination(secret.keyId, origin!, AbeleConfig.getInstance())
        return false
      } catch {
        return true
      }
    }),
  }
}
/** Only a direct UI action calls this; remember both the configured origin and local trust. */
export function allowSecretOrigin(name: string, url: string, signal?: AbortSignal): Promise<void> {
  // Unencrypted transport still requires the warning and explicit action in destination review.
  checkKeyTransport(url)
  return allowKeyRecipient({ keyId: named(name).keyId, address: url }, signal)
}

export function prepareSecretRequest(
  request: SecretRequest
): SecretRequest & { headers: Record<string, string>; secretValues: string[] } {
  request = snapshotSecretRequest(request)
  const info = secretRequestInfo(request)
  const config = AbeleConfig.getInstance()
  if (info.names.length) initializeDestinations(config)
  const values = new Map<string, string>()
  for (const name of info.names) {
    const secret = named(name)
    if (!(secret.allowedOrigins ?? []).includes(info.origin))
      throw new Error(`Saved key ${name} is not allowed at ${info.origin}`)
    checkKeyDestination(secret.keyId, info.origin, config)
    const value = secrets().get(secret.keyId)
    if (!value) throw new Error(`Saved key ${name} has no value on this device`)
    values.set(name, value)
  }
  const fill = (text: string) =>
    text.replace(PLACEHOLDER, (_, name: string) => values.get(name) ?? '')
  const url = fill(request.url)
  if (info.names.length && httpOrigin(url) !== info.origin)
    throw new Error('A saved key cannot change the recipient')
  const headers = Object.fromEntries(
    Object.entries(request.headers ?? {}).map(([k, v]) => [k, fill(v)])
  )
  if (request.basicAuth)
    headers.Authorization = encodeBasicCredentials(
      request.basicAuth.username,
      fill(request.basicAuth.password)
    )
  const prepared = {
    url,
    headers,
    body: request.body === undefined ? undefined : fill(request.body),
  }
  return {
    ...prepared,
    secretValues: [...new Set([...values.values(), ...checkRequestDestinations(prepared, config)])],
  }
}

/** Configured service headers also need an explicit recipient; never expand a free string. */
export function substituteSecrets(text: string, destination?: string): string {
  if (!secretNames(text).length) return text
  if (!destination) throw new Error('Saved key substitution requires a destination')
  return prepareSecretRequest({ url: destination, headers: { value: text } }).headers.value
}
export function redactSecrets(text: string, values: string[]): string {
  for (const value of [...values].sort((a, b) => b.length - a.length))
    if (value) text = text.split(value).join('[saved key]')
  return text
}
