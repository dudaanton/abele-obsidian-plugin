import type { App } from 'obsidian'
import { noteLocalScriptWrite } from '../ScriptTrust'
import { noteAgentScriptWrite } from './agentScriptWrites'
import { confirmAgentScript } from './agentScriptWrites'
import { isScriptPath } from '../scriptPath'
import { assertScriptContext, scriptForExecution } from './scriptExecutionGate'

/** Script API callers already have code-execution authority. Ordinary file tools do not. */
export function noteFileToolScriptWrite(
  app: App,
  path: string,
  text: string,
  scriptAuthor = false
): Promise<void> {
  return scriptAuthor ? noteLocalScriptWrite(path, text) : noteAgentScriptWrite(app, path, text)
}

/** Copying already executable owner code retains that exact content's authority. A staged
 * non-script file and a pending agent script cannot manufacture this receipt. */
export async function noteFileToolScriptCopy(
  app: App,
  from: string,
  to: string,
  content: string | ArrayBuffer
): Promise<void> {
  if (!to.endsWith('.js')) return
  if (isScriptPath(from)) {
    try {
      const original = await scriptForExecution(app, from)
      assertScriptContext(app, original)
      confirmAgentScript(app, original.hash)
    } catch {
      // Copying unapproved code is allowed, but it receives no execution authority.
    }
  }
  await noteAgentScriptWrite(app, to, content)
}
