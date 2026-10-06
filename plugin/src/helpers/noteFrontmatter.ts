import { DEFAULT_SCHEMA, load, Type, YAMLException, type LoadOptions } from 'js-yaml'

// Only this reader retains js-yaml 3's safe-load scalar semantics. Other YAML readers
// keep the direct dependency's defaults; changing them would reinterpret saved data.
const integer =
  /^[-+]?(?:0|0b[01_]*[01]|0x[\da-fA-F_]*[\da-fA-F]|0[0-7_]*[0-7]|[1-9][\d_]*(?::[0-5]?\d)+|[1-9][\d_]*\d|[1-9])$/
const float =
  /^(?:[-+]?(?:0|[1-9][\d_]*)(?:\.[\d_]*)?(?:[eE][-+]?\d+)?|\.[\d_]+(?:[eE][-+]?\d+)?|[-+]?\d[\d_]*(?::[0-5]?\d)+\.[\d_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/

function numberValue(source: string, integral: boolean): number {
  let value = source.replace(/_/g, '').toLowerCase()
  const sign = value[0] === '-' ? -1 : 1
  value = value.replace(/^[-+]/, '')
  if (value === '.inf') return sign * Infinity
  if (value === '.nan') return NaN
  if (value.includes(':')) {
    // Keep the former reader's right-to-left summation, including floating-point rounding.
    let total = 0
    let base = 1
    for (const part of value.split(':').reverse()) {
      total += Number(part) * base
      base *= 60
    }
    return sign * total
  }
  if (!integral) return sign * parseFloat(value)
  if (value === '0') return 0
  if (value.startsWith('0b')) return sign * parseInt(value.slice(2), 2)
  if (value.startsWith('0x')) return sign * parseInt(value.slice(2), 16)
  return sign * parseInt(value, value[0] === '0' ? 8 : 10)
}

const base64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const binary = new Type('tag:yaml.org,2002:binary', {
  kind: 'scalar',
  resolve: (text: string | null) =>
    text !== null &&
    /^[A-Za-z0-9+/=\r\n]*$/.test(text) &&
    text.replace(/[\r\n]/g, '').length % 4 === 0,
  construct: (text: string) => {
    const input = text.replace(/[\r\n=]/g, '')
    const bytes: number[] = []
    let bits = 0
    for (let index = 0; index < input.length; index++) {
      if (index && index % 4 === 0) bytes.push((bits >> 16) & 255, (bits >> 8) & 255, bits & 255)
      bits = (bits << 6) | base64.indexOf(input[index])
    }
    const tail = input.length % 4
    if (tail === 0) bytes.push((bits >> 16) & 255, (bits >> 8) & 255, bits & 255)
    else if (tail === 3) bytes.push((bits >> 10) & 255, (bits >> 2) & 255)
    else if (tail === 2) bytes.push((bits >> 4) & 255)
    // The former reader returned Buffers in Node and plain byte arrays in the browser.
    return typeof Buffer === 'undefined' ? bytes : Buffer.from(bytes)
  },
})

const noteSchema = DEFAULT_SCHEMA.extend({
  implicit: [
    new Type('tag:yaml.org,2002:int', {
      kind: 'scalar',
      resolve: (text: string | null) => text !== null && integer.test(text),
      construct: (text: string) => numberValue(text, true),
    }),
    new Type('tag:yaml.org,2002:float', {
      kind: 'scalar',
      resolve: (text: string | null) => text !== null && !text.endsWith('_') && float.test(text),
      construct: (text: string) => numberValue(text, false),
    }),
  ],
  explicit: [binary],
})

// js-yaml 4 also accepts tagged/anchored implicit block keys that the old loader
// rejected. Observe parsed nodes rather than scanning YAML text (which would reject
// quoted strings, comments and block scalars containing the same punctuation).
function legacyMappingListener(source: string): LoadOptions['listener'] {
  const starts: number[] = []
  return (event, state) => {
    if (event === 'open') {
      starts.push(state.position)
      return
    }
    const start = starts.pop()
    if (start === undefined || state.kind !== 'mapping') return
    let prefix = source.slice(start, state.position).trimStart()
    let tagged = false
    let anchored = false
    let property: RegExpMatchArray | null
    while ((property = prefix.match(/^(!<[^>]*>|![^\s]*|&[^\s]+)(\s*)/))) {
      const isTag = property[1][0] === '!'
      if ((isTag && tagged) || (!isTag && anchored)) {
        throw new YAMLException('duplicate mapping property')
      }
      if (isTag) tagged = true
      else anchored = true
      prefix = prefix.slice(property[0].length)
      if (!/\r|\n/.test(property[2]) && !/^[!&{]/.test(prefix)) {
        throw new YAMLException('tagged or anchored implicit block mapping key')
      }
    }
  }
}

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
  const attributes = (load(frontmatter, {
    schema: noteSchema,
    listener: legacyMappingListener(frontmatter),
  }) || {}) as T
  const offset = match.index + match[0].length
  const bodyBegin = content.slice(0, offset).split('\n').length
  return { attributes, frontmatter, body: content.replace(match[0], ''), bodyBegin }
}
