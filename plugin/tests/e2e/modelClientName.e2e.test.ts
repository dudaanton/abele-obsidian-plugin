import { describe, expect, it } from 'vitest'
import { activeVaultName, vaultCli, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'

targets('desktop')

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('model connection identity on the native wire', () => {
  it('keeps the name across a redirect without carrying Authorization to another origin', () => {
    const result = vaultCli(activeVaultName()).evalAwait<{
      outcome: string
      ua: string
      authorization: string
    }>(`(async () => {
      const http = require('node:http')
      let ua = '', authorization = '', outcome = ''
      const sink = http.createServer((request, response) => {
        ua = request.headers['user-agent'] || ''
        authorization = request.headers.authorization || ''
        request.resume()
        request.on('end', () => {
          response.setHeader('Content-Type', 'text/event-stream')
          response.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Sample answer' }, finish_reason: 'stop' }] }) + '\\n\\ndata: [DONE]\\n\\n')
        })
      })
      await new Promise(resolve => sink.listen(0, '127.0.0.1', resolve))
      const source = http.createServer((request, response) => {
        request.resume()
        response.writeHead(307, { Location: 'http://127.0.0.1:' + sink.address().port + '/chat/completions' })
        response.end()
      })
      await new Promise(resolve => source.listen(0, '127.0.0.1', resolve))
      try {
        const model = { id: 'sample-model', name: 'Sample', baseUrl: 'http://127.0.0.1:' + source.address().port, apiKey: 'sample-redirect-key', clientName: 'SampleClient/1.0', contextWindow: 1000, maxTokens: 100, supportsReasoning: false }
        for await (const event of new window.__abeleTest.OpenAIClient().stream(model, '', [], [])) {
          if (event.type === 'done' || event.type === 'error') outcome = event.type
        }
        return { outcome, ua, authorization }
      } finally {
        for (const server of [source, sink]) {
          server.closeAllConnections()
          await new Promise(resolve => server.close(resolve))
        }
      }
    })()`)
    expect(result).toEqual({ outcome: 'done', ua: 'SampleClient/1.0', authorization: '' })
  })

  it('keeps Stop and idle timeouts working with a named native stream', () => {
    const result = vaultCli(activeVaultName()).evalAwait<{
      stops: string[]
      timeout: string
    }>(`(async () => {
      const api = window.__abeleTest
      const server = require('node:http').createServer((request, response) => {
        request.resume()
        request.on('end', () => {
          if (request.url.startsWith('/idle')) {
            response.setHeader('Content-Type', 'text/event-stream')
            response.flushHeaders()
          }
        })
      })
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      const base = 'http://127.0.0.1:' + server.address().port
      const model = { id: 'sample-model', name: 'Sample', baseUrl: base, apiKey: '', clientName: 'SampleClient/1.0', contextWindow: 1000, maxTokens: 100, supportsReasoning: false, requestTimeoutSeconds: 1 }
      const stops = []
      let timeout = ''
      try {
        for (const path of ['/connecting', '/idle']) {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 100)
          try {
            for await (const event of new api.OpenAIClient().stream({ ...model, baseUrl: base + path }, '', [], [], { signal: controller.signal })) {
              if (event.message) stops.push(event.message.stopReason)
            }
          } finally { clearTimeout(timer) }
        }
        for await (const event of new api.OpenAIClient().stream({ ...model, baseUrl: base + '/idle' }, '', [], [])) {
          if (event.type === 'error') timeout = event.error
        }
        return { stops, timeout }
      } finally {
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
      }
    })()`)
    expect(result.stops).toEqual(['aborted', 'aborted'])
    expect(result.timeout).toMatch(/timed out after 1s/)
  })

  it('sends the client name for streaming, model listing and transcription while keeping unnamed requests unchanged', () => {
    const result = vaultCli(activeVaultName()).evalAwait<{
      seen: { path: string; ua: string }[]
      streamedBeforeEnd: boolean
      outcomes: string[]
      models: string[]
      transcription: string
    }>(`(async () => {
      const api = window.__abeleTest
      const seen = [], outcomes = []
      let ended = false, streamedBeforeEnd = false
      const frame = (text, stop = null) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: stop }] }) + '\\n\\n'
      const server = require('node:http').createServer((request, response) => {
        response.setHeader('Access-Control-Allow-Origin', '*')
        response.setHeader('Access-Control-Allow-Headers', '*')
        if (request.method === 'OPTIONS') { response.end(); return }
        seen.push({ path: request.url, ua: request.headers['user-agent'] })
        request.resume()
        request.on('end', () => {
          if (request.url.endsWith('/models')) {
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ data: [{ id: 'sample-model' }] }))
          } else if (request.url === '/voice') {
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ choices: [{ message: { content: 'Sample words' } }] }))
          } else {
            response.setHeader('Content-Type', 'text/event-stream')
            response.write(frame('Sample answer'))
            setTimeout(() => {
              ended = true
              response.end(frame('', 'stop') + 'data: [DONE]\\n\\n')
            }, 500)
          }
        })
      })
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      const base = 'http://127.0.0.1:' + server.address().port
      try {
        const client = new api.OpenAIClient()
        for (const clientName of ['SampleClient/1.0', '']) {
          ended = false
          const model = { id: 'sample-model', name: 'Sample', baseUrl: base + (clientName ? '/named' : '/default'), apiKey: '', clientName, contextWindow: 1000, maxTokens: 100, supportsReasoning: false }
          for await (const event of client.stream(model, '', [], [])) {
            if (event.type === 'text_delta' && clientName) streamedBeforeEnd = !ended
            if (event.type === 'done' || event.type === 'error') outcomes.push(event.type)
          }
        }
        const models = await client.fetchModels(base + '/named', '', 'SampleClient/1.0')
        await client.fetchModels(base + '/default', '')
        const transcription = await api.transcribe(new Uint8Array([0]), { endpoint: base + '/voice', apiKey: 'sample-voice-key', modelId: 'sample-model', clientName: 'VoiceClient/1.0' })
        return { seen, outcomes, streamedBeforeEnd, models: models.map(model => model.id), transcription }
      } finally {
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
      }
    })()`)
    expect(result.outcomes).toEqual(['done', 'done'])
    expect(result.streamedBeforeEnd).toBe(true)
    expect(result.models).toEqual(['sample-model'])
    expect(result.transcription).toBe('Sample words')
    expect(result.seen.filter((row) => row.path.startsWith('/named')).map((row) => row.ua)).toEqual(
      ['SampleClient/1.0', 'SampleClient/1.0']
    )
    expect(
      result.seen
        .filter((row) => row.path.startsWith('/default'))
        .every((row) => !!row.ua && row.ua !== 'SampleClient/1.0')
    ).toBe(true)
    expect(result.seen.find((row) => row.path === '/voice')?.ua).toBe('VoiceClient/1.0')
  })
})
