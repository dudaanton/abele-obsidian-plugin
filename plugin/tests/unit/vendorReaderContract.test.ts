import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const view = 'src/vendor/foliate-js/view.js'

describe('the vendored reader surface', () => {
  it('does not load the unused speech engine alongside the plugin narrator', () => {
    expect(readFileSync(view, 'utf8')).not.toMatch(/\binitTTS\b|\.tts\b|['"]\.\/tts\.js['"]/)
    expect(existsSync('src/vendor/foliate-js/tts.js')).toBe(false)
  })
})
