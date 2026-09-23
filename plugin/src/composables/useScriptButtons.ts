import { computed, unref, type ComputedRef, type Ref } from 'vue'
import { AbeleConfig, type HeaderButtonDefinition } from '@/services/AbeleConfig'
import { buttonParams, buttonsForNote, noteVariables } from '@/helpers/headerButtons'
import { runScriptByName } from '@/scripting/runScript'

/**
 * The script buttons a note's header shows, and pressing one.
 *
 * Shared by the ordinary header and a task's own, so a button configured for `task` shows on a
 * task too. The settings object is not reactive; reading its `version` is what redraws the
 * buttons when they are configured, or when settings arrive from another device.
 */
export function useScriptButtons(
  filePath: Ref<string> | ComputedRef<string>,
  noteType: Ref<string | null> | ComputedRef<string | null>
) {
  const scriptButtons = computed(() => {
    const config = AbeleConfig.getInstance()
    void config.version.value
    return buttonsForNote(config.headerButtons, { type: unref(noteType), path: unref(filePath) })
  })

  const runButton = async (button: HeaderButtonDefinition) => {
    // The note is read at the moment the button is pressed rather than when it was drawn: what
    // the parameters describe is the note as it stands now.
    const params = buttonParams(button, noteVariables(unref(filePath)))
    await runScriptByName(button.scriptName, params)
  }

  return { scriptButtons, runButton }
}
