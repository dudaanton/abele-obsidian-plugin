import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'

/**
 * Represents properties extracted from a template note's frontmatter
 */
export interface UserTemplateProperties {
  type: 'template'
  template_for: string
  template_dir?: string
  order?: number
  callbacks?: string
  target_folder?: string
  target_name?: string
  // Dynamic template_for_* properties for target note
  [key: string]: string | number | undefined
}

/**
 * Represents a property to be set on the target note
 */
export interface TargetProperty {
  name: string
  value: string
}

/**
 * Represents a user-defined template discovered from vault
 */
export class UserTemplate {
  public readonly file: TFile
  public readonly templateFor: string
  public readonly templateDir: string | null
  public readonly order: number | null
  public readonly callbacks: string[]
  public readonly targetFolder: string | null
  public readonly targetName: string | null
  public readonly targetProperties: TargetProperty[]
  public readonly name: string

  constructor(file: TFile, properties: UserTemplateProperties) {
    this.file = file
    this.templateFor = properties.template_for
    this.templateDir = properties.template_dir ?? null
    this.order = properties.order ?? null
    this.callbacks = this.parseCallbacks(properties.callbacks)
    this.targetFolder = properties.target_folder ?? null
    this.targetName = properties.target_name ?? null
    this.targetProperties = this.extractTargetProperties(properties)
    this.name = file.basename
  }

  /**
   * Extract template_for_* properties and convert to target properties
   * e.g., template_for_created -> { name: 'created', value: '...' }
   */
  private extractTargetProperties(properties: UserTemplateProperties): TargetProperty[] {
    const prefix = 'template_for_'
    const reservedKeys = ['template_for'] // template_for without suffix is reserved
    const result: TargetProperty[] = []

    for (const [key, value] of Object.entries(properties)) {
      if (key.startsWith(prefix) && !reservedKeys.includes(key) && value !== undefined) {
        const propName = key.slice(prefix.length)
        if (propName) {
          // Only add if there's actually a property name after prefix
          result.push({
            name: propName,
            value: String(value),
          })
        }
      }
    }

    return result
  }

  /**
   * Parse callbacks string into array of command IDs
   * Format: "command:id1;command:id2"
   */
  private parseCallbacks(callbacks?: string): string[] {
    if (!callbacks) return []

    return callbacks
      .split(';')
      .map((cb) => cb.trim())
      .filter((cb) => cb.startsWith('command:'))
      .map((cb) => cb.replace('command:', ''))
  }

  /**
   * Get the display path for template selection UI
   * Combines templateDir with template name
   */
  get displayPath(): string {
    if (this.templateDir) {
      return `${this.templateDir}/${this.name}`
    }
    return this.name
  }

  /**
   * Get directory segments for hierarchical display
   */
  get dirSegments(): string[] {
    if (!this.templateDir) return []
    return this.templateDir.split('/').filter(Boolean)
  }

  /**
   * Read template content from file
   */
  async getContent(): Promise<string> {
    const { app } = GlobalStore.getInstance()
    return await app.vault.read(this.file)
  }

  /**
   * Template-specific properties that should be stripped from output
   */
  private static readonly TEMPLATE_PROPERTIES = [
    'type',
    'template_for',
    'template_dir',
    'order',
    'callbacks',
    'target_folder',
    'target_name',
  ]

  /**
   * Prefix for properties that should be transferred to target note
   */
  private static readonly TARGET_PROPERTY_PREFIX = 'template_for_'

  /**
   * Get template body with template-specific properties removed from frontmatter
   */
  async getBody(): Promise<string> {
    const content = await this.getContent()
    return this.stripTemplateProperties(content)
  }

  /**
   * Remove only template-specific properties from frontmatter, keep the rest.
   * Converts template_for value to type property in output.
   */
  private stripTemplateProperties(content: string): string {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---([\n]?)/
    const match = content.match(frontmatterRegex)

    if (!match) {
      return content
    }

    const frontmatterContent = match[1]
    const afterFrontmatter = content.slice(match[0].length)

    // Parse frontmatter lines and filter out template properties
    const lines = frontmatterContent.split('\n')
    const filteredLines: string[] = []
    let skipUntilNextProperty = false
    let hasTypeProperty = false

    for (const line of lines) {
      // Check if line starts a property (not indented, has colon)
      const propertyMatch = line.match(/^([a-z_]+)\s*:/)

      if (propertyMatch) {
        const propName = propertyMatch[1]

        // Skip template_for_* properties (they are handled separately)
        // Check this BEFORE template_for to avoid matching template_for_created as template_for
        if (
          propName.startsWith(UserTemplate.TARGET_PROPERTY_PREFIX) &&
          propName !== 'template_for'
        ) {
          skipUntilNextProperty = true
          continue
        }

        // Replace template_for with type (keeping same position)
        if (propName === 'template_for') {
          skipUntilNextProperty = true
          if (!hasTypeProperty && this.templateFor !== 'default') {
            filteredLines.push(`type: ${this.templateFor}`)
          }
          continue
        }

        if (UserTemplate.TEMPLATE_PROPERTIES.includes(propName)) {
          skipUntilNextProperty = true
          continue
        }
        skipUntilNextProperty = false
        if (propName === 'type') {
          hasTypeProperty = true
        }
      } else if (skipUntilNextProperty) {
        // Skip continuation lines of template properties (indented content)
        if (line.match(/^\s+/) || line.trim() === '') {
          continue
        }
        skipUntilNextProperty = false
      }

      filteredLines.push(line)
    }

    // Remove empty lines at start/end of frontmatter
    while (filteredLines.length > 0 && filteredLines[0].trim() === '') {
      filteredLines.shift()
    }
    while (filteredLines.length > 0 && filteredLines[filteredLines.length - 1].trim() === '') {
      filteredLines.pop()
    }

    // If no properties left, return content without frontmatter
    if (filteredLines.length === 0) {
      return afterFrontmatter.replace(/^\n/, '')
    }

    // Rebuild content with cleaned frontmatter
    return `---\n${filteredLines.join('\n')}\n---\n${afterFrontmatter}`
  }

  /**
   * Check if this is a default template
   */
  get isDefault(): boolean {
    return this.templateFor === 'default'
  }

  /**
   * Create UserTemplate from TFile if it's a valid template
   * Returns null if file is not a template
   */
  static fromFile(file: TFile): UserTemplate | null {
    const { app } = GlobalStore.getInstance()
    const cache = app.metadataCache.getFileCache(file)
    const frontmatter = cache?.frontmatter

    if (!frontmatter) return null
    if (frontmatter.type !== 'template') return null
    if (!frontmatter.template_for) return null

    return new UserTemplate(file, frontmatter as UserTemplateProperties)
  }
}
