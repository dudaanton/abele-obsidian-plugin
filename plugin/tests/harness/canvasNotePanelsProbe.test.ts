import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'

const source = readFileSync(resolve(__dirname, '../e2e/canvasNotePanels.e2e.test.ts'), 'utf8')
const menu = source.match(/const PANEL_MENU = `([\s\S]*?)`\n/)![1]
const template = source.match(/evalAsync<T>\(`([\s\S]*?)`\)/)![1]
const script = new Function('PATH', 'DIR', 'body', `return \`${template}\``)

it('uses the running view pane menu without importing the plugin API and returns JSON', async () => {
  const root = document.createElement('div')
  const more = document.createElement('button')
  more.className = 'view-action'
  more.setAttribute('aria-label', 'More options')
  root.append(more)
  document.body.append(root)
  const toggle = vi.fn()
  more.addEventListener('click', () => {
    const item = document.createElement('div')
    item.className = 'menu-item'
    const title = document.createElement('span')
    title.className = 'menu-item-title'
    title.textContent = 'Notes show header and footer'
    item.append(title)
    item.addEventListener('click', toggle)
    root.append(item)
  })
  const app = {
    workspace: {
      getLeavesOfType: () => [
        {
          view: {
            file: { path: 'sample/sample.canvas' },
            containerEl: root,
          },
        },
      ],
    },
  }
  const requireModule = vi.fn(() => {
    throw new Error('Plugin API is unavailable to the evaluator')
  })
  const run = (body: string) =>
    new Function(
      'app',
      'document',
      'require',
      `return ${script('sample/sample.canvas', 'sample', body)}`
    )(app, document, requireModule) as Promise<string>
  try {
    expect(JSON.parse(await run(menu))).toBe(true)
    expect(toggle).toHaveBeenCalledOnce()
    expect(requireModule).not.toHaveBeenCalled()
    for (const [body, expected] of [
      ['return true', true],
      ['return false', false],
      ['return 17', 17],
      ['', null],
    ])
      expect(JSON.parse(await run(String(body)))).toBe(expected)
  } finally {
    root.remove()
  }
})
