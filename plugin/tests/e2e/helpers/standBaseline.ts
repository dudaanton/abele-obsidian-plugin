export function assertFreshStandBaseline(
  local: Record<string, unknown>,
  marker: unknown,
  connection: { vaultId?: string; deviceTokenId?: string; pendingRevoke?: unknown[] }
): void {
  // No copy of descriptors can restore a database dropped by chooseVault/forget. This fixture
  // is fresh-only: reject retained durable state BEFORE assigning ownership or writing files.
  if (connection.vaultId || connection.deviceTokenId || connection.pendingRevoke?.length)
    throw new Error('Existing connection/token/revocation state left untouched')
  for (const key of [
    'abele-sync-ledger',
    'abele-sync-ledger-proof',
    'abele-sync-ledger-bootstrap',
    'abele-script-provenance',
  ])
    if (local[key] != null) throw new Error('Retained durable sync state left untouched')
  if (marker != null) throw new Error('Retained managed sentinel left untouched')
}
