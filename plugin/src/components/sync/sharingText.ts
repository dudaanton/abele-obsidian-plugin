/** Presentation only: sharing policy and exact operation identities stay in the existing flows. */
export function sharingErrorMessage(error: unknown, fallback: string): string {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'personal_connected')
    return 'This vault is already connected to personal sync or has retained connection records. Disconnect and Forget personal sync before joining.'
  if (code === 'invalid_invitation' || code === 'invitation_expired')
    return 'The invitation code is invalid or expired. Ask for a new invitation.'
  if (code === 'network_unavailable')
    return 'Could not reach the server. Check your connection and try again.'
  if (code === 'unauthorized' || code === 'invalid_credentials')
    return 'Check your email and password, then try again.'
  if (code === 'forbidden') return 'You do not have permission to make this change.'
  if (code === 'scope_updating')
    return 'The shared group is still getting ready. Try again shortly.'
  if (code === 'scope_unavailable')
    return 'Sharing could not be checked. Ask the server administrator for help.'
  if (code === 'rate_limited') return 'Too many attempts. Wait a moment, then try again.'
  return fallback
}

export const sharingPermission = (role: string) => (role === 'editor' ? 'Can edit' : 'Can view')

export function sharingGroupState(state: string): string {
  const labels: Record<string, string> = {
    active: 'This group is ready to share.',
    preparing: 'The group is still getting ready.',
    revoked: 'This group is no longer shared.',
    expired: 'Sharing for this group has expired.',
    unavailable: 'This group could not be checked.',
  }
  return labels[state] ?? 'This group is not ready to share.'
}
