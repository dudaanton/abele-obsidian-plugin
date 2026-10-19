import { describe, expect, it } from 'vitest'
import { keyboardVar, KEYBOARD_VAR } from '@/modal/keyboard'

function keyboardDocument(view: unknown, inline = ''): Document {
  return {
    documentElement: { style: { getPropertyValue: () => inline } },
    defaultView: view,
  } as unknown as Document
}

describe('keyboard height', () => {
  it.each([null, {}, { getComputedStyle: 1 }])(
    'returns zero when the window cannot compute styles (%j)',
    (view) => {
      expect(keyboardVar(keyboardDocument(view))).toBe(0)
    }
  )

  it('reads the inline height before asking the window for styles', () => {
    expect(keyboardVar(keyboardDocument({}, '240px'))).toBe(240)
  })

  it('reads the computed height in the document’s own window', () => {
    const view = {
      getComputedStyle(root: Element) {
        expect(this).toBe(view)
        expect(root).toBe(doc.documentElement)
        return { getPropertyValue: (key: string) => (key === KEYBOARD_VAR ? '320px' : '') }
      },
    }
    const doc = keyboardDocument(view)
    expect(keyboardVar(doc)).toBe(320)
  })
})
