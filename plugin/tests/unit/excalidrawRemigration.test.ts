import { describe, expect, it, vi } from 'vitest'
import type { App, TFile } from 'obsidian'
import { buildFakeVault } from '../helpers/fakeVault'
import { pencilScene } from '../helpers/excalidrawInkScene'
import { migrateDrawing, ObsidianExcalidrawVault } from '@/canvas/excalidrawAdapter'
import { migrateAll } from '@/canvas/excalidraw/migrate'
import { openCanvas } from '@/canvas/opening'

vi.mock('@/components/obsidian/dialogs', () => ({ openDialog: vi.fn() }))
vi.mock('@/components/ExcalidrawMigrationModal.vue', () => ({ default: {} }))
vi.mock('@/canvas/opening', () => ({ openCanvas: vi.fn() }))

describe('explicit drawing re-migration', () => {
  it('creates fresh ink while preserving the previous canvas and bulk skip policy', async () => {
    const source = 'Sample.excalidraw'
    const oldCanvas = JSON.stringify({
      nodes: [],
      edges: [],
      abele: {
        excalidraw: { source },
        ink: [{ version: 1, id: 'old', tool: 'pen', color: '', size: 1.6, points: [0, 0, 0.5] }],
      },
    })
    const fake = buildFakeVault([
      { path: source, raw: pencilScene },
      { path: 'Sample.canvas', raw: oldCanvas },
    ])
    const app = fake as unknown as App
    const file = fake.vault.getAbstractFileByPath(source) as TFile
    const report = await migrateDrawing(app, file)
    expect(report.status).toBe('migrated')
    expect(report.target).toBe('Sample 2.canvas')
    expect(await fake.vault.read(file)).toBe(pencilScene)
    expect(await fake.vault.read(fake.vault.getAbstractFileByPath('Sample.canvas') as TFile)).toBe(
      oldCanvas
    )
    const output = fake.vault.getAbstractFileByPath('Sample 2.canvas') as TFile
    expect(JSON.parse(await fake.vault.read(output)).abele.ink[0].size).toBeGreaterThan(5)
    expect(openCanvas).toHaveBeenLastCalledWith(app, output)
    const batch = await migrateAll(new ObsidianExcalidrawVault(app))
    expect(batch).toMatchObject({ migrated: 0, skipped: 1, failed: 0 })
    expect(fake.vault.getFiles().filter((f) => f.extension === 'canvas')).toHaveLength(2)
  })
})
