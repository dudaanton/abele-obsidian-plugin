import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileString } from 'sass-embedded'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import FileView from '@/components/nodeWork/FileView.vue'

vi.mock('@/github/codeViewer', () => ({ mountCode: vi.fn(() => ({ destroy: vi.fn() })) }))

const source = readFileSync(join(__dirname, '../../src/components/nodeWork/FileView.vue'), 'utf8')
const style = document.createElement('style')
style.textContent = compileString(source.split('<style lang="scss">')[1].split('</style>')[0]).css
document.head.append(style)
afterAll(() => style.remove())
afterEach(() => {
  document.body.replaceChildren()
})

it.each(['file', 'diff'] as const)(
  'keeps a long %s card in a bounded scroll viewport',
  async (mode) => {
    const text = Array.from({ length: 400 }, (_, i) => `const row${i} = ${i}`).join('\n')
    const view = mount(FileView, {
      attachTo: document.body,
      props: {
        path: 'sample.ts',
        text,
        mode,
        change: {
          path: 'sample.ts',
          kind: 'modified',
          before: '',
          after: text,
          added: 400,
          removed: 0,
        },
      },
    })
    try {
      await flushPromises()
      const root = view.element as HTMLElement
      const card = view.get('.abele-file-view__card').element as HTMLElement
      // The DOM shim preserves shorthands; it does not expand overflow into overflowY.
      expect(getComputedStyle(root).overflow).toBe('auto')
      expect(getComputedStyle(root).minHeight).toBe('0')
      expect(getComputedStyle(root).maxHeight).toBe('100%')
      expect(getComputedStyle(card).flexShrink).toBe('0')
    } finally {
      view.unmount()
    }
  }
)
