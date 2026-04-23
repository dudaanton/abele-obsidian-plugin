import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'

const SECRET_REGEX = /\$\{abele_key:([^}]+)\}/g

/**
 * Replace ${abele_key:name} placeholders with actual secret values from keychain.
 * Unknown keys are replaced with empty string.
 */
export function substituteSecrets(text: string): string {
  const { app } = GlobalStore.getInstance()
  const secrets = AbeleConfig.getInstance().ai.secrets || []

  return text.replace(SECRET_REGEX, (_, name) => {
    const secret = secrets.find((s) => s.name === name)
    if (!secret?.keyId) return ''
    return app.secretStorage.getSecret(secret.keyId) || ''
  })
}
