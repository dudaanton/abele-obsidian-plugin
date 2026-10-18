import { t } from '@/i18n'
/** Presentation only: sharing policy and exact operation identities stay in the existing flows. */
export function sharingErrorMessage(error: unknown, fallback: string): string {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'personal_connected') return t('streamC.7d1ae052578003c0')
  if (code === 'invalid_invitation' || code === 'invitation_expired')
    return t('streamC.cdc44f38396518cc')
  if (code === 'network_unavailable') return t('streamC.b298b2aa79073e08')
  if (code === 'unauthorized' || code === 'invalid_credentials')
    return t('streamC.b31a6462f5586b26')
  if (code === 'forbidden') return t('streamC.3338d1515fd7ff05')
  if (code === 'scope_updating') return t('streamC.433a1236b95e1a64')
  if (code === 'scope_unavailable') return t('streamC.95340ca79c155a6f')
  if (code === 'rate_limited') return t('streamC.5b49f614b13ce6b1')
  return fallback
}

export const sharingPermission = (role: string) =>
  role === 'editor' ? t('streamC.5abe9e1fbc5ba74f') : t('streamC.151dc282a69ec2fe')

export function sharingGroupState(state: string): string {
  const labels: Record<string, string> = {
    active: t('streamC.008ef00e61776003'),
    preparing: t('streamC.a162fdc637683364'),
    revoked: t('streamC.abe0e3945262811c'),
    expired: t('streamC.86b92bf3675e5460'),
    unavailable: t('streamC.fa3866d2cbea9dca'),
  }
  return labels[state] ?? t('streamC.373d48c39f30bc1c')
}
