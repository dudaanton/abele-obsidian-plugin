import { beforeEach, expect, it, vi } from 'vitest'
import { openUtilityDialog, previewImage } from '@/commands/utilityDialogs'
import { findAndReplace } from '@/commands/findAndReplace'
import { saveMedia } from '@/commands/saveMedia'
import { importFiles } from '@/commands/importFiles'
import { unusedMedia } from '@/commands/unusedMedia'
import { deduplicateMedia } from '@/commands/deduplicateMedia'
import { migrateFromDataview } from '@/commands/migrateFromDataview'
import { useVault } from '../helpers/testEnv'

const host = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('@/modal/componentDialog', () => ({ openComponentDialog: host.open }))
beforeEach(() => {
  host.open.mockReset()
  host.open.mockImplementation(() => ({ ready: Promise.resolve(), close: vi.fn() }))
})

it('routes utility commands to lazy component factories without mounting the plugin root', async () => {
  useVault([])
  for (const command of [
    findAndReplace,
    saveMedia,
    importFiles,
    unusedMedia,
    deduplicateMedia,
    migrateFromDataview,
  ])
    await command()
  for (const name of ['migrateFromFirefly', 'migrateDataviewFields', 'migrateFromToggl'] as const)
    await openUtilityDialog(name)
  expect(host.open.mock.calls.map((call) => call[2].key)).toEqual([
    'findAndReplace',
    'saveMedia',
    'importFiles',
    'unusedMedia',
    'deduplicateMedia',
    'migrateFromDataview',
    'migrateFromFirefly',
    'migrateDataviewFields',
    'migrateFromToggl',
  ])
  expect(host.open.mock.calls.every((call) => typeof call[0] === 'function')).toBe(true)
})

it('preserves file-menu preview folder ordering and replaces a previous preview instance', async () => {
  useVault([
    { path: 'Pictures/c.png' },
    { path: 'Pictures/a.svg' },
    { path: 'Pictures/b.jpg' },
    { path: 'Pictures/readme.md' },
    { path: 'Other/sample.png' },
  ])
  await previewImage('Pictures/b.jpg')
  const first = host.open.mock.results[0].value
  const props = host.open.mock.calls[0][1]
  expect(props.images.map((image: { path: string }) => image.path)).toEqual([
    'Pictures/a.svg',
    'Pictures/b.jpg',
    'Pictures/c.png',
  ])
  expect(props.startIndex).toBe(1)
  expect(props.galleryFilePath).toBe('Pictures/b.jpg')
  await previewImage('Pictures/c.png')
  expect(first.close).toHaveBeenCalledOnce()
  expect(host.open.mock.calls[1][1].startIndex).toBe(2)
})
