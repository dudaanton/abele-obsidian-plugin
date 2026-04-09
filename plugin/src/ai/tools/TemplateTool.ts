import type { AgentTool } from '../client'
import { TemplateService } from '@/templates/TemplateService'
import { parseTemplateVariables } from '@/templates/TemplateParser'
import { ScopeResolver } from '../ScopeResolver'

export function createListTemplatesTool(): AgentTool {
  return {
    name: 'list_templates',
    label: 'List Templates',
    description:
      'List available note templates. Returns template names, types, paths, and required user variables. Use before apply_template to discover what templates exist.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Filter by template_for type (e.g. "place", "book"). Omit to list all.',
        },
      },
    },
    execute: async (_id, params) => {
      const service = TemplateService.getInstance()
      const filterType = params.type as string | undefined

      const templates = filterType
        ? service.getTemplatesByType(filterType)
        : service.getNonDefaultTemplates()

      if (templates.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: filterType
                ? `No templates found for type "${filterType}".`
                : 'No templates found in the vault.',
            },
          ],
        }
      }

      const entries = await Promise.all(
        templates.map(async (t) => {
          const body = await t.getBody()
          const { userVariables } = parseTemplateVariables(body)
          const vars = userVariables.map((v) => v.name)

          let line = `- **${t.name}** (${t.templateFor})`
          if (t.templateDir) line += ` [${t.templateDir}]`
          line += `\n  path: ${t.file.path}`
          if (vars.length) line += `\n  variables: ${vars.join(', ')}`
          return line
        })
      )

      return {
        content: [
          {
            type: 'text',
            text: `${templates.length} templates:\n\n${entries.join('\n\n')}`,
          },
        ],
      }
    },
  }
}

export function createApplyTemplateTool(): AgentTool {
  return {
    name: 'apply_template',
    label: 'Apply Template',
    description:
      'Create a new note from a template. Provide the template file path and values for any user variables. Date variables are resolved automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault path to the template file' },
        variables: {
          type: 'object',
          description: 'Values for user variables (name → value). Omit if no user variables.',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['path'],
    },
    execute: async (_id, params) => {
      const path = params.path as string
      if (!path) throw new Error('Missing required parameter: path')

      const service = TemplateService.getInstance()
      const templates = service.discoverTemplates()
      const template = templates.find((t) => t.file.path === path)
      if (!template) throw new Error(`Template not found: ${path}`)

      const vars = (params.variables as Record<string, string>) || {}
      const userValues = new Map(Object.entries(vars))

      const file = await service.createNoteFromTemplate(template, userValues)
      ScopeResolver.getInstance().addFile(file.path)

      return {
        content: [{ type: 'text', text: `Created: ${file.path}` }],
      }
    },
  }
}
