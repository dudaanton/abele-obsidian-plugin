import { expect, it, vi } from 'vitest'
import { useVault } from '../helpers/testEnv'
import { tokenOffloadsOf } from '@/sync/tokenOffloadCoordinator'
import { pathCoordinatorOf } from '@/sync/pathCoordinator'
import { createCopyFileTool } from '@/ai/tools/CopyFileTool'
import { createCreateFileTool } from '@/ai/tools/CreateFileTool'
import { createMoveFileTool } from '@/ai/tools/MoveFileTool'
import { createWriteFileTool } from '@/ai/tools/WriteFileTool'
import { createImportedBinary } from '@/media/importImageFile'
import { saveImageToVault } from '@/ai/tools/imageUtils'

it('rejects a generated image beneath an offloaded file instead of suffixing forever', async () => {
  const app = useVault([])
  const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
  manager.remember('sample', [{ path: 'Attachments/reserved.pdf', size: 40, mtime: 1 }], [])
  let probes = 0
  const lookup = app.vault.getAbstractFileByPath.bind(app.vault)
  vi.spyOn(app.vault, 'getAbstractFileByPath').mockImplementation((path) => {
    if (++probes > 20) throw new Error('Unbounded filename search')
    return lookup(path)
  })
  await expect(
    saveImageToVault(
      'data:image/png;base64,c2FtcGxl',
      'reserved.pdf/image',
      undefined,
      app as never
    )
  ).rejects.toThrow(/Parent.*offloaded/)
  expect(probes).toBeLessThan(20)
})

it('rejects imports beneath an offloaded file before suffix searching', async () => {
  const app = useVault([])
  const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
  manager.remember('sample', [{ path: 'Media/reserved.pdf', size: 40, mtime: 1 }], [])
  let probes = 0
  const lookup = app.vault.getAbstractFileByPath.bind(app.vault)
  vi.spyOn(app.vault, 'getAbstractFileByPath').mockImplementation((path) => {
    if (++probes > 20) throw new Error('Unbounded filename search')
    return lookup(path)
  })
  await expect(
    createImportedBinary(app as never, 'Media/reserved.pdf/image.png', new Blob(['image']))
  ).rejects.toThrow(/Parent.*offloaded/)
  expect(probes).toBeLessThan(20)
})

it.each(['copy', 'create', 'move', 'write', 'parent folder'])(
  'keeps an offloaded identity occupied for %s',
  async (operation) => {
    const app = useVault([
      { path: 'Media/source.pdf', content: 'unrelated bytes' },
      { path: 'Media/reserved.pdf.abele-ref', content: 'projection' },
    ])
    const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
    manager.remember(
      'sample',
      [{ path: 'Media/reserved.pdf', size: 40, mtime: 1 }],
      ['Media/reserved.pdf.abele-ref']
    )
    const create = vi.spyOn(app.vault, 'create'),
      binary = vi.spyOn(app.vault, 'createBinary'),
      folder = vi.spyOn(app.vault, 'createFolder')
    const target =
      operation === 'parent folder' ? 'Media/reserved.pdf/child.md' : 'Media/reserved.pdf'
    const call =
      operation === 'copy'
        ? createCopyFileTool({ skipScope: true }).execute('sample', {
            from: 'Media/source.pdf',
            to: target,
          })
        : operation === 'move'
          ? createMoveFileTool({ skipScope: true }).execute('sample', {
              from: 'Media/source.pdf',
              to: target,
            })
          : operation === 'write'
            ? createWriteFileTool({ skipScope: true }).execute('sample', {
                path: target,
                content: 'replacement',
              })
            : createCreateFileTool({ skipScope: true }).execute('sample', {
                path: target,
                content: 'replacement',
              })
    await expect(call).rejects.toThrow(/Destination exists as an offloaded file/)
    expect(create).not.toHaveBeenCalled()
    expect(binary).not.toHaveBeenCalled()
    expect(folder).not.toHaveBeenCalled()
    expect(await app.vault.adapter.read('Media/source.pdf')).toBe('unrelated bytes')
    expect(await app.vault.adapter.exists('Media/reserved.pdf')).toBe(false)
  }
)

it('rechecks a copy destination after reading its source', async () => {
  const app = useVault([{ path: 'Media/source.pdf', content: 'source' }])
  const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
  const read = app.vault.readBinary.bind(app.vault)
  vi.spyOn(app.vault, 'readBinary').mockImplementation(async (file) => {
    const bytes = await read(file)
    manager.remember('sample', [{ path: 'Media/reserved.pdf', size: 40, mtime: 1 }], [])
    return bytes
  })
  const create = vi.spyOn(app.vault, 'createBinary')
  await expect(
    createCopyFileTool({ skipScope: true }).execute('sample', {
      from: 'Media/source.pdf',
      to: 'Media/reserved.pdf',
    })
  ).rejects.toThrow(/offloaded/)
  expect(create).not.toHaveBeenCalled()
})

it('generated imports choose a free logical filename instead of occupying an offloaded image', async () => {
  const app = useVault([{ path: 'Media/sample.png.abele-ref', content: 'projection' }])
  const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
  manager.remember('sample', [{ path: 'Media/sample.png', size: 40, mtime: 1 }], [])
  const file = await createImportedBinary(
    app as never,
    'Media/sample.png',
    new Blob(['new image'], { type: 'image/png' })
  )
  expect(file.path).toBe('Media/sample 1.png')
  expect(await app.vault.adapter.exists('Media/sample.png')).toBe(false)
})
