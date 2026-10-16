import { describe, expect, it, vi } from 'vitest'
import type { App, TFile } from 'obsidian'
import { ObsidianExcalidrawVault } from '@/canvas/excalidrawAdapter'

vi.mock('@/components/obsidian/dialogs', () => ({ openDialog: vi.fn() }))
vi.mock('@/components/ExcalidrawMigrationModal.vue', () => ({ default: {} }))
vi.mock('@/canvas/opening', () => ({ openCanvas: vi.fn() }))

describe('extracted picture ownership', () => {
  it('deletes the created file through the write facade', async () => {
    const file = { path: 'Sample picture.png' } as TFile
    const app = { vault: { getAbstractFileByPath: () => file } } as unknown as App
    const remove = vi.fn().mockResolvedValue(undefined)
    const writes = {
      vault: { createBinary: vi.fn().mockResolvedValue(file) },
      fileManager: { trashFile: remove },
    }
    const vault = new ObsidianExcalidrawVault(app, writes as unknown as App)
    const cleanup = await vault.createBinary(file.path, new ArrayBuffer(1))
    expect(remove).not.toHaveBeenCalled()
    await cleanup()
    expect(remove).toHaveBeenCalledExactlyOnceWith(file)
  })

  it('does not delete a replacement at the same path', async () => {
    const file = { path: 'Sample picture.png' } as TFile
    let current: TFile | null = file
    const remove = vi.fn().mockResolvedValue(undefined)
    const app = {
      vault: {
        getAbstractFileByPath: () => current,
        createBinary: vi.fn().mockResolvedValue(file),
      },
      fileManager: { trashFile: remove },
    } as unknown as App
    const cleanup = await new ObsidianExcalidrawVault(app).createBinary(
      file.path,
      new ArrayBuffer(1)
    )
    current = { path: file.path } as TFile
    await cleanup()
    expect(remove).not.toHaveBeenCalled()
    current = null
    await cleanup()
    expect(remove).not.toHaveBeenCalled()
  })
})
