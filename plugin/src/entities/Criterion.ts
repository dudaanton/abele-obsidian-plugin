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

  checkRegExp(value: string, pattern: string): boolean {
    try {
      const regexMatch = pattern.match(/^\/(.+)\/([gimsuvy]*)$/)
      let regex

      if (regexMatch) {
        const [, pattern, flags] = regexMatch
        const finalFlags = flags.includes('g') ? flags : flags + 'g'
        regex = new RegExp(pattern, finalFlags)
      } else {
        regex = new RegExp(pattern, 'g')
      }

      return regex.test(value)

      // const allMatches = [...value.matchAll(regex)]
      //
      // if (allMatches.length === 0) {
      //   return false
      // }
      //
      // const capturedGroups = allMatches.flatMap((match) => match.slice(1))
      //
      // return capturedGroups.length > 0 ? capturedGroups : true
    } catch (e) {
      console.error(`Invalid regex in criterion: ${pattern}`, e)
      return false
    }
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
        try {
          const regex = new RegExp(this.value, this.caseInsensitive ? 'i' : '')
          return regex.test(content)
        } catch (e) {
          console.error(`Invalid regex in criterion: ${this.value}`, e)
          return false
        }
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
