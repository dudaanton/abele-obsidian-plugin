/** Credential-bearing HTTP field names, case-insensitive, including vendor-prefixed keys. */
export const CREDENTIAL_HEADER =
  /^(?:authorization|proxy-authorization|cookie|set-cookie)$|(?:^|[-_])(?:api[-_]?key|auth(?:orization)?|token|secret|password|credential|access[-_]?key|subscription[-_]?key)(?:$|[-_])/i

export const isCredentialHeader = (name: string): boolean => CREDENTIAL_HEADER.test(name.trim())
