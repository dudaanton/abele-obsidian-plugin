import { nanoid } from 'nanoid'

export class Criterion {
  id: string
  type: 'path' | 'name' | 'property' | 'content'
  operator:
    | 'equals'
    | 'contains'
    | 'notContains'
    | 'startsWith'
    | 'endsWith'
    | 'regex'
    | 'exists'
    | 'notExists'
  property: string // used if type is 'property'
  value: string
  caseInsensitive: boolean

  private regexCache?: {
    pattern: string
    content: boolean
    insensitive: boolean
    regex: RegExp | null
  }

  constructor() {
    this.id = nanoid()
    this.type = 'path'
    this.operator = 'equals'
    this.value = ''
    this.property = ''
    this.caseInsensitive = false
  }

  private normalize(s: string): string {
    return this.caseInsensitive ? s.toLowerCase() : s
  }

  private cachedRegex(pattern: string, content: boolean): RegExp | null {
    // Keep the existing syntax: content uses caseInsensitive; paths/properties use explicit flags.
    const insensitive = content && this.caseInsensitive
    const cached = this.regexCache
    if (
      cached?.pattern === pattern &&
      cached.content === content &&
      cached.insensitive === insensitive
    ) {
      return cached.regex
    }
    let regex: RegExp | null = null
    try {
      if (content) {
        regex = new RegExp(pattern, insensitive ? 'i' : '')
      } else {
        const match = pattern.match(/^\/(.+)\/([gimsuvy]*)$/)
        const flags = match?.[2] || 'g'
        regex = new RegExp(match?.[1] ?? pattern, flags.includes('g') ? flags : flags + 'g')
      }
    } catch (e) {
      console.error(`Invalid regex in criterion: ${pattern}`, e)
    }
    // Invalid patterns are cached too: a bad query must not log once per candidate.
    this.regexCache = { pattern, content, insensitive, regex }
    return regex
  }

  checkRegExp(value: string, pattern: string): boolean {
    const regex = this.cachedRegex(pattern, false)
    if (!regex) return false
    regex.lastIndex = 0
    return regex.test(value)
  }

  checkPathCriterion(path: string): boolean {
    const p = this.normalize(path)
    const v = this.normalize(this.value)
    switch (this.operator) {
      case 'equals':
        return p === v
      case 'contains':
        return p.includes(v)
      case 'notContains':
        return !p.includes(v)
      case 'startsWith':
        return p.startsWith(v)
      case 'endsWith':
        return p.endsWith(v)
      case 'regex':
        return this.checkRegExp(path, this.value)
      default:
        return false
    }
  }

  checkPropertyCriterion(properties: Record<string, any>): boolean {
    const propValue = properties[this.property]
    const v = this.normalize(this.value)
    switch (this.operator) {
      case 'exists':
        return propValue !== undefined
      case 'notExists':
        return propValue === undefined
      case 'equals':
        return this.normalize(String(propValue ?? '')) === v
      case 'contains':
        if (Array.isArray(propValue)) {
          return propValue.some((item) => this.normalize(String(item)) === v)
        }
        if (typeof propValue === 'string') {
          return this.normalize(propValue).includes(v)
        }
        return false
      case 'notContains':
        if (Array.isArray(propValue)) {
          return !propValue.some((item) => this.normalize(String(item)) === v)
        }
        if (typeof propValue === 'string') {
          return !this.normalize(propValue).includes(v)
        }
        return false
      case 'startsWith':
        return typeof propValue === 'string' && this.normalize(propValue).startsWith(v)
      case 'endsWith':
        return typeof propValue === 'string' && this.normalize(propValue).endsWith(v)
      case 'regex': {
        if (typeof propValue === 'string') {
          return this.checkRegExp(propValue, this.value)
        }
        return false
      }
      default:
        return false
    }
  }

  checkContentCriterion(content: string): boolean {
    const c = this.normalize(content)
    const v = this.normalize(this.value)
    switch (this.operator) {
      case 'contains':
        return c.includes(v)
      case 'notContains':
        return !c.includes(v)
      case 'startsWith':
        return c.startsWith(v)
      case 'endsWith':
        return c.endsWith(v)
      case 'regex':
        return this.cachedRegex(this.value, true)?.test(content) ?? false
      default:
        return false
    }
  }

  isValid(): boolean {
    if (this.type === 'property' && !this.property) {
      return false
    }
    if (
      ['equals', 'contains', 'notContains', 'startsWith', 'endsWith', 'regex'].includes(
        this.operator
      ) &&
      !this.value
    ) {
      return false
    }
    return true
  }
}
