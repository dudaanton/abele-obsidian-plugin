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

  constructor() {
    this.id = nanoid()
    this.type = 'path'
    this.operator = 'equals'
    this.value = ''
    this.property = ''
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
    switch (this.operator) {
      case 'equals':
        return path === this.value
      case 'contains':
        return path.includes(this.value)
      case 'notContains':
        return !path.includes(this.value)
      case 'startsWith':
        return path.startsWith(this.value)
      case 'endsWith':
        return path.endsWith(this.value)
      case 'regex':
        return this.checkRegExp(path, this.value)
      default:
        return false
    }
  }

  checkPropertyCriterion(properties: Record<string, any>): boolean {
    const propValue = properties[this.property]
    switch (this.operator) {
      case 'exists':
        return propValue !== undefined
      case 'notExists':
        return propValue === undefined
      case 'equals':
        return propValue === this.value
      case 'contains':
        if (typeof propValue === 'string' || Array.isArray(propValue)) {
          return propValue.includes(this.value)
        }
        return false
      case 'notContains':
        if (typeof propValue === 'string' || Array.isArray(propValue)) {
          return !propValue.includes(this.value)
        }
        return false
      case 'startsWith':
        return typeof propValue === 'string' && propValue.startsWith(this.value)
      case 'endsWith':
        return typeof propValue === 'string' && propValue.endsWith(this.value)
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
    switch (this.operator) {
      case 'contains':
        return content.includes(this.value)
      case 'notContains':
        return !content.includes(this.value)
      case 'startsWith':
        return content.startsWith(this.value)
      case 'endsWith':
        return content.endsWith(this.value)
      case 'regex':
        try {
          const regex = new RegExp(this.value)
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
