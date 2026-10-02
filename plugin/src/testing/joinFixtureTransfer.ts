import type { App } from 'obsidian'
import { parseFrame } from '@/transfer/frames'
import { decodePayload } from '@/transfer/payload'
import { readTransferred } from '@/transfer/connection'
import { SyncService } from '@/sync/SyncService'

/** Development-only encrypted handoff seam; no credentials returned and no GUI-join claim. */
export async function joinFixtureTransfer(app: App, text: string, code: string): Promise<boolean> {
  const svc = SyncService.getInstance()
  if (
    svc.connection.value.vaultId ||
    svc.connection.value.deviceTokenId ||
    svc.connection.value.pendingRevoke.length
  )
    throw new Error('Existing phone fixture connection left untouched')
  for (const key of [
    'abele-sync-ledger',
    'abele-sync-ledger-proof',
    'abele-sync-ledger-bootstrap',
    'abele-script-provenance',
  ])
    if (app.loadLocalStorage(key) != null)
      throw new Error('Retained phone fixture state left untouched')
  const frame = parseFrame(text)
  if (!frame || frame.index !== 1 || frame.total !== 1)
    throw new Error('Invalid single-frame fixture transfer')
  const decoded = await decodePayload(frame.data, code)
  if (!decoded.ok) throw new Error('Fixture transfer did not decrypt')
  const entry = decoded.payload.entries.find((e) => e.section === 'connection')
  if (!entry) throw new Error('Fixture connection absent')
  const received = readTransferred(entry, decoded.payload.secrets ?? {})
  if (!received.connection) throw new Error('Fixture connection is incomplete')
  await svc.adoptTransferred(received.connection, received.token, received.selective)
  await svc.answerJoin(null) // Public JoinPrefer uses null for Merge both, not a 'merge' token.
  return true
}
