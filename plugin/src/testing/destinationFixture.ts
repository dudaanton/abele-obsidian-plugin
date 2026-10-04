import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { secrets } from '@/secrets/SecretStore'

export type DestinationFixtureKind = 'review' | 'new' | 'request' | 'layout'
const LOCAL_KEYS = ['abele-key-destinations-v1', 'abele-key-http-origins-v1']
const FAKE_SLOTS = [
  'sample-secure-key',
  'sample-home-key',
  'sample-request-key',
  'layout-voice-key',
  'layout-secure-key',
  'layout-local-key',
]
let pending: Promise<void> = Promise.resolve()

/** Development fixtures own their state until the actual dialog/approval completion settles. */
export function destinationFixture(
  kind: DestinationFixtureKind,
  show: () => Promise<void>
): Promise<void> {
  const work = pending.then(async () => {
    const config = AbeleConfig.getInstance()
    const app = GlobalStore.getInstance().app
    if (FAKE_SLOTS.some((id) => !!secrets().get(id)))
      throw new Error('Synthetic destination fixture slot is occupied')
    if (document.querySelector('.modal')) throw new Error('Another dialog is still open')
    const before = {
      ai: config.ai,
      firefly: config.fireflyBaseUrl,
      calendars: config.calendars,
      local: LOCAL_KEYS.map((key) => app.loadLocalStorage(key)),
    }
    const layout = kind === 'layout'
    try {
      config.ai = {
        ...before.ai,
        providers:
          kind === 'review' || layout
            ? [
                {
                  id: 'sample-secure',
                  name: 'Sample secure provider',
                  apiKeyId: 'sample-secure-key',
                  baseUrl: 'https://api.sample.example/v1',
                  models: [],
                },
                {
                  id: 'sample-home',
                  name: 'Sample home provider',
                  apiKeyId: 'sample-home-key',
                  baseUrl: 'http://192.168.8.20:1234/v1',
                  models: [],
                },
              ]
            : [],
        imageProviders: [],
        mcpServers: [],
        braveSearchApiKey: '',
        voice: {
          ...before.ai.voice,
          apiKeyId: 'layout-voice-key',
          endpoint: 'https://voice.sample.example',
        },
        secrets:
          kind === 'request'
            ? [{ name: 'Sample key', keyId: 'sample-request-key' }]
            : layout
              ? [
                  {
                    name: 'Sample secure key',
                    keyId: 'layout-secure-key',
                    allowedOrigins: ['https://keys.sample.example'],
                  },
                  {
                    name: 'Sample local key',
                    keyId: 'layout-local-key',
                    allowedOrigins: ['http://192.168.54.12:8123'],
                  },
                ]
              : [],
      }
      config.fireflyBaseUrl = ''
      config.calendars = { ...before.calendars, feeds: [] }
      app.saveLocalStorage(LOCAL_KEYS[0], { 'layout-voice-key': ['https://voice.sample.example'] })
      app.saveLocalStorage(LOCAL_KEYS[1], layout ? ['http://192.168.54.14:8125'] : [])
      await show()
    } finally {
      config.ai = before.ai
      config.fireflyBaseUrl = before.firefly
      config.calendars = before.calendars
      LOCAL_KEYS.forEach((key, index) => app.saveLocalStorage(key, before.local[index]))
    }
    if (
      config.ai !== before.ai ||
      config.fireflyBaseUrl !== before.firefly ||
      config.calendars !== before.calendars ||
      LOCAL_KEYS.some(
        (key, index) =>
          JSON.stringify(app.loadLocalStorage(key)) !== JSON.stringify(before.local[index])
      )
    )
      throw new Error('Destination fixture restoration did not complete')
  })
  pending = work.catch(() => {})
  return work
}
