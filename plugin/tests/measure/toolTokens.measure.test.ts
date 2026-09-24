/**
 * What the agent's tools cost in tokens, on a real vault.
 *
 *   ABELE_MEASURE_VAULT=/path/to/vault [ABELE_MEASURE_FOLDER=Sub] npm run measure:tokens
 *
 * Prints one table per result — how many tokens each tool answer costs as the agent is sent it —
 * and one for a working session, where every earlier answer rides along in every later request.
 * Counts are `estimateTokens`, an estimate that is right for comparing forms, not for billing.
 */
import { describe, it, beforeAll } from 'vitest'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { createAgentTools } from '@/ai/tools'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { estimateTokens } from '@/ai/tokens'
import type { AgentTool } from '@/ai/client'
import { ResultStore, createReadResultTool } from '@/ai/resultStore'
import { buildFakeVault } from '../helpers/fakeVault'
import { configureAbele } from '../helpers/testEnv'
import { loadDiskVault } from './diskVault'
import { scenariosFor, sessionFor, type Scenario } from './scenarios'

const root = process.env.ABELE_MEASURE_VAULT
const folder = process.env.ABELE_MEASURE_FOLDER ?? ''

/** What the model is told of one call besides its result: the call itself, and some framing. */
const PER_MESSAGE = 8

describe.skipIf(!root)('token cost of tool results', () => {
  let tools: AgentTool[]
  let specs: ReturnType<typeof loadDiskVault>

  beforeAll(() => {
    specs = loadDiskVault(root!, folder)
    const app = buildFakeVault(specs)
    ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = app
    configureAbele()
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' }
    ScopeResolver.getInstance().setFullVaultAccess(true)
    tools = createAgentTools()
  })

  /** The whole answer, and what the agent is sent of it once the result store has had it. */
  async function run(s: Scenario): Promise<{ whole: string; sent: string }> {
    const tool = tools.find((t) => t.name === s.tool)
    if (!tool) return { whole: `(no tool ${s.tool})`, sent: `(no tool ${s.tool})` }
    try {
      const result = await tool.execute('m', s.args)
      const whole = result.content.map((c) => c.text).join('')
      new ResultStore({ messages: () => [] }).keep(s.tool, s.label, result)
      return { whole, sent: result.content.map((c) => c.text).join('') }
    } catch (err) {
      const text = `error: ${(err as Error).message}`
      return { whole: text, sent: text }
    }
  }

  it('per result', async () => {
    const rows: Record<string, unknown>[] = []
    for (const s of scenariosFor(specs)) {
      const { whole, sent } = await run(s)
      rows.push({ call: s.label, whole: estimateTokens(whole), sent: estimateTokens(sent) })
    }
    console.log(`\nVault: ${root}${folder ? '/' + folder : ''}, ${specs.length} files`)
    console.table(rows)
  })

  it('per session', async () => {
    const system = estimateTokens(DEFAULT_AI_SETTINGS.prompts.system)
    const defs = estimateTokens(
      JSON.stringify(
        // As a chat sends them: `read_result` is added by the session, not the registry.
        [...tools, createReadResultTool(new ResultStore({ messages: () => [] }))].map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }))
      )
    )
    const fixed = system + defs + 30
    /**
     * What squeezing old results would save at most: every result more than `AGE` calls old cut
     * to a stub of `STUB` tokens in every request after that. The case for doing it or not.
     */
    const AGE = 3
    const STUB = 60
    const results: number[] = []
    let history = 0
    let sent = 0
    let fromResults = 0
    let squeezable = 0
    const rows: Record<string, unknown>[] = []
    const request = () => {
      sent += fixed + history
      fromResults += history
      for (const r of results.slice(0, Math.max(0, results.length - AGE))) {
        squeezable += Math.max(0, r - STUB)
      }
    }
    for (const s of sessionFor(specs)) {
      const call = estimateTokens(JSON.stringify(s.args)) + PER_MESSAGE
      const result = estimateTokens((await run(s)).sent) + PER_MESSAGE
      // The request that asked for this call carried everything before it.
      request()
      history += call + result
      results.push(result)
      rows.push({ call: s.label, result, historyAfter: history })
    }
    // And the request that reads the last result and answers.
    request()
    console.log(`\nFixed per request: system ${system}, tool definitions ${defs}`)
    console.table(rows)
    const pct = (x: number) => `${Math.round((100 * x) / sent)}%`
    console.log(
      `Session: ${rows.length + 1} requests, ${sent} input tokens in all; ` +
        `${fromResults} of them (${pct(fromResults)}) are earlier calls and results carried ` +
        `along, ${fixed * (rows.length + 1)} (${pct(fixed * (rows.length + 1))}) the fixed part. ` +
        `Cutting results older than ${AGE} calls to ${STUB} tokens would save at most ` +
        `${squeezable} (${pct(squeezable)}).`
    )
  })
})
