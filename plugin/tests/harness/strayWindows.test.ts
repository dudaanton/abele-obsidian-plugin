import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'

function closeStrays(windows: unknown[]) {
  const tree = ts.createSourceFile(
    'obsidianCli',
    readFileSync('tests/e2e/helpers/obsidianCli.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const declaration = tree.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'closeStrayWindows'
  )!
  const code = ts.transpile(declaration.getText(tree).replace('export ', ''))
  const remote = {
    getCurrentWindow: () => ({ id: 1 }),
    BrowserWindow: { getAllWindows: () => windows },
  }
  const app = {
    setting: { close() {} },
    vault: { getName: () => 'sample-vault' },
    workspace: { floatingSplit: { children: [] } },
  }
  const evaluate = (probe: string) =>
    new Function('require', 'app', `return ${probe}`)(() => remote, app)
  return new Function('onPhone', 'evalJsonIdempotent', `${code};return closeStrayWindows()`)(
    () => false,
    evaluate
  )
}

it('continues cleanup when a popout disappears between enumeration and reading its title', () => {
  const disappearing = {
    id: 2,
    isDestroyed: vi.fn().mockReturnValueOnce(false).mockReturnValue(true),
    getTitle: () => {
      throw Error('Object has been destroyed')
    },
  }
  const destroy = vi.fn()
  const owned = {
    id: 3,
    isDestroyed: () => false,
    getTitle: () => 'Settings - sample-vault - Obsidian 1.x',
    destroy,
  }
  expect(closeStrays([disappearing, owned])).toBe(1)
  expect(destroy).toHaveBeenCalledOnce()
})

it('preserves title errors on a live window', () => {
  expect(() =>
    closeStrays([
      {
        id: 2,
        isDestroyed: () => false,
        getTitle: () => {
          throw Error('title unavailable')
        },
      },
    ])
  ).toThrow('title unavailable')
})
