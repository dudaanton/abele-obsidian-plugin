import { expect, it } from 'vitest'
import { agentChoices, nodeProviders } from '@/node/providers'

it('keeps an available provider when optional configuration contains null defaults or new fields', () => {
  const providers = nodeProviders({
    providers: [
      {
        provider: 'codex',
        available: true,
        configuration: { model: null, profile: null, efforts: ['low', 'high'], future_field: true },
        capabilities: { sessions: { status: 'supported', evidence: 'reported by provider' } },
      },
    ],
  })
  expect(agentChoices(providers).find((p) => p.provider === 'codex')?.unavailable).toBe('')
})
