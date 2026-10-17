import { createServer, request as httpRequest } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
import { WAIT_PRELUDE } from './helpers/wait'

targets('desktop')
const available = isObsidianRunning() && hasTestApi()
const shots = shotDir('abele-proxy-timeout')
const paths: string[] = []
let baseUrl = ''
const frame = (delta: unknown, finish_reason: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`
const server = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }
  if (request.method !== 'POST' || request.url !== '/custom/v1/chat/completions') {
    response.writeHead(404)
    response.end()
    return
  }
  let body = ''
  request.on('data', (chunk) => {
    body += String(chunk)
  })
  request.on('end', () => {
    paths.push(request.url ?? '')
    const input = JSON.parse(body)
    if (input.stream !== true) throw Error('Expected a streaming chat request')
    const mode = input.model.replace('sample-', '')
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.flushHeaders()
    response.write(frame({ reasoning_content: 'Considering the sample request.' }))
    const keepalive =
      mode === 'comments'
        ? setInterval(() => response.write(': keep-alive\n\n'), 30_000)
        : undefined
    const finish = setTimeout(
      () => {
        if (mode === 'closed') response.end()
        else if (mode === 'length') response.end(frame({}, 'length') + 'data: [DONE]\n\n')
        else if (mode === 'error')
          response.end('data: {"error":{"message":"Sample upstream timeout"}}\n\ndata: [DONE]\n\n')
        else response.end(frame({ content: 'Sample answer.' }, 'stop') + 'data: [DONE]\n\n')
      },
      mode === 'closed' || mode === 'error' || mode === 'length' ? 1000 : 90_000
    )
    response.on('close', () => {
      clearInterval(keepalive)
      clearTimeout(finish)
    })
  })
})

describe.skipIf(!available)('custom OpenAI-compatible proxy timeouts in the running app', () => {
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/custom/v1`
  })
  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('ignores unrelated routes and methods before parsing or counting requests', async () => {
    const before = [...paths]
    const origin = new URL(baseUrl).origin
    for (const [method, path] of [
      ['GET', '/json/version'],
      ['POST', '/unrelated'],
      ['GET', '/custom/v1/chat/completions'],
    ]) {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(origin + path, { method }, (response) => {
          response.resume()
          response.on('end', () => resolve(response.statusCode))
          response.on('error', reject)
        })
        request.on('error', reject)
        request.end(method === 'POST' ? 'not json' : undefined)
      })
      expect(status).toBe(404)
    }
    expect(paths).toEqual(before)
  })

  type Mode = 'silent' | 'comments' | 'closed' | 'error' | 'length'
  interface Outcome {
    resolvedTimeout: number
    error: string | null
    elapsed: number
    roles: string[]
    content?: string
    streaming: boolean
    shot: string
  }
  const failing = (mode: Mode) => mode === 'closed' || mode === 'error' || mode === 'length'

  /**
   * One chat per mode, all sent at once against the same server, then each checked and pictured
   * in turn: the two 90-second hangs share their wait instead of taking three minutes in a row.
   */
  const run = async (modes: Mode[]): Promise<Record<string, Outcome>> => {
    const raw = await evalLong(
      String.raw`(async () => {
      ${WAIT_PRELUDE}
      const T = window.__abeleTest, config = T.AbeleConfig.getInstance(), chats = T.ChatService.getInstance(), registry = T.AgentRegistry.getInstance()
      const previous = config.ai, tab = chats.activeSession.value?.id, rightClosed = app.workspace.rightSplit.collapsed
      const modes = ${JSON.stringify(modes)}, failing = ${JSON.stringify(modes.filter(failing))}
      const runs = modes.map(mode => ({ mode, path: 'sample-proxy-' + mode + '.abchat', modelId: 'sample-' + mode }))
      try {
        for (const one of runs) if (app.vault.getAbstractFileByPath(one.path)) throw Error('Synthetic chat already exists')
        config.editSettings(() => { config.ai = {...previous, enabled: true, agents: [], defaultAgentId: '', requestTimeoutSeconds: 300,
          autoRetry: {attempts: 0, firstDelayMs: 1000}, providers: [{id: 'sample-proxy', name: 'Sample proxy', baseUrl: ${JSON.stringify(baseUrl)}, apiKeyId: '',
            models: runs.map(one => ({id: one.modelId, name: 'Sample reasoner', contextWindow: 100000, maxTokens: 100, supportsReasoning: true}))}]} })
        app.commands.executeCommandById('abele:show-ai-sidebar')
        for (const one of runs) {
          const agent = registry.create({name: 'Sample proxy agent', providerId: 'sample-proxy', modelId: one.modelId})
          registry.setDefault(agent.id)
          one.file = await app.vault.create(one.path, JSON.stringify({v: 2, k: 'meta', type: 'abele-chat', title: 'Sample proxy chat', agentId: agent.id}) + '\n')
          await chats.openChatFile(one.file)
          await chats.revealSidebar({focus: false})
          one.session = chats.getSessionByFile(one.path)
          if (!one.session) throw Error('Synthetic chat did not open')
          one.session.getTools = () => []
          for (const key of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded']) one.session.summarizer[key] = async () => undefined
          one.resolvedTimeout = one.session.activeModel().requestTimeoutSeconds
        }
        const start = Date.now()
        await Promise.all(runs.map(async one => {
          await one.session.sendMessage('Answer the sample request.')
          one.elapsed = Date.now() - start
        }))
        const fs = require('fs'); fs.mkdirSync(${JSON.stringify(shots)}, {recursive: true})
        const out = {}
        for (const one of runs) {
          const session = one.session, error = session.error.value, failure = failing.includes(one.mode)
          chats.switchTab(session.id)
          if (!await until(() => failure
            ? [...document.querySelectorAll('.abele-ai-chat__error')].some(el => el.textContent.includes(error) && el.getBoundingClientRect().width > 0)
            : [...document.querySelectorAll('.abele-ai-chat')].some(el => el.textContent.includes('Sample answer.') && el.getBoundingClientRect().width > 0), 5000)) throw Error('The turn outcome is not visible: ' + one.mode)
          const shot = ${JSON.stringify(shots + '/')} + one.mode + '.png'
          const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
          fs.writeFileSync(shot, image.toPNG())
          out[one.mode] = {resolvedTimeout: one.resolvedTimeout, error, elapsed: one.elapsed, roles: session.allMessages.value.map(m => m.role), content: session.allMessages.value.at(-1)?.content, streaming: session.isStreaming.value, shot}
        }
        return JSON.stringify(out)
      } finally {
        for (const { session, file, path } of runs) {
          if (session) { session.abort(); session.cancelAutoRetry(); await chats.deleteChat(session.id) }
          if (file && app.vault.getAbstractFileByPath(path)) await app.vault.delete(file)
        }
        config.editSettings(() => { config.ai = previous })
        registry.notifyConfigReloaded()
        await config.saveSettings()
        if (tab) chats.switchTab(tab)
        if (rightClosed) app.workspace.rightSplit.collapse()
      }
    })()`,
      150_000
    )
    const outcomes = JSON.parse(raw) as Record<string, Outcome>
    expect(paths.slice(-modes.length)).toEqual(modes.map(() => '/custom/v1/chat/completions'))
    return outcomes
  }

  const check = (mode: Mode, result: Outcome) => {
    expect(result.resolvedTimeout).toBe(300)
    expect(result.streaming).toBe(false)
    if (failing(mode)) {
      expect(result.error).toMatch(
        mode === 'closed'
          ? /ended before completion/
          : mode === 'length'
            ? /output token limit/
            : /Sample upstream timeout/
      )
      expect(result.roles).toEqual(['user'])
    } else {
      expect(result.error).toBeFalsy()
      expect(result.content).toBe('Sample answer.')
      expect(result.elapsed).toBeGreaterThanOrEqual(90_000)
    }
    console.info(JSON.stringify(result))
  }

  // Both long modes hold their stream for 90 s: they run together, each test reading its own.
  let held: ReturnType<typeof run> | undefined
  it.each(['silent', 'comments'] as const)(
    '%s reasoning is an answer or a visible error, never silence',
    async (mode) => {
      held ??= run(['silent', 'comments'])
      check(mode, (await held)[mode])
    },
    180_000
  )

  it.each(['closed', 'error', 'length'] as const)(
    '%s reasoning is an answer or a visible error, never silence',
    async (mode) => {
      check(mode, (await run([mode]))[mode])
    },
    150_000
  )
})
