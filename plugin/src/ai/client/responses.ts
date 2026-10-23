import type { StreamChunk } from './OpenAIClient'

interface FunctionItem {
  type: string
  id: string
  call_id: string
  name: string
  arguments: string
}
export interface ResponsesEvent {
  type: string
  delta?: string
  item_id?: string
  item?: FunctionItem
  response?: {
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
  private streamingId?: string
  private streamedArguments = ''

  accept(event: ResponsesEvent): StreamChunk[] {
    const delta = (value: object): StreamChunk[] => [{ choices: [{ delta: value }] }]
    switch (event.type) {
      case 'response.output_text.delta':
        return delta({ content: event.delta })
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        return delta({ reasoning_content: event.delta })
      case 'response.output_item.added':
        if (event.item?.type === 'function_call') {
          this.calls.set(event.item.id, { ...event.item })
          if (!this.streamingId) {
            this.streamingId = event.item.id
            this.streamedArguments = event.item.arguments || ''
            return delta({
              tool_calls: [
                {
                  index: 0,
                  id: event.item.call_id,
                  function: { name: event.item.name, arguments: this.streamedArguments },
                },
              ],
            })
          }
        }
        return []
      case 'response.function_call_arguments.delta': {
        const call = this.calls.get(event.item_id ?? '')
        if (call) call.arguments = (call.arguments || '') + (event.delta || '')
        if (call && event.item_id === this.streamingId) {
          this.streamedArguments += event.delta || ''
          return delta({ tool_calls: [{ index: 0, function: { arguments: event.delta } }] })
        }
        return []
      }
      case 'response.output_item.done':
        if (event.item?.type === 'function_call') {
          this.calls.set(event.item.id, { ...event.item })
          if (event.item.id === this.streamingId) {
            const remaining = event.item.arguments.slice(this.streamedArguments.length)
            this.streamedArguments = event.item.arguments
            return delta({ tool_calls: [{ index: 0, function: { arguments: remaining } }] })
          }
        }
        return []
      case 'response.failed':
      case 'error':
        this.completed = true
        return [{ error: 'Responses request failed. Check the provider configuration or retry.' }]
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
        // The loop's argument deltas have no call ID. Emit each assembled call separately
        // so interleaved parallel arguments cannot be attributed to another call.
        for (const call of this.calls.values()) {
          if (call.id === this.streamingId) continue
          chunks.push(
            ...delta({
              tool_calls: [
                {
                  index: 0,
                  id: call.call_id,
                  function: { name: call.name, arguments: call.arguments },
                },
              ],
            })
          )
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
