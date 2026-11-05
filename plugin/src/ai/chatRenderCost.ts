import type { ChatMessage } from './types'
import { chatBlocks, type ChatBlock } from './toolRuns'
import { toolFilePaths } from './toolFiles'
import { toolImage } from './chatArtifacts'

/** Conservatively counts mounted rows; repeated folded reads share their file preview. */
export function chatRenderCost(
  messages: readonly ChatMessage[],
  open: (run: Extract<ChatBlock, { kind: 'run' }>) => boolean
) {
  const weights = new Array<number>(messages.length).fill(1)
  const headers = new Array<number>(messages.length).fill(0)
  const groups = new Array<number>(messages.length).fill(0)
  let index = 0
  for (const block of chatBlocks(messages)) {
    if (block.kind === 'message') {
      index++
      continue
    }
    const paths = new Set(block.calls.flatMap(toolFilePaths))
    const compact =
      !open(block) &&
      paths.size <= 1 &&
      !block.calls.some((call) => toolImage(call) || call.nodeTurnId || call.nodeAccessRefusal)
    const header = compact ? 1 + paths.size : 1
    headers[index] = header
    for (let i = index; i < index + block.messages.length; i++) {
      weights[i] = compact ? 0 : 1
      groups[i] = header
    }
    index += block.messages.length
  }
  const prefix = [0]
  for (let i = 0; i < weights.length; i++) prefix.push(prefix[i] + weights[i] + headers[i])
  return (start: number, end: number) =>
    end <= start ? 0 : prefix[end] - prefix[start] + (headers[start] ? 0 : (groups[start] ?? 0))
}
