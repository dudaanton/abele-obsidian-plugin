import { beforeEach, describe, expect, it } from 'vitest'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import {
  initializeDestinations,
  checkKeyDestination,
  acceptDestinations,
  pendingDestinations,
  keyDestinations,
  acceptIntroducedDestinations,
  checkRequestDestinations,
} from '@/secrets/destinations'

beforeEach(() => {
  const app = useVault([])
  app.secretStorage.setSecret('sample-calendar-key', 'sample-password')
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [
      {
        id: 'sample',
        name: 'Sample provider',
        apiKeyId: 'sample-key',
        baseUrl: 'https://api.sample.example/v1',
        models: [],
      },
    ],
  }
})
describe('device-local key destination approval', () => {
  it('seeds current settings once, then holds an externally changed address', () => {
    const config = AbeleConfig.getInstance()
    initializeDestinations(config)
    expect(() =>
      checkKeyDestination('sample-key', 'https://api.sample.example/v1/chat', config)
    ).not.toThrow()
    config.ai.providers[0].baseUrl = 'https://other.example/v1'
    initializeDestinations(config)
    expect(() =>
      checkKeyDestination('sample-key', 'https://other.example/v1/chat', config)
    ).toThrow(/confirm|review/i)
    expect(() =>
      checkKeyDestination('sample-key', 'https://api.sample.example/v1/chat', config)
    ).toThrow(/configured/i)
    const pending = pendingDestinations(config)
    expect(pending).toHaveLength(1)
    acceptDestinations(pending)
    expect(() =>
      checkKeyDestination('sample-key', 'https://other.example/v1/chat', config)
    ).not.toThrow()
  })
  it('a local change accepts only the destinations actually introduced by that edit', () => {
    const config = AbeleConfig.getInstance()
    initializeDestinations(config)
    config.ai.providers[0].baseUrl = 'https://arrived.example/v1'
    const before = keyDestinations(config)
    config.ai.providers.push({
      id: 'another',
      name: 'Another',
      apiKeyId: 'another-key',
      baseUrl: 'https://chosen.example/v1',
      models: [],
    })
    acceptIntroducedDestinations(before, keyDestinations(config))
    expect(() =>
      checkKeyDestination('another-key', 'https://chosen.example/v1', config)
    ).not.toThrow()
    expect(() => checkKeyDestination('sample-key', 'https://arrived.example/v1', config)).toThrow(
      /confirm|review/i
    )
  })
  it('holds every account when calendar feeds share one password slot', () => {
    const config = AbeleConfig.getInstance()
    config.calendars = {
      refreshMinutes: 30,
      feeds: ['one', 'two'].map((suffix) => ({
        id: suffix,
        name: `Sample ${suffix}`,
        color: 'blue' as const,
        enabled: true,
        source: 'caldav' as const,
        keyId: 'sample-calendar-key',
        server: 'https://calendar.sample.example',
        username: `sample-${suffix}`,
        calendarUrl: '',
      })),
    }
    initializeDestinations(config)
    config.calendars.feeds[1].server = 'https://changed.sample.example'
    expect(() =>
      checkRequestDestinations(
        {
          url: 'https://changed.sample.example/path',
          headers: { Authorization: `Basic ${btoa('sample-two:sample-password')}` },
        },
        config
      )
    ).toThrow(/confirm|review/i)
  })
  it('rejects credentials in URLs and non-HTTP protocols', () => {
    const config = AbeleConfig.getInstance()
    initializeDestinations(config)
    expect(() =>
      checkKeyDestination('sample-key', 'https://user:pass@api.sample.example/v1', config)
    ).toThrow()
    expect(() => checkKeyDestination('sample-key', 'file:///sample', config)).toThrow()
  })
})
