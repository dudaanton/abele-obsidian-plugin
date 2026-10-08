import type { DataAdapter } from 'obsidian'

type ProbeAdapter = Pick<
  DataAdapter,
  'readBinary' | 'writeBinary' | 'rename' | 'exists' | 'remove'
> &
  Partial<Pick<DataAdapter, 'copy'>>

/**
 * TEST ONLY: a reversible-move experiment, NOT the journal/ownership/lease contract.
 * Self-contained so exactly the same function can execute inside a live mobile page.
 * Matching hashes do not grant permission to remove the retained copy.
 */
export async function moveAndRetain(
  adapter: Pick<ProbeAdapter, 'readBinary' | 'rename' | 'exists'>,
  source: string,
  backup: string,
  afterHash?: () => Promise<void>,
  afterMove?: () => Promise<void>
) {
  const before = await crypto.subtle.digest('SHA-256', await adapter.readBinary(source))
  await afterHash?.()
  await adapter.rename(source, backup)
  await afterMove?.()
  const after = await crypto.subtle.digest('SHA-256', await adapter.readBinary(backup))
  const changed = new Uint8Array(before).some(
    (byte, index) => byte !== new Uint8Array(after)[index]
  )
  const sourceOccupied = await adapter.exists(source)
  return {
    state: changed ? 'local-changed' : sourceOccupied ? 'source-occupied' : 'cleanup-pending',
    retained: true,
    sourceOccupied,
  }
}

/** All destructive experiments use only caller-owned synthetic files under root. */
export async function probeAdapter(adapter: ProbeAdapter, root: string, retain = moveAndRetain) {
  const bytes = (value: string) => new TextEncoder().encode(value).buffer as ArrayBuffer
  const write = async (name: string, value: string) =>
    adapter.writeBinary(`${root}/${name}`, bytes(value))
  const read = async (name: string) =>
    (await adapter.exists(`${root}/${name}`))
      ? new TextDecoder().decode(await adapter.readBinary(`${root}/${name}`))
      : null
  const hash = async (name: string) =>
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', await adapter.readBinary(`${root}/${name}`))
    )
  const same = (left: Uint8Array, right: Uint8Array) =>
    left.length === right.length && left.every((byte, index) => byte === right[index])

  // A deterministic adversarial save AFTER the final hash comparison, BEFORE remove.
  await write('sample-delete.bin', 'sample base')
  const checked = same(await hash('sample-delete.bin'), await hash('sample-delete.bin'))
  await write('sample-delete.bin', 'sample edit')
  await adapter.remove(`${root}/sample-delete.bin`)
  const hashRemove = { checked, editLost: !(await adapter.exists(`${root}/sample-delete.bin`)) }

  await write('sample-move.bin', 'sample base')
  const moveRace = await retain(
    adapter,
    `${root}/sample-move.bin`,
    `${root}/sample-retained.bin`,
    () => write('sample-move.bin', 'sample edit')
  )

  // The same vulnerability remains even on an operation-owned backup name.
  await write('sample-cleanup.bin', 'sample base')
  await adapter.rename(`${root}/sample-cleanup.bin`, `${root}/sample-cleanup-backup.bin`)
  const cleanupChecked = same(
    await hash('sample-cleanup-backup.bin'),
    await hash('sample-cleanup-backup.bin')
  )
  await write('sample-cleanup-backup.bin', 'sample late edit')
  await adapter.remove(`${root}/sample-cleanup-backup.bin`)
  const cleanupRace = {
    checked: cleanupChecked,
    editLost: !(await adapter.exists(`${root}/sample-cleanup-backup.bin`)),
  }

  // Neither exists+write nor writeBinary alone means create-if-absent.
  const sawAbsent = !(await adapter.exists(`${root}/sample-install.bin`))
  await write('sample-install.bin', 'sample occupant')
  await write('sample-install.bin', 'sample incoming')
  const checkWrite = {
    sawAbsent,
    occupantOverwritten: (await read('sample-install.bin')) === 'sample incoming',
  }

  await write('sample-rename-source.bin', 'sample incoming')
  await write('sample-rename-target.bin', 'sample occupant')
  let renameRefused = false
  try {
    await adapter.rename(`${root}/sample-rename-source.bin`, `${root}/sample-rename-target.bin`)
  } catch {
    renameRefused = true
  }
  const renameOccupied = {
    refused: renameRefused,
    source: await read('sample-rename-source.bin'),
    target: await read('sample-rename-target.bin'),
  }

  let copy: {
    supported: boolean
    refused?: boolean
    source?: string | null
    target?: string | null
    freeTarget?: string | null
  } = { supported: false }
  if (typeof adapter.copy === 'function') {
    await write('sample-copy-source.bin', 'sample incoming')
    await write('sample-copy-target.bin', 'sample occupant')
    let refused = false
    try {
      await adapter.copy(`${root}/sample-copy-source.bin`, `${root}/sample-copy-target.bin`)
    } catch {
      refused = true
    }
    await adapter.copy(`${root}/sample-copy-source.bin`, `${root}/sample-copy-free.bin`)
    copy = {
      supported: true,
      refused,
      source: await read('sample-copy-source.bin'),
      target: await read('sample-copy-target.bin'),
      freeTarget: await read('sample-copy-free.bin'),
    }
  }

  // Public rename refuses replacement: the usual two-rename fallback has an observable gap.
  await write('sample-replace.bin', 'sample base')
  await write('sample-replace-temp.bin', 'sample incoming')
  await adapter.rename(`${root}/sample-replace.bin`, `${root}/sample-replace-backup.bin`)
  const targetAbsent = !(await adapter.exists(`${root}/sample-replace.bin`))
  await write('sample-replace.bin', 'sample occupant')
  let gapInstallRefused = false
  try {
    await adapter.rename(`${root}/sample-replace-temp.bin`, `${root}/sample-replace.bin`)
  } catch {
    gapInstallRefused = true
  }
  const replaceGap = {
    targetAbsent,
    refused: gapInstallRefused,
    original: await read('sample-replace-backup.bin'),
    incoming: await read('sample-replace-temp.bin'),
    occupant: await read('sample-replace.bin'),
  }

  return { hashRemove, moveRace, cleanupRace, checkWrite, renameOccupied, copy, replaceGap }
}
