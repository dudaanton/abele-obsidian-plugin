import { resolvePath } from '@/helpers/pathsHelpers'
import { nanoid } from 'nanoid'

const ARRAY_SEPARATOR = ';'

export class ReplacementAction {
  id: string
  type:
    | 'set-property'
    | 'remove-property'
    | 'add-to-list'
    | 'remove-from-list'
    | 'replace-in-list'
    | 'replace-in-content'
    | 'replace-in-property'
    | 'move'
  property: string // used if type is 'property'
  directory: string // used if type is 'move'
  value: string
  oldValue: string // used if type is 'replace-in-list'

  constructor() {
    this.id = nanoid()
    this.type = 'set-property'
    this.value = ''
    this.property = ''
    this.directory = ''
    this.oldValue = ''
  }

  applyPathReplacement(path: string): string {
    if (this.type === 'move') {
      const segments = path.split('/')
      const fileName = segments.pop() || ''
      return resolvePath(this.directory, fileName)
    }
    return path
  }

  convertValueToArrayIfNeeded(
    property: string,
    value: string,
    properties: Record<string, any>
  ): string | string[] {
    if (properties[property] && Array.isArray(properties[property])) {
      return value.split(ARRAY_SEPARATOR).map((v) => v.trim())
    }

    return value
  }

  applyPropertyReplacement(properties: Record<string, any>): Record<string, any> {
    properties = properties || {}
    const newProperties = properties ? { ...properties } : {}

    switch (this.type) {
      case 'set-property':
        newProperties[this.property] = this.convertValueToArrayIfNeeded(
          this.property,
          this.value,
          newProperties
        )
        console.log('Set property:', this.property, newProperties[this.property])
        break
      case 'remove-property':
        delete newProperties[this.property]
        break
      case 'add-to-list':
        if (!Array.isArray(newProperties[this.property])) {
          newProperties[this.property] = []
        }

        let valueToAdd: string | string[] = this.convertValueToArrayIfNeeded(
          this.property,
          this.value,
          newProperties
        )

        if (!Array.isArray(valueToAdd)) {
          valueToAdd = [valueToAdd]
        }

        newProperties[this.property] = Array.from(
          new Set([...(newProperties[this.property] || []), ...valueToAdd])
        )

        break
      case 'remove-from-list':
        let valueToRemove: string | string[] = this.convertValueToArrayIfNeeded(
          this.property,
          this.value,
          properties
        )

        if (!Array.isArray(valueToRemove)) {
          valueToRemove = [valueToRemove]
        }

        if (Array.isArray(newProperties[this.property])) {
          newProperties[this.property] = newProperties[this.property].filter(
            (item: any) => !valueToRemove.includes(item)
          )
        }
        break
      case 'replace-in-list':
        if (Array.isArray(newProperties[this.property])) {
          newProperties[this.property] = newProperties[this.property].map((item: any) =>
            item === this.oldValue ? this.value : item
          )
        }
        break
      default:
        break
    }
    return newProperties
  }

  applyContentReplacement(content: string): string {
    if (
      (this.type !== 'replace-in-content' && this.type !== 'replace-in-property') ||
      !this.oldValue ||
      typeof this.value === 'undefined'
    ) {
      return content
    }

    const regexMatch = this.oldValue.match(/^\/(.+)\/([gimsuvy]*)$/)

    console.log(regexMatch)

    if (regexMatch) {
      try {
        const [, pattern, flags] = regexMatch
        const finalFlags = flags.includes('g') ? flags : flags + 'g'
        const regex = new RegExp(pattern, finalFlags)

        return content.replace(regex, this.value)
      } catch (e) {
        console.error(`Invalid regex pattern: ${this.oldValue}`, e)
        return content
      }
    } else {
      return content.replaceAll(this.oldValue, this.value)
    }
  }

  applyPropertyContentReplacement(properties: Record<string, any>): Record<string, any> {
    if (
      this.type !== 'replace-in-property' ||
      !this.oldValue ||
      typeof this.value === 'undefined'
    ) {
      return properties
    }

    const newProperties = { ...properties }

    if (newProperties[this.property] && typeof newProperties[this.property] === 'string') {
      const content = newProperties[this.property] as string
      newProperties[this.property] = this.applyContentReplacement(content)
    }

    if (newProperties[this.property] && Array.isArray(newProperties[this.property])) {
      newProperties[this.property] = newProperties[this.property].map((item: any) => {
        if (typeof item === 'string') {
          return this.applyContentReplacement(item)
        }
        return item
      })
    }

    return newProperties
  }

  isValid(): boolean {
    if (this.type === 'move') {
      return this.directory.trim().length > 0
    } else if (this.type === 'remove-property') {
      return this.property.trim().length > 0
    } else if (this.type === 'replace-in-list') {
      return (
        this.property.trim().length > 0 &&
        this.oldValue.trim().length > 0 &&
        this.value.trim().length > 0
      )
    } else if (this.type === 'replace-in-property') {
      return this.property.trim().length > 0 && this.oldValue.trim().length > 0
    } else if (this.type === 'replace-in-content') {
      return this.oldValue.trim().length > 0
    } else {
      return this.property.trim().length > 0 && this.value.trim().length > 0
    }
  }
}
