import { describe, it, expect } from 'vitest'
import type { TFile } from 'obsidian'
import { createEditFileTool } from '@/ai/tools/EditFileTool'
import { useVault } from '../helpers/testEnv'

describe('edit', () => {
  it('writes the replacement as given, dollar signs included', async () => {
    const app = useVault([{ path: 'A.md', content: 'price: TBD' }])
    await createEditFileTool({ skipScope: true }).execute('1', {
      path: 'A.md',
      old_string: 'TBD',
      new_string: "$& and $' and $1",
    })
    expect(await app.vault.read(app.vault.getAbstractFileByPath('A.md') as TFile)).toBe(
      "price: $& and $' and $1"
    )
  })
})
