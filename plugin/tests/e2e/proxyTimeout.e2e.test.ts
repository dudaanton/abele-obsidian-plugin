import { createServer } from 'node:http'
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

  it.each(['silent', 'comments', 'closed', 'error', 'length'] as const)(
    '%s reasoning is an answer or a visible error, never silence',
    async (mode) => {
      const raw = await evalLong(
        String.raw`(async () => {
      ${WAIT_PRELUDE}
      const T = window.__abeleTest, config = T.AbeleConfig.getInstance(), chats = T.ChatService.getInstance(), registry = T.AgentRegistry.getInstance()
      const previous = config.ai, tab = chats.activeSession.value?.id, rightClosed = app.workspace.rightSplit.collapsed
      const path = 'sample-proxy-${mode}.abchat', modelId = 'sample-${mode}'
      let file, session
      try {
        if (app.vault.getAbstractFileByPath(path)) throw Error('Synthetic chat already exists')
        config.editSettings(() => { config.ai = {...previous, enabled: true, agents: [], defaultAgentId: '', requestTimeoutSeconds: 300,
          autoRetry: {attempts: 0, firstDelayMs: 1000}, providers: [{id: 'sample-proxy', name: 'Sample proxy', baseUrl: ${JSON.stringify(baseUrl)}, apiKeyId: '',
            models: [{id: modelId, name: 'Sample reasoner', contextWindow: 100000, maxTokens: 100, supportsReasoning: true}]}]} })
        const agent = registry.create({name: 'Sample proxy agent', providerId: 'sample-proxy', modelId})
        registry.setDefault(agent.id)
        file = await app.vault.create(path, JSON.stringify({v: 2, k: 'meta', type: 'abele-chat', title: 'Sample proxy chat', agentId: agent.id}) + '\n')
        app.commands.executeCommandById('abele:show-ai-sidebar')
        await chats.openChatFile(file)
        session = chats.getSessionByFile(path)
        if (!session) throw Error('Synthetic chat did not open')
        session.getTools = () => []
        for (const key of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded']) session.summarizer[key] = async () => undefined
        const resolvedTimeout = session.activeModel().requestTimeoutSeconds
        const start = Date.now()
        await session.sendMessage('Answer the sample request.')
        const error = session.error.value
        const failure = ${JSON.stringify(mode === 'closed' || mode === 'error' || mode === 'length')}
        if (!await until(() => failure
          ? [...document.querySelectorAll('.abele-ai-chat__error')].some(el => el.textContent.includes(error) && el.getBoundingClientRect().width > 0)
          : [...document.querySelectorAll('.abele-ai-chat')].some(el => el.textContent.includes('Sample answer.')), 5000)) throw Error('The turn outcome is not visible')
        const shot = ${JSON.stringify(shots + '/' + mode + '.png')}
        const fs = require('fs'); fs.mkdirSync(${JSON.stringify(shots)}, {recursive: true})
        const image = await require('@electron/remote').getCurrentWindow().webContents.capturePage()
        fs.writeFileSync(shot, image.toPNG())
        return JSON.stringify({resolvedTimeout, error, elapsed: Date.now() - start, roles: session.allMessages.value.map(m => m.role), content: session.allMessages.value.at(-1)?.content, streaming: session.isStreaming.value, shot})
      } finally {
        if (session) { session.abort(); session.cancelAutoRetry(); await chats.deleteChat(session.id) }
        if (file && app.vault.getAbstractFileByPath(path)) await app.vault.delete(file)
        config.editSettings(() => { config.ai = previous })
        registry.notifyConfigReloaded()
        await config.saveSettings()
        if (tab) chats.switchTab(tab)
        if (rightClosed) app.workspace.rightSplit.collapse()
      }
    })()`,
        120_000
      )
      const result = JSON.parse(raw)
      expect(result.resolvedTimeout).toBe(300)
      expect(result.streaming).toBe(false)
      expect(paths.at(-1)).toBe('/custom/v1/chat/completions')
      if (mode === 'closed' || mode === 'error' || mode === 'length') {
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
    },
    150_000
  )
})
