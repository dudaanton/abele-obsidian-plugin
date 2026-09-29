/**
 * What a reply still being written holds back: a block that draws something, until it is
 * complete. Drawn from half its source, a chart fails with a parse error and flips between that
 * and a chart with every token.
 */
import { describe, it, expect } from 'vitest'
import { holdBackUnfinished } from '@/helpers/unfinishedBlock'

const CHART_START = 'Here are the numbers.\n\n```abele-chart\ntype: bar\nseries:\n  - name: Rows'

describe('a fenced block that draws something', () => {
  it('is held back while its fence is open', () => {
    expect(holdBackUnfinished(CHART_START)).toEqual({
      text: 'Here are the numbers.',
      pending: 'chart',
    })
  })

  it('is let through once its fence is closed', () => {
    const done = CHART_START + '\n    data: [1, 2]\n```'
    expect(holdBackUnfinished(done)).toEqual({ text: done, pending: null })
    expect(holdBackUnfinished(done + '\n\nAnd after it.').pending).toBeNull()
  })

  it('knows a diagram and a map as well', () => {
    expect(holdBackUnfinished('A.\n\n```mermaid\ngraph TD\n  A -->').pending).toBe('diagram')
    expect(holdBackUnfinished('A.\n\n```abele-map\ncenter: [1, 2]').pending).toBe('map')
  })

  it('is held back while its language is still being typed on the last line', () => {
    expect(holdBackUnfinished('A.\n\n```abele-ch')).toEqual({ text: 'A.', pending: 'chart' })
    expect(holdBackUnfinished('A.\n\n```')).toEqual({ text: 'A.\n\n```', pending: null })
  })

  it('counts a closing fence only when it matches the opening one', () => {
    const tilde = 'A.\n\n~~~~abele-chart\nseries: []\n```\n~~~'
    expect(holdBackUnfinished(tilde).pending).toBe('chart')
    expect(holdBackUnfinished(tilde + '~').pending).toBeNull()
  })

  it('leaves an unfinished block of ordinary code alone: code shows as it is written', () => {
    const code = 'A.\n\n```ts\nconst a = 1'
    expect(holdBackUnfinished(code)).toEqual({ text: code, pending: null })
  })

  it('does not mistake a chart quoted inside a code block for one', () => {
    const quoted = '````md\n```abele-chart\nseries: []\n````\n\nDone.'
    expect(holdBackUnfinished(quoted).pending).toBeNull()
  })

  it('finds one inside a quote', () => {
    expect(holdBackUnfinished('> A.\n>\n> ```abele-chart\n> type: bar').pending).toBe('chart')
  })
})

describe('a gallery', () => {
  const gallery = 'Pictures.\n\n::abele-gallery::\n![[sample-one.png]]\n![[sample-two.png]]'

  it('is held back while it is the last thing in the reply: more pictures may come', () => {
    expect(holdBackUnfinished(gallery)).toEqual({ text: 'Pictures.', pending: 'gallery' })
    expect(holdBackUnfinished(gallery + '\n\n').pending).toBe('gallery')
  })

  it('is let through once something else follows it', () => {
    expect(holdBackUnfinished(gallery + '\n\nThat is all.').pending).toBeNull()
  })
})

it('leaves a reply with nothing to hold back as it is', () => {
  const text = 'Plain words.\n\n- a list\n- of things'
  expect(holdBackUnfinished(text)).toEqual({ text, pending: null })
})
