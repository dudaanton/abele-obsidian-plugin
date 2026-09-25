import { secrets } from '@/secrets/SecretStore'
import { AbeleConfig } from '@/services/AbeleConfig'

const SECRET_REGEX = /\$\{abele_key:([^}]+)\}/g

/**
 * Replace ${abele_key:name} placeholders with actual secret values from keychain.
 * Unknown keys are replaced with empty string.
 */
export function substituteSecrets(text: string): string {
  const named = AbeleConfig.getInstance().ai.secrets || []

  return text.replace(SECRET_REGEX, (_, name) => {
    const secret = named.find((s) => s.name === name)
    if (!secret?.keyId) return ''
    return secrets().get(secret.keyId) || ''
  })
}
