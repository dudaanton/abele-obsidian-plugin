import { expect, it, vi } from 'vitest'
import { buildScriptContext } from '@/scripting/ScriptContext'
import { request } from '@/helpers/http'
import { useVault } from '../helpers/testEnv'

vi.mock('@/helpers/http', () => ({ request: vi.fn() }))

it.each(['content-type', 'Content-Type', 'CONTENT-TYPE'])(
  'decodes JSON from the %s response header',
  async (name) => {
    useVault([])
    vi.mocked(request).mockResolvedValue({
      status: 200,
      headers: { [name]: 'application/json; charset=utf-8' },
      text: '{"sample":true}',
    } as never)
    const script = buildScriptContext({
      params: {},
      signal: new AbortController().signal,
      logs: [],
      formHandler: async () => null,
    })
    const response = await script.fetch('https://sample.invalid/data')
    expect(response.data).toEqual({ sample: true })
  }
)
