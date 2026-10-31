export function planOfflineChanges(scope, expected) {
  const candidates = expected.filter(file => file.path.endsWith('.md') && file.path.includes('/Sample ')).slice(8, 11)
  if (candidates.length !== 3) throw new Error('Missing three offline edit candidates')
  const oldFolder = `${scope}/Notes/Section 1/层 1/Nested 1`
  const newFolder = `${oldFolder} moved`
  const moves = expected.filter(file => file.path.startsWith(oldFolder+'/'))
    .map(file => ({ from: file.path, to: newFolder+file.path.slice(oldFolder.length) }))
  if (moves.length !== 32 || expected.some(file => file.path.startsWith(newFolder+'/')))
    throw new Error('Offline folder move must cover exactly 32 unconflicted files')
  const addedFolder = `${scope}/Notes/Added while closed`
  const plan = {
    sized: candidates[0].path,
    sameSize: candidates[1].path,
    deleted: candidates[2].path,
    added: `${scope}/Notes/Section 0/层 0/Nested 0/Added while closed.md`,
    addedFolder,
    folderFile: `${addedFolder}/Inside.md`,
    renameFrom: oldFolder,
    renameTo: newFolder,
    moves,
  }
  const existing = new Set(expected.map(file => file.path))
  for (const path of [plan.added, plan.folderFile, ...moves.map(x => x.to)])
    if (existing.has(path)) throw new Error('Offline target already exists: '+path)
  return plan
}

export function updateExpectedOfflineChanges(expected, plan, changed) {
  const rows = new Map(expected.map(file => [file.path, file]))
  if (!rows.delete(plan.deleted)) throw new Error('Offline delete target missing')
  for (const move of plan.moves)
    if (!rows.delete(move.from)) throw new Error('Offline move source missing')
  const permitted = new Set([
    plan.sized, plan.sameSize, plan.added, plan.folderFile,
    ...plan.moves.map(move => move.to),
  ])
  if (changed.length !== permitted.size) throw new Error('Offline changed-file count differs')
  for (const file of changed) {
    if (!permitted.delete(file.path) || !Number.isSafeInteger(file.size) || !file.sha)
      throw new Error('Unexpected offline changed file')
    rows.set(file.path, file)
  }
  if (permitted.size) throw new Error('Offline change missing expected file')
  return [...rows.values()]
}
