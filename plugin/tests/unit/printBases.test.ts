import { expect, it } from 'vitest'
import type { QueryController } from 'obsidian'
import { PrintView } from '@/bases/PrintView'

it.each(['abele-calendar', 'abele-timeline', 'abele-find-and-replace'])(
  'prints every %s row without viewport clipping or controls',
  (type) => {
    const host = document.createElement('div')
    const view = new PrintView({} as QueryController, host, type)
    Object.assign(view, {
      config: { getOrder: () => ['file.name', 'note.value'], getDisplayName: (id: string) => id },
      data: {
        data: Array.from({ length: 125 }, (_, i) => ({
          getValue: (id: string) => (id === 'file.name' ? `Sample ${i}` : i),
        })),
      },
    })
    view.onDataUpdated()
    expect(host.querySelectorAll('tbody tr')).toHaveLength(125)
    expect(host.textContent).toContain('Sample 124')
    expect(host.querySelector('button, input')).toBeNull()
  }
)
