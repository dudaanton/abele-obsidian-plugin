import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { UserTemplate } from './UserTemplate'
import { parseTemplateVariables, applyTemplateVariables, TemplateVariable } from './TemplateParser'
import { getAvailablePath } from '@/helpers/vaultUtils'

/**
 * Grouped templates by templateDir for hierarchical display
 */
export interface TemplateGroup {
  name: string
  path: string
  templates: UserTemplate[]
  children: TemplateGroup[]
}

/**
 * Service for discovering and applying user templates
 */
export class TemplateService {
  private static instance: TemplateService

  public static getInstance(): TemplateService {
    if (!TemplateService.instance) {
      TemplateService.instance = new TemplateService()
    }
    return TemplateService.instance
  }

  /**
   * Discover all templates in the vault
   */
  discoverTemplates(): UserTemplate[] {
    const { app } = GlobalStore.getInstance()
    const templates: UserTemplate[] = []

    const files = app.vault.getMarkdownFiles()
    for (const file of files) {
      const template = UserTemplate.fromFile(file)
      if (template) {
        templates.push(template)
      }
    }

    return this.sortTemplates(templates)
  }

  /**
   * Get templates filtered by template_for type
   */
  getTemplatesByType(templateFor: string): UserTemplate[] {
    return this.discoverTemplates().filter((t) => t.templateFor === templateFor)
  }

  /**
   * Get all non-default templates
   */
  getNonDefaultTemplates(): UserTemplate[] {
    return this.discoverTemplates().filter((t) => !t.isDefault)
  }

  /**
   * Get the default template if exists
   */
  getDefaultTemplate(): UserTemplate | null {
    return this.discoverTemplates().find((t) => t.isDefault) ?? null
  }

  /**
   * Sort templates: with order first (ascending), then without order
   */
  private sortTemplates(templates: UserTemplate[]): UserTemplate[] {
    return templates.sort((a, b) => {
      // Both have order - sort by order
      if (a.order !== null && b.order !== null) {
        return a.order - b.order
      }
      // Only a has order - a comes first
      if (a.order !== null) return -1
      // Only b has order - b comes first
      if (b.order !== null) return 1
      // Neither has order - sort by name
      return a.name.localeCompare(b.name)
    })
  }

  /**
   * Build hierarchical structure from templates for UI
   */
  buildTemplateHierarchy(templates: UserTemplate[]): TemplateGroup {
    const root: TemplateGroup = {
      name: '',
      path: '',
      templates: [],
      children: [],
    }

    for (const template of templates) {
      const segments = template.dirSegments

      if (segments.length === 0) {
        root.templates.push(template)
        continue
      }

      let currentGroup = root
      let currentPath = ''

      for (const segment of segments) {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment

        let childGroup = currentGroup.children.find((c) => c.name === segment)
        if (!childGroup) {
          childGroup = {
            name: segment,
            path: currentPath,
            templates: [],
            children: [],
          }
          currentGroup.children.push(childGroup)
        }
        currentGroup = childGroup
      }

      currentGroup.templates.push(template)
    }

    return root
  }

  /**
   * Apply template and create a new note
   */
  async createNoteFromTemplate(
    template: UserTemplate,
    userValues: Map<string, string>
  ): Promise<TFile> {
    // Get template body
    const body = await template.getBody()

    // Parse and apply variables
    const { variables } = parseTemplateVariables(body)
    let content = await applyTemplateVariables(body, variables, userValues)

    // Apply target properties (template_prop_* -> frontmatter)
    content = await this.applyTargetProperties(content, template, variables, userValues)

    // Determine target path
    const targetPath = await this.resolveTargetPath(template, variables, userValues)

    // Create file
    const file = await this.createFileWithPath(targetPath, content)

    // Execute callbacks
    await this.executeCallbacks(template.callbacks)

    return file
  }

  /**
   * Replace current note content with template
   */
  async replaceNoteWithTemplate(
    template: UserTemplate,
    targetFile: TFile,
    userValues: Map<string, string>
  ): Promise<void> {
    const { app } = GlobalStore.getInstance()

    const body = await template.getBody()
    const { variables } = parseTemplateVariables(body)
    let content = await applyTemplateVariables(body, variables, userValues)

    // Apply target properties
    content = await this.applyTargetProperties(content, template, variables, userValues)

    await app.vault.modify(targetFile, content)
    await this.executeCallbacks(template.callbacks)
  }

  /**
   * Insert template content at cursor position
   */
  async insertTemplateAtCursor(
    template: UserTemplate,
    userValues: Map<string, string>
  ): Promise<string> {
    const body = await template.getBody()
    const { variables } = parseTemplateVariables(body)
    const content = await applyTemplateVariables(body, variables, userValues)

    await this.executeCallbacks(template.callbacks)

    return content
  }

