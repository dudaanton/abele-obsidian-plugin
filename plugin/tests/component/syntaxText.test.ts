/** A file a tool wrote, shown in the chat: coloured like a code block, copied as written. */
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SyntaxText from '@/components/SyntaxText.vue'

describe('SyntaxText', () => {
  it("colours code with Obsidian's token classes and keeps its text exact", async () => {
    const text = '#!/bin/bash\nset -e\necho "done"\n'
    const view = mount({
      components: { SyntaxText },
      template: '<pre><code><SyntaxText :text="text" path="bin/deploy" /></code></pre>',
      data: () => ({ text }),
    })
    await flushPromises()
    const spans = view.findAll('.token').map((s) => [s.text(), s.classes().join(' ')])
    expect(spans).toEqual(
      expect.arrayContaining([
        ['set', 'token keyword'],
        ['"done"', 'token string'],
      ])
    )
    expect(view.get('code').element.textContent).toBe(text)
  })

  it('leaves text it has no grammar for plain', async () => {
    const view = mount(SyntaxText, { props: { text: 'a = 1', path: 'notes/sample.md' } })
    await flushPromises()
    expect(view.findAll('.token')).toHaveLength(0)
    expect(view.text()).toBe('a = 1')
  })
})
