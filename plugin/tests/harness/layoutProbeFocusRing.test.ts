import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { probePrelude } from '../e2e/helpers/layoutProbe'

/** Execute the same serialized measurement used in the live sync dialogs. */
function clipped(boxShadow: string, outlineWidth = '0px', outlineOffset = '0px'): string[] {
  const doc = {
    documentElement: {},
    defaultView: {
      getComputedStyle: (el: { style: unknown }) => el.style,
    },
  }
  const body = {
    className: 'sample-body',
    ownerDocument: doc,
    parentElement: doc.documentElement,
    clientLeft: 0,
    clientWidth: 100,
    style: { overflowX: 'auto', overflowY: 'auto' },
    getBoundingClientRect: () => ({ left: 0, right: 100 }),
  }
  const field = {
    ownerDocument: doc,
    parentElement: body,
    style: { boxShadow, outlineStyle: 'solid', outlineWidth, outlineOffset },
    getBoundingClientRect: () => ({ left: 4, right: 24 }),
  }
  return Array.from(
    runInNewContext(`${probePrelude('/sample-shots')}\nringClipped(field)`, {
      field,
      require: (name: string) => {
        if (name === 'fs') return { mkdirSync: () => undefined }
        if (name === '@electron/remote') return { getCurrentWindow: () => ({}) }
        throw new Error(`Unexpected probe dependency: ${name}`)
      },
    }) as string[]
  )
}

describe('serialized sync layout focus-ring measurement', () => {
  it('does not report an inward checkbox shadow as clipped outer paint', () => {
    expect(clipped('rgba(0, 0, 0, 0.07) 0px 4px 10px 0px inset')).toEqual([])
  })

  it('still reports a real outward ring crossing the body edge', () => {
    expect(clipped('rgb(100, 100, 100) 0px 0px 0px 6px')).toEqual(['sample-body 2px'])
  })

  it('measures each outward layer independently of an inward one', () => {
    const inset = 'rgba(0, 0, 0, 0.07) 0px 4px 10px 0px inset'
    expect(clipped(`${inset}, rgb(100, 100, 100) 0px 0px 0px 3px`)).toEqual([])
    expect(clipped(`${inset}, rgb(100, 100, 100) 0px 0px 0px 6px`)).toEqual(['sample-body 2px'])
  })

  it('keeps outline width and offset in the clipping measurement', () => {
    expect(clipped('rgb(100, 100, 100) 0px 4px 10px 0px inset', '2px', '4px')).toEqual([
      'sample-body 2px',
    ])
  })
})
