import { describe, expect, it } from 'vitest'
import { normalizeMapBlock } from '@/helpers/mapConfig'
import { styleFor } from '@/helpers/mapRender'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'

describe('note map styles', () => {
  it.each([
    'http://tiles.example/style.json',
    'https://localhost/style.json',
    'https://127.0.0.1/style.json',
    'https://2130706433/style.json',
    'https://[::1]/style.json',
    'https://[::ffff:7f00:1]/style.json',
    'https://192.168.1.2/style.json',
    'https://10.0.0.2/style.json',
    'https://[fd00::1]/style.json',
    'https://router.local/style.json',
    'https://sample:password@tiles.example/style.json',
  ])('refuses %s in a note', (style) => {
    expect(normalizeMapBlock({ center: [10, 20], style })).toHaveProperty('error')
  })
  it.each(['https://[::ffff:808:808]/style.json', 'https://[2002:808:808::]/style.json'])(
    'keeps public IPv4-embedded HTTPS styles: %s',
    (style) => {
      expect(normalizeMapBlock({ center: [10, 20], style })).not.toHaveProperty('error')
    }
  )
  it('accepts a public HTTPS style', () => {
    expect(
      normalizeMapBlock({ center: [10, 20], style: 'https://tiles.example/style.json' })
    ).toHaveProperty('style', 'https://tiles.example/style.json')
  })
  it('leaves a locally configured HTTP style available', () => {
    useVault([])
    AbeleConfig.getInstance().mapStyleUrl = 'http://router.local/style.json'
    const config = normalizeMapBlock({ center: [10, 20] })
    if ('error' in config) throw new Error(config.error)
    expect(styleFor(config, document.createElement('div'))).toBe('http://router.local/style.json')
  })
})
