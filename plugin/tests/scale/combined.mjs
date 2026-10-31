import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function applyCombinedChanges(root, targets) {
  if (targets.moves.length !== 32) throw new Error('Expected exactly 32 renamed files')
  const changed = []
  const describe = (path, bytes) => ({ path, size: bytes.length, sha: createHash('sha256').update(bytes).digest('hex') })
  const write = async (path, bytes, options) => {
    await writeFile(join(root, path), bytes, options)
    changed.push(describe(path, bytes))
  }
  await write(targets.sized, Buffer.concat([await readFile(join(root, targets.sized)), Buffer.from('\nOffline size edit\n')]))
  const same = Buffer.from(await readFile(join(root, targets.sameSize)))
  const previous = await stat(join(root, targets.sameSize))
  same[0] = same[0] === 35 ? 36 : 35
  await write(targets.sameSize, same)
  await utimes(join(root, targets.sameSize), previous.atime, new Date(previous.mtimeMs + 5000))
  await write(targets.added, Buffer.from('# Added while the app was closed\n'), { flag: 'wx' })
  await unlink(join(root, targets.deleted))
  await mkdir(join(root, targets.addedFolder))
  await write(targets.folderFile, Buffer.from('# Inside the new offline folder\n'), { flag: 'wx' })
  await rename(join(root, targets.renameFrom), join(root, targets.renameTo))
  for (const move of targets.moves) changed.push(describe(move.to, await readFile(join(root, move.to))))
  return changed
}
