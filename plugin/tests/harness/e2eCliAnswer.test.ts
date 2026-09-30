/**
 * What the e2e tier takes as the app's answer to an `eval`, out of all the CLI printed for it.
 */
import { describe, it, expect } from 'vitest'
import { answerOf } from '../e2e/helpers/obsidianCli'

describe('the answer to an eval', () => {
  it('is what follows the arrow', () => {
    expect(answerOf('=> {"ok":true}')).toBe('{"ok":true}')
  })

  it('comes after the console messages printed while it ran', () => {
    expect(answerOf('[warn] a page could not be drawn {}\n=> ok')).toBe('ok')
  })

  it('is not an arrow inside a console message', () => {
    const logged =
      'Received CLI command ["eval","code=(async()=>{const w=1;return w})()"]\n=> {\n  "a": 1\n}'
    expect(answerOf(logged)).toBe('{\n  "a": 1\n}')
  })

  it('is the whole output when there is no answer line', () => {
    expect(answerOf('Error: no vault')).toBe('Error: no vault')
  })
})
