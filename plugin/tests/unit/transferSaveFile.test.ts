/**
 * Where "Save a file" puts a transfer: never where a sync carries it. A transfer holding a
 * code-locked key, or a live device token, synced to every device and kept in the server's
 * history would be the lock lying beside what it guards.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { App } from 'obsidian'
import { HIDDEN_FOLDER, saveTransfer, type SaveRoads } from '@/transfer/saveFile'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const NAME = 'Abele transfer 2026-09-27 10-00-00.txt'
const TEXT = 'ABL1:ABCD:1/1:AAAA:X'

let app: FakeApp
const none: SaveRoads = { pickPath: null, writeFile: null, share: null }

beforeEach(() => {
  app = useVault([])
})

const save = (roads: SaveRoads) => saveTransfer(app as unknown as App, TEXT, NAME, roads)

const inVault = () => app.vault.getFiles().map((file) => file.path)

describe('saving a transfer as a file', () => {
  it('asks the desktop where to put it, and writes it there rather than into the vault', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined)
    const pickPath = vi.fn().mockResolvedValue('/Users/me/Downloads/t.txt')

    const saved = await save({ ...none, pickPath, writeFile })

    expect(pickPath).toHaveBeenCalledWith(NAME)
    expect(writeFile).toHaveBeenCalledWith('/Users/me/Downloads/t.txt', TEXT)
    expect(saved).toEqual({ road: 'disk', path: '/Users/me/Downloads/t.txt' })
    expect(inVault()).toEqual([])
  })

  it('writes nothing when the dialog is closed', async () => {
    const writeFile = vi.fn()
    const saved = await save({ ...none, pickPath: async () => null, writeFile })

    expect(saved).toEqual({ road: 'cancelled' })
    expect(writeFile).not.toHaveBeenCalled()
    expect(await app.vault.adapter.exists(HIDDEN_FOLDER)).toBe(false)
  })

  it('hands it to the share sheet where there is no dialog', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const saved = await save({ ...none, share })

    const file = share.mock.calls[0][0] as File
    expect(file.name).toBe(NAME)
    await expect(file.text()).resolves.toBe(TEXT)
    expect(saved).toEqual({ road: 'shared' })
    expect(await app.vault.adapter.exists(HIDDEN_FOLDER)).toBe(false)
  })

  it('takes a sheet the person closed as cancelled', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError'))
    expect(await save({ ...none, share })).toEqual({ road: 'cancelled' })
    expect(await app.vault.adapter.exists(HIDDEN_FOLDER)).toBe(false)
  })

  it('falls back to a hidden folder of the vault, which no sync carries', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError'))
    const saved = await save({ ...none, share })

    const path = `${HIDDEN_FOLDER}/${NAME}`
    expect(saved).toEqual({ road: 'vault', path })
    expect(HIDDEN_FOLDER.startsWith('.')).toBe(true)
    expect(inVault()).toEqual([])
    const bytes = await app.vault.adapter.readBinary(path)
    expect(new TextDecoder().decode(bytes)).toBe(TEXT)
  })

  it('uses the hidden folder again when it is already there', async () => {
    await save(none)
    const saved = await save(none)
    expect(saved).toEqual({ road: 'vault', path: `${HIDDEN_FOLDER}/${NAME}` })
  })
})