  /**
   * Apply default template to a newly created file
   */
  async applyDefaultTemplate(file: TFile): Promise<boolean> {
    console.log('apply default template for file', file.path)
    const defaultTemplate = this.getDefaultTemplate()
    if (!defaultTemplate) return false

    const body = await defaultTemplate.getBody()
    const { variables, userVariables } = parseTemplateVariables(body)

    // Default template should not have user variables
    // If it does, skip application
    if (userVariables.length > 0) {
      console.warn('Default template has user variables, skipping auto-application')
      return false
    }

    let content = await applyTemplateVariables(body, variables, new Map())

    // Apply target properties
    content = await this.applyTargetProperties(content, defaultTemplate, variables, new Map())

    const { app: vaultApp } = GlobalStore.getInstance()
    await vaultApp.vault.modify(file, content)

    await this.executeCallbacks(defaultTemplate.callbacks)

    return true
  }

  /**
   * Apply target properties (template_prop_*) to content frontmatter
   * Resolves variables in property values and adds them to frontmatter
   */
  private async applyTargetProperties(
    content: string,
    template: UserTemplate,
    variables: TemplateVariable[],
    userValues: Map<string, string>
  ): Promise<string> {
    if (template.targetProperties.length === 0) {
      return content
    }

    // Resolve variables in each property value
    const resolvedProps: Array<{ name: string; value: string }> = []
    for (const prop of template.targetProperties) {
      // Parse variables from property value itself (may contain variables not in body)
      const { variables: propVariables } = parseTemplateVariables(prop.value)
      const resolvedValue = await applyTemplateVariables(prop.value, propVariables, userValues)
      resolvedProps.push({ name: prop.name, value: resolvedValue })
    }

    // Check if content has frontmatter
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---/
    const match = content.match(frontmatterRegex)

    if (match) {
      // Insert properties at the end of existing frontmatter
      const frontmatterContent = match[1]
      const afterFrontmatter = content.slice(match[0].length)

      const newProps = resolvedProps.map((p) => `${p.name}: ${p.value}`).join('\n')
      const newFrontmatter = frontmatterContent.trimEnd() + '\n' + newProps

      return `---\n${newFrontmatter}\n---${afterFrontmatter}`
    } else {
      // Create new frontmatter with properties
      const newProps = resolvedProps.map((p) => `${p.name}: ${p.value}`).join('\n')
      return `---\n${newProps}\n---\n${content}`
    }
  }

  /**
   * Resolve target path for new note
   */
  private async resolveTargetPath(
    template: UserTemplate,
    variables: TemplateVariable[],
    userValues: Map<string, string>
  ): Promise<string> {
    const { app } = GlobalStore.getInstance()

    let folder = ''
    let name = 'Untitled'

    // Resolve target_folder if specified
    if (template.targetFolder) {
      folder = await applyTemplateVariables(template.targetFolder, variables, userValues)
    } else {
      // Use Obsidian's default location for new files
      const defaultLocation = (app.vault as any).getConfig?.('newFileLocation') || 'root'
      if (defaultLocation === 'current') {
        const activeFile = app.workspace.getActiveFile()
        if (activeFile) {
          folder = activeFile.parent?.path || ''
        }
      } else if (defaultLocation === 'folder') {
        folder = (app.vault as any).getConfig?.('newFileFolderPath') || ''
      }
      // 'root' means empty folder (vault root)
    }

    // Resolve target_name if specified
    if (template.targetName) {
      name = await applyTemplateVariables(template.targetName, variables, userValues)
    }

    // Build full path
    const basePath = folder ? `${folder}/${name}.md` : `${name}.md`

    // Get available path (handles conflicts)
    return await getAvailablePath(basePath)
  }

  /**
   * Create file with full path, creating directories if needed
   */
  private async createFileWithPath(filePath: string, content: string): Promise<TFile> {
    const { app } = GlobalStore.getInstance()

    console.log(content)

    // Ensure directory exists
    const pathParts = filePath.split('/')
    pathParts.pop() // Remove filename

    if (pathParts.length > 0) {
      let currentPath = ''
      for (const part of pathParts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part
        const folder = app.vault.getAbstractFileByPath(currentPath)
        if (!folder) {
          await app.vault.createFolder(currentPath)
        }
      }
    }

    return await app.vault.create(filePath, content)
  }

  /**
   * Execute callbacks sequentially
   */
  private async executeCallbacks(callbacks: string[]): Promise<void> {
    const { app } = GlobalStore.getInstance()

    for (const commandId of callbacks) {
      try {
        await (app as any).commands.executeCommandById(commandId)
      } catch (error) {
        console.error(`Failed to execute callback command: ${commandId}`, error)
      }
    }
  }
}
