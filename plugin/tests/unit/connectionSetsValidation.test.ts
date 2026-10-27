import { expect, it, vi } from 'vitest'
import { ConnectionSets } from '@/sync/connectionSets'

it('validates progress reads without compiling a parser in the renderer task', () => {
  let raw: unknown = {
    version: 1,
    connections: [
      {
        id: 'sample',
        label: '',
        items: [
          {
            id: 'folder',
            scopeId: 'scope',
            kind: 'folder',
            path: 'Notes',
            detached: false,
            paused: false,
          },
        ],
      },
    ],
  }
  const sets = new ConnectionSets({
    loadLocalStorage: () => raw,
    saveLocalStorage: (_key, value) => {
      raw = value
    },
  })
  const compile = vi.spyOn(globalThis, 'Function').mockImplementation(function () {
    throw new Error('synchronous parser compilation')
  })
  try {
    expect(sets.all()).toHaveLength(1)
    sets.pause('sample', 'folder', true)
    expect(sets.get('sample')?.items[0].paused).toBe(true)
    raw = { version: 2, connections: [] }
    expect(() => sets.all()).toThrow(/recovery/)
    expect(compile).not.toHaveBeenCalled()
  } finally {
    compile.mockRestore()
  }
})
