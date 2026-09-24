/**
 * Which saved tool descriptions are the person's own.
 *
 * A saved description replaces the tool's own one. Settings used to save every default with the
 * rest, so a vault kept the descriptions of whichever version first saved it and an agent there
 * never saw a tool described better later. Settings now hold overrides only: a saved description
 * that matches the tool's current description or any default the plugin ever shipped is not
 * an override, and is dropped on load.
 *
 * Kept free of imports, so the settings can use it while loading without pulling the tools in.
 */

/**
 * Every default description ever shipped in the settings, by tool — collected from the history
 * of `DEFAULT_AI_SETTINGS.prompts.toolDescriptions`, the only place they were defined. The
 * defaults now live in the tools themselves; add nothing here unless it was once saved as one.
 */
export const SHIPPED_TOOL_DESCRIPTIONS: Readonly<Record<string, readonly string[]>> = {
  apply_template: [
    'Create a new note from a template. Provide the template path and values for user variables.',
  ],
  chart_docs: [
    'Get the reference for creating abele-chart codeblocks with chart types, data formats, and formula syntax.',
  ],
  cp: ['Copy a file to a new location. Source must be in workspace scope.'],
  create: ['Create a new file in the vault with the specified content.'],
  create_script: ['Create a new JavaScript script in the scripts folder.'],
  delegate: [
    'Delegate repetitive tasks to sub-agents for parallel processing. Each item gets a fresh context. Use for batch operations on many items.',
  ],
  download_file: [
    'Download any file from a URL and save it to the vault attachments folder. Returns the saved file path.',
  ],
  download_image: [
    'Download an image from a URL and save it to the vault attachments folder. Returns the saved file path.',
  ],
  edit: [
    'Edit a file by replacing an exact string match with new content. File must be in workspace scope.',
  ],
  edit_image: [
    'Edit an existing vault image using a text prompt. Provide the source image path and editing instructions. Returns the path of the edited image.',
  ],
  eval_js: [
    'Execute JavaScript code in a sandbox for calculations, data processing, or string manipulation. No file/network/DOM access.',
  ],
  fetch: [
    'Send an HTTP request to any URL. Supports all methods, custom headers, and request body. Returns status code and response.',
  ],
  find: [
    'Search for files within workspace scope by name pattern, frontmatter property, or content text.',
  ],
  generate_image: [
    'Generate an image from a text prompt. The image is saved to the vault attachments folder. Returns the path of the saved image.',
  ],
  list_templates: [
    'List available note templates. Shows names, types, and required variables. Use before apply_template.',
  ],
  ls: [
    'List files and subdirectories in a folder. Only shows items within workspace scope. Use without path to list scope root folders.',
  ],
  mv: ['Move or rename a file. Source must be in workspace scope.'],
  open: ['Open a file in the Obsidian editor.'],
  read: [
    'Read the content of a file. Only files within the current workspace scope are accessible.',
  ],
  read_backlinks: ['Read notes linked to a note through groups (transitive backlinks).'],
  read_image: [
    'Load an image so you can see its contents. Images in workspace scope are loaded automatically; others require user approval.',
  ],
  read_logs: ['Read log entries related to a note.'],
  read_tasks: ['Read tasks, optionally filtered by note, date period, and completion status.'],
  read_transactions: ['Read financial transactions, optionally filtered by note and date period.'],
  replace: [
    'Apply batch replacement actions to a file: set/remove properties, add/remove list items, replace in content or properties, move file. Supports regex.',
  ],
  rm: ['Delete a file (moves to trash). File must be in workspace scope.'],
  script_api_docs: [
    'Get the full API reference for writing Abele scripts. Call before create_script.',
  ],
  web_search: ['Search the web using Brave Search. Returns titles, URLs, and descriptions.'],
  wise_model: [
    'Consult a more powerful AI model for complex analysis, evaluation, or reasoning. Use when the task requires deeper expertise.',
  ],
  workspace: [
    'Show all files currently accessible in the workspace scope. Use this to understand what files you can work with.',
  ],
}

/** Whitespace is not what makes a description the person's. */
export const normaliseDescription = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Whether `text` is a default for tool `name`: shipped once, or what the tool says now. */
export function isDefaultDescription(name: string, text: string, current?: string): boolean {
  const t = normaliseDescription(text)
  if (!t) return true
  if (current !== undefined && normaliseDescription(current) === t) return true
  return (SHIPPED_TOOL_DESCRIPTIONS[name] ?? []).some((old) => normaliseDescription(old) === t)
}

/**
 * The saved descriptions that are overrides, and how many were not. `current` is what each tool
 * says of itself now, where it is known.
 */
export function pruneToolDescriptions(
  saved: Record<string, unknown> | undefined,
  current: Record<string, string> = {}
): { kept: Record<string, string>; dropped: number } {
  const kept: Record<string, string> = {}
  let dropped = 0
  for (const [name, text] of Object.entries(saved ?? {})) {
    if (typeof text === 'string' && !isDefaultDescription(name, text, current[name])) {
      kept[name] = text
    } else dropped++
  }
  return { kept, dropped }
}
