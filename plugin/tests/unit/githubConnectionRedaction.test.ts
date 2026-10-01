import { describe, expect, it } from 'vitest'
import { isHidden, redact } from '@/ai/tools/settingsPaths'

describe('connection credential references', () => {
  it('hides main and bound notification keychain slots from agent settings output', () => {
    const settings = {
      github: {
        connections: [{ id: 'sample', name: 'Sample', keyId: 'main-slot' }],
        notifications: {
          keyId: '',
          boundKeyId: 'classic-slot',
          boundServer: 'https://git.example.test',
        },
      },
    }
    expect(JSON.stringify(redact(settings))).not.toContain('main-slot')
    expect(JSON.stringify(redact(settings))).not.toContain('classic-slot')
    expect(isHidden('github.notifications.boundKeyId')).toBe(true)
  })
})
