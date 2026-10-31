import { DatabaseSync } from 'node:sqlite'

export function verifyDirectoryChanges(dbPath, changes) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const live = db.prepare('select 1 from directories where path = ? and deleted_at is null')
    if (!live.get(changes.addedFolder)) throw new Error('New folder missing on server')
    if (live.get(changes.renamedFolderFrom)) throw new Error('Old folder remains on server')
    if (!live.get(changes.renamedFolderTo)) throw new Error('Renamed folder missing on server')
    return { addedFolderLive: true, oldFolderAbsent: true, renamedFolderLive: true }
  } finally {
    db.close()
  }
}
