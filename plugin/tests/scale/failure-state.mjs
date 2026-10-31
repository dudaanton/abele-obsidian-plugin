import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const execute = promisify(execFile)
async function processes() {
  const { stdout } = await execute('ps', ['-axo', 'pid=,ppid='])
  return stdout.trim().split('\n').map(line => {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    return { pid, ppid }
  })
}

// The renderer has already frozen itself after synchronously writing its fatal marker.
// Freeze its remaining app tree before copying LevelDB; diagnostic runs may then resume.
export async function preserveFailureState({ rootPid, marker, output, resume = false,
  processTable = processes, signal = (pid, name) => process.kill(pid, name),
  copy = cp, save = writeFile, makeDirectory = mkdir,
}) {
  const rows = await processTable()
  const owned = new Set([rootPid])
  for (let previous = -1; previous !== owned.size;) {
    previous = owned.size
    for (const row of rows) if (owned.has(row.ppid)) owned.add(row.pid)
  }
  if (!owned.has(marker.pid)) throw new Error('Fatal renderer is outside the owned app tree')
  const pids = [...owned]
  const receipt = { startedAt: Date.now(), marker, processes: pids, copies: [], errors: [] }
  const sources = [
    [join(marker.root, '.obsidian/plugins/abele'), 'plugin'],
    [join(marker.root, '.abele-sync'), 'sync-state'],
    [join(marker.storagePath ?? marker.userData, 'IndexedDB'), 'profile/IndexedDB'],
    [join(marker.storagePath ?? marker.userData, 'Local Storage'), 'profile/Local Storage'],
  ]
  await makeDirectory(output, { recursive: true })
  try {
    for (const pid of pids) signal(pid, 'SIGSTOP')
    for (const [source, relative] of sources) {
      try {
        await copy(source, join(output, relative), { recursive: true, dereference: false, errorOnExist: true })
        receipt.copies.push({ source, relative })
      } catch (error) {
        if (error.code === 'ENOENT') receipt.errors.push({ source, reason: 'absent' })
        else throw error
      }
    }
    receipt.endedAt = Date.now()
    await save(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2))
    return receipt
  } finally {
    for (const pid of pids.reverse()) {
      try { signal(pid, resume ? 'SIGCONT' : 'SIGKILL') } catch (error) {
        if (error.code !== 'ESRCH') {
          receipt.errors.push({ pid, operation: resume ? 'SIGCONT' : 'SIGKILL', reason: error.message })
          await save(join(output, 'termination-errors.json'), JSON.stringify(receipt.errors))
        }
      }
    }
    if (resume) {
      receipt.resumed = true
      receipt.resumedAt = Date.now()
      await save(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2))
    }
  }
}
