import type { AgentTool, ModelConfig } from '../client'
import { OpenAIClient } from '../client'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'

function resolveWiseModelConfig(): ModelConfig | null {
  const config = AbeleConfig.getInstance().ai
  if (!config.wiseModelId) return null

  for (const provider of config.providers) {
    const model = provider.models.find((m) => m.id === config.wiseModelId)
    if (model) {
      return {
        id: model.id,
        name: model.name,
        baseUrl: provider.baseUrl,
        apiKey: GlobalStore.getInstance().app.secretStorage.getSecret(provider.apiKeyId) || '',
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        supportsReasoning: model.supportsReasoning,
      }
    }
  }

  return null
}

export function createWiseModelTool(): AgentTool {
  return {
    name: 'wise_model',
    label: 'Wise Model',
    description:
      'Consult a more powerful AI model for complex analysis, evaluation, or reasoning. Use when the task requires deeper expertise than you can provide — for example, nuanced code review, architectural decisions, or difficult analytical questions.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'The question or request to send to the wise model. Include all necessary context.',
        },
        system_prompt: {
          type: 'string',
          description: 'Optional system prompt to set the role or constraints for the wise model.',
        },
      },
      required: ['prompt'],
    },
    execute: async (_id, params, signal?) => {
      const prompt = params.prompt as string
      if (!prompt) throw new Error('Missing required parameter: prompt')

      const modelConfig = resolveWiseModelConfig()
      if (!modelConfig) {
        throw new Error(
          'Wise model is not configured. Ask the user to select a wise model in settings.'
        )
      }

      const systemPrompt =
        (params.system_prompt as string) ||
        'You are an expert consultant. Provide thorough, well-reasoned analysis. Be direct and concise.'

      const client = new OpenAIClient()
      const messages = [{ role: 'user' as const, content: prompt, timestamp: Date.now() }]

      let response = ''
      for await (const event of client.stream(modelConfig, systemPrompt, messages, [], {
        signal,
      })) {
        if (event.type === 'text_delta') response += event.delta
      }

      response = response.trim()
      if (!response) throw new Error('Wise model returned an empty response')

      return { content: [{ type: 'text', text: response }] }
    },
  }
}
