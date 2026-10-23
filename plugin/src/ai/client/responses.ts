import type { StreamChunk } from './OpenAIClient'

interface FunctionItem {
  type: string
  id: string
  call_id: string
  name: string
  arguments: string
}
interface ProviderError {
  code?: string
  message?: string
  type?: string
}
export interface ResponsesEvent {
  type: string
  code?: string
  message?: string
  error?: ProviderError
  delta?: string
  output_index?: number
  call_id?: string
  content_index?: number
  refusal?: string
  item_id?: string
  item?: FunctionItem
  response?: {
    error?: ProviderError
    incomplete_details?: { reason?: string }
    usage?: {
      input_tokens?: number
      output_tokens?: number
      input_tokens_details?: { cached_tokens?: number }
    }
  }
}

/** Normalize wire events so both APIs share transport, cancellation and turn outcomes. */
export class ResponsesStreamAdapter {
  completed = false
  private calls = new Map<string, FunctionItem>()
  private indices = new Map<string, number>()
  private refusals = new Map<string, string>()

  private findCall(event: ResponsesEvent): FunctionItem | undefined {
    return (
      this.calls.get(event.item_id ?? '') ??
      [...this.calls.values()].find(
        (call) =>
          (event.call_id !== undefined && call.call_id === event.call_id) ||
          (event.output_index !== undefined && this.indices.get(call.id) === event.output_index)
      )
    )
  }

  accept(event: ResponsesEvent): StreamChunk[] {
    const delta = (value: object): StreamChunk[] => [{ choices: [{ delta: value }] }]
    switch (event.type) {
      case 'response.output_text.delta':
        return delta({ content: event.delta })
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        return delta({ reasoning_content: event.delta })
      case 'response.refusal.delta':
      case 'response.refusal.done': {
        const key = `${event.item_id ?? event.output_index ?? ''}:${event.content_index ?? 0}`
        const previous = this.refusals.get(key) ?? ''
        const text =
          event.type === 'response.refusal.delta'
            ? (event.delta ?? '')
            : (event.refusal ?? '').slice(previous.length)
        this.refusals.set(key, previous + text)
        return delta({ content: text })
      }
      case 'response.output_item.added':
      case 'response.output_item.done': {
        const item = event.item
        if (item?.type !== 'function_call') return []
        const previous = this.calls.get(item.id)
        const index = this.indices.get(item.id) ?? event.output_index ?? this.calls.size
        this.indices.set(item.id, index)
        this.calls.set(item.id, { ...item })
        return delta({
          tool_calls: [
            {
              index,
              id: item.call_id,
              function: {
                name: item.name,
                arguments: item.arguments.slice(previous?.arguments.length ?? 0),
              },
            },
          ],
        })
      }
      case 'response.function_call_arguments.delta': {
        const call = this.findCall(event)
        if (!call)
          return [
            {
              error:
                'Responses returned arguments for an unknown function call. Retry the request.',
            },
          ]
        call.arguments = (call.arguments || '') + (event.delta || '')
        return delta({
          tool_calls: [
            {
              index: this.indices.get(call.id),
              id: call.call_id,
              function: { arguments: event.delta },
            },
          ],
        })
      }
      case 'response.failed':
      case 'error': {
        this.completed = true
        console.debug('[Abele model] Responses failure', event)
        const reason = event.response?.error ?? event.error ?? event
        const code = reason.code?.trim() || (reason !== event ? reason.type?.trim() : '')
        const details = [
          code ? `[${code.slice(0, 100)}]` : '',
          reason.message?.trim().slice(0, 1000),
        ]
          .filter(Boolean)
          .join(' ')
        return [{ error: `Responses request failed${details ? `: ${details}` : ''}` }]
      }
      case 'response.completed':
      case 'response.incomplete': {
        this.completed = true
        const chunks: StreamChunk[] = []
        if (this.calls.size && event.type === 'response.incomplete')
          return [{ error: 'Responses function call was incomplete. Retry the request.' }]
        for (const call of this.calls.values()) {
          try {
            const args: unknown = JSON.parse(call.arguments)
            if (!args || typeof args !== 'object' || Array.isArray(args))
              throw new Error('Invalid arguments')
          } catch {
            return [{ error: 'Responses returned invalid function arguments. Retry the request.' }]
          }
        }
        const usage = event.response?.usage
        const incomplete = event.type === 'response.incomplete'
        chunks.push({
          usage: usage
            ? {
                prompt_tokens: usage.input_tokens,
                completion_tokens: usage.output_tokens,
                prompt_tokens_details: usage.input_tokens_details,
              }
            : undefined,
          choices: [
            {
              delta: {},
              finish_reason: incomplete
                ? event.response?.incomplete_details?.reason === 'max_output_tokens'
                  ? 'length'
                  : 'error'
                : this.calls.size
                  ? 'tool_calls'
                  : 'stop',
            },
          ],
        })
        return chunks
      }
      default:
        return []
    }
  }
}
