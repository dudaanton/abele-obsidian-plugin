import { load } from 'js-yaml'

// Preserve the legacy extractor's extended fences, BOM and whitespace consumption.
// The note helpers separately preserve body spacing after ordinary --- fences.
const fence = /^(\ufeff?(= yaml =|---)$([\s\S]*?)^(?:\2|\.\.\.)\s*$(?:\n)?)/m

export default function parseFrontmatter<T = Record<string, unknown>>(
  content: string
): { attributes: T; body: string; bodyBegin: number; frontmatter?: string } {
  const firstLine = content.split(/\r?\n/, 1)[0]
  const match = /= yaml =|---/.test(firstLine) ? fence.exec(content) : null
  if (!match) return { attributes: {} as T, body: content, bodyBegin: 1 }

  const frontmatter = match[3].trim()
  const attributes = (load(frontmatter) || {}) as T
  const offset = match.index + match[0].length
  const bodyBegin = content.slice(0, offset).split('\n').length
  return { attributes, frontmatter, body: content.replace(match[0], ''), bodyBegin }
}
