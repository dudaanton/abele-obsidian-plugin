import { ref } from 'vue'
import { MarkdownView } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { UserTemplate } from '@/templates/UserTemplate'
import { TemplateService } from '@/templates/TemplateService'
import { parseTemplateVariables, TemplateVariable } from '@/templates/TemplateParser'
import { openFile } from '@/helpers/vaultUtils'

export type TemplateAction = 'create' | 'replace' | 'insert'

/**
 * Composable for managing template selection and application flow
 */
export function useTemplates() {
  const isSelectModalOpen = ref(false)
  const isVariablesModalOpen = ref(false)
  const templates = ref<UserTemplate[]>([])
  const selectedTemplate = ref<UserTemplate | null>(null)
  const userVariables = ref<TemplateVariable[]>([])
  const initialValues = ref<Map<string, string>>(new Map())
  const action = ref<TemplateAction>('create')

  /**
   * Start the template flow for creating a new note
   */
  async function startCreateFlow(selection?: string) {
    const service = TemplateService.getInstance()
    action.value = 'create'
    templates.value = service.getNonDefaultTemplates()
    initialValues.value = selection ? new Map([['selection', selection]]) : new Map()
    isSelectModalOpen.value = true
  }

  /**
   * Start the template flow for replacing current note
   */
  async function startReplaceFlow(selection?: string) {
    const service = TemplateService.getInstance()
    const { app } = GlobalStore.getInstance()
    const activeFile = app.workspace.getActiveFile()

    if (!activeFile) {
      console.warn('No active file to replace')
      return
    }

    action.value = 'replace'
    templates.value = service.getNonDefaultTemplates()
    initialValues.value = selection ? new Map([['selection', selection]]) : new Map()
    isSelectModalOpen.value = true
  }

  /**
   * Start the template flow for inserting at cursor
   */
  async function startInsertFlow(selection?: string) {
    const service = TemplateService.getInstance()
    action.value = 'insert'
    templates.value = service.getNonDefaultTemplates()
    initialValues.value = selection ? new Map([['selection', selection]]) : new Map()
    isSelectModalOpen.value = true
  }

  /**
   * Handle template selection from modal
   */
  async function onTemplateSelected(template: UserTemplate) {
    selectedTemplate.value = template
    isSelectModalOpen.value = false

    // Parse template to find user variables
    const body = await template.getBody()
    const { userVariables: parsedVars } = parseTemplateVariables(body)

    // Also parse target_folder and target_name for variables
    if (template.targetFolder) {
      const { userVariables: folderVars } = parseTemplateVariables(template.targetFolder)
      for (const v of folderVars) {
        if (!parsedVars.find((uv) => uv.name === v.name)) {
          parsedVars.push(v)
        }
      }
    }
    if (template.targetName) {
      const { userVariables: nameVars } = parseTemplateVariables(template.targetName)
      for (const v of nameVars) {
        if (!parsedVars.find((uv) => uv.name === v.name)) {
          parsedVars.push(v)
        }
      }
    }

    userVariables.value = parsedVars

    // If selection provided and only one variable, auto-fill first variable
    const selection = initialValues.value.get('selection')
    if (selection && parsedVars.length > 0) {
      initialValues.value.set(parsedVars[0].name, selection)
    }

    // If no user variables or all auto-filled with single variable
    if (parsedVars.length === 0) {
      await applyTemplate(new Map())
    } else if (parsedVars.length === 1 && selection) {
      // Single variable auto-filled from selection
      await applyTemplate(initialValues.value)
    } else {
      // Show variables modal
      isVariablesModalOpen.value = true
    }
  }

  /**
   * Handle variables confirmation from modal
   */
  async function onVariablesConfirmed(values: Map<string, string>) {
    isVariablesModalOpen.value = false
    await applyTemplate(values)
  }

  /**
   * Apply the selected template with given values
   */
  async function applyTemplate(userValues: Map<string, string>) {
    const service = TemplateService.getInstance()
    const template = selectedTemplate.value
    if (!template) return

    const { app } = GlobalStore.getInstance()

    try {
      switch (action.value) {
        case 'create': {
          const file = await service.createNoteFromTemplate(template as UserTemplate, userValues)
          await openFile(file.path)
          break
        }

        case 'replace': {
          const activeFile = app.workspace.getActiveFile()
          if (activeFile) {
            await service.replaceNoteWithTemplate(template as UserTemplate, activeFile, userValues)
          }
          break
        }

        case 'insert': {
          const content = await service.insertTemplateAtCursor(template as UserTemplate, userValues)
          const view = app.workspace.getActiveViewOfType(MarkdownView)
          if (view?.editor) {
            const editor = view.editor
            const cursor = editor.getCursor()
            editor.replaceRange(content, cursor)
          }
          break
        }
      }
    } catch (error) {
      console.error('Failed to apply template:', error)
    } finally {
      resetState()
    }
  }

  /**
   * Close modals and reset state
   */
  function closeModals() {
    isSelectModalOpen.value = false
    isVariablesModalOpen.value = false
  }

  /**
   * Reset all state
   */
  function resetState() {
    isSelectModalOpen.value = false
    isVariablesModalOpen.value = false
    templates.value = []
    selectedTemplate.value = null
    userVariables.value = []
    initialValues.value = new Map()
    action.value = 'create'
  }

  return {
    isSelectModalOpen,
    isVariablesModalOpen,
    templates,
    selectedTemplate,
    userVariables,
    initialValues,
    action,
    startCreateFlow,
    startReplaceFlow,
    startInsertFlow,
    onTemplateSelected,
    onVariablesConfirmed,
    closeModals,
    resetState,
  }
}

// Singleton instance for global access
let templateComposable: ReturnType<typeof useTemplates> | null = null

export function getTemplateComposable() {
  if (!templateComposable) {
    templateComposable = useTemplates()
  }
  return templateComposable
}
