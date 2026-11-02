import { it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

it.skipIf(!process.env.ABELE_MEMORY_SOURCE)(
  'measures the complete service/session path on an isolated captured log',
  async () => {
    const source = fs.realpathSync(process.env.ABELE_MEMORY_SOURCE!)
    if (!process.env.ABELE_MEMORY_COPY) throw new Error('An isolated copy path is required')
    const copy = path.resolve(process.env.ABELE_MEMORY_COPY)
    if (source === copy || (fs.existsSync(copy) && fs.realpathSync(copy) === source))
      throw new Error('Source must not be the measurement copy')
    fs.copyFileSync(source, copy)
    const originalSize = fs.statSync(copy).size
    const app = useVault([])
    ChatStorage.destroy()
    const config = AbeleConfig.getInstance()
    config.ai = { ...DEFAULT_AI_SETTINGS, chatFolder: 'SampleChats', chatHistory: [] }
    vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
    await app.vault.createFolder('SampleChats')
    const file = await app.vault.create('SampleChats/Invented.abchat', '')
    file.stat.size = fs.statSync(copy).size
    const originalRead = app.vault.read.bind(app.vault)
    const originalAppend = app.vault.append.bind(app.vault)
    let phase = 'setup',
      peakHeap = 0,
      peakRss = 0,
      reads = 0,
      appended = 0
    const sample = () => {
      const m = process.memoryUsage()
      peakHeap = Math.max(peakHeap, m.heapUsed)
      peakRss = Math.max(peakRss, m.rss)
    }
    app.vault.read = async (candidate) => {
      if (candidate !== file) return originalRead(candidate)
      reads++
      const text = fs.readFileSync(copy, 'utf8')
      sample()
      return text
    }
    app.vault.append = async (candidate, data) => {
      if (candidate !== file) return originalAppend(candidate, data)
      appended += Buffer.byteLength(data)
      fs.appendFileSync(copy, data)
      file.stat.size = fs.statSync(copy).size
      file.stat.mtime++
      sample()
    }
    const modify = vi.spyOn(app.vault, 'modify')
    const processFile = vi.spyOn(app.vault, 'process')
    const parse = JSON.parse
    let parses = 0
    JSON.parse = function (...args: Parameters<typeof JSON.parse>) {
      const result = parse(...args)
      if (++parses % 32 === 0) sample()
      return result
    }
    const timer = setInterval(sample, 5)
    const measure = async (name: string, action: () => unknown) => {
      phase = name
      sample()
      const start = process.memoryUsage().heapUsed,
        started = performance.now()
      peakHeap = start
      peakRss = process.memoryUsage().rss
      reads = 0
      await action()
      sample()
      console.info(
        'FULL_PATH_MEMORY',
        JSON.stringify({
          phase,
          startMiB: start / 1048576,
          peakHeapMiB: peakHeap / 1048576,
          endMiB: process.memoryUsage().heapUsed / 1048576,
          peakRssMiB: peakRss / 1048576,
          processMaxRssMiB: process.resourceUsage().maxRSS / 1024,
          reads,
          appended,
          ms: performance.now() - started,
        })
      )
    }
    const service = ChatService.getInstance()
    let session: NonNullable<typeof service.activeSession.value> | undefined
    try {
      await measure('open-service', () => service.openChatFile(file as never))
      expect(fs.statSync(copy).size).toBe(originalSize)
      expect(appended).toBe(0)
      expect(modify.mock.calls.filter(([candidate]) => candidate === file)).toHaveLength(0)
      expect(processFile.mock.calls.filter(([candidate]) => candidate === file)).toHaveLength(0)
      session = service.getSessionByFile(file.path)!
      expect(session).toBeTruthy()
      // addUserNote is the public non-provider path and includes the real session save.
      await measure('append-and-save', () => session!.addUserNote('Invented measurement question'))
      await measure('save-again', () => session!.save())
      if (process.env.ABELE_MEMORY_SETTLED) {
        const { setFlagsFromString } = await import('node:v8')
        const { runInNewContext } = await import('node:vm')
        setFlagsFromString('--expose-gc')
        const gc = runInNewContext('gc') as () => void
        for (let i = 0; i < 3; i++) {
          gc()
          await measure(`settled-turn-${i}`, () =>
            session!.addUserNote('Invented repeated measurement question')
          )
        }
      }
      await measure('model-context', async () => {
        const history = session!.messagesForModel()
        const system = await service.getSystemPrompt(session!)
        const turn = await service.getTurnContext(session!)
        const tools = session!.toolDefs()
        console.info(
          'FULL_PATH_CONTEXT',
          JSON.stringify({
            messages: history.length,
            systemChars: system.length,
            turnChars: turn.length,
            tools: tools.length,
          })
        )
      })
      expect(appended).toBeGreaterThan(0)
      expect(fs.statSync(copy).size).toBe(originalSize + appended)
      expect(modify.mock.calls.filter(([candidate]) => candidate === file)).toHaveLength(0)
      expect(processFile.mock.calls.filter(([candidate]) => candidate === file)).toHaveLength(0)
      // Compare bounded byte chunks after measurement, without retaining another full log.
      const input = fs.openSync(source, 'r')
      const output = fs.openSync(copy, 'r')
      try {
        const a = Buffer.alloc(65536),
          b = Buffer.alloc(65536)
        for (let offset = 0; offset < originalSize; offset += a.length) {
          const size = Math.min(a.length, originalSize - offset)
          expect(fs.readSync(input, a, 0, size, offset)).toBe(size)
          expect(fs.readSync(output, b, 0, size, offset)).toBe(size)
          expect(a.subarray(0, size).equals(b.subarray(0, size))).toBe(true)
        }
      } finally {
        fs.closeSync(input)
        fs.closeSync(output)
      }
    } finally {
      clearInterval(timer)
      JSON.parse = parse
      session?.destroy()
      ChatStorage.destroy()
      vi.restoreAllMocks()
    }
  },
  120_000
)
