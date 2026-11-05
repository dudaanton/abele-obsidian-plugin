import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const template = fileURLToPath(new URL('./app-launcher.py', import.meta.url))

export async function deployAppLauncher(runRoot, { executable, registry }) {
  if (![runRoot, executable, registry].every(isAbsolute)) throw new Error('Absolute launcher locations required')
  const app = join(resolve(runRoot), 'launch-app.py')
  await writeFile(app, await readFile(template), { mode: 0o700 })
  await writeFile(join(runRoot, 'app-launcher.json'), JSON.stringify({ executable, registry }))
  return app
}

export async function verifyAppLauncher(runRoot, configPath, python = 'python3') {
  const app = join(resolve(runRoot), 'launch-app.py')
  // Check bytes before execution: a legacy launcher may ignore --check-binding.
  if (!(await readFile(app)).equals(await readFile(template)))
    throw new Error('Deployed app launcher differs from the checked template')
  try {
    const result = await exec(python, [app, '--check-binding', resolve(configPath)], { timeout: 10000 })
    const receipt = JSON.parse(result.stdout)
    if (receipt.category !== 'launcher-binding-verified' || receipt.runRoot !== resolve(runRoot) ||
        receipt.config !== resolve(configPath) || receipt.lease !== join(resolve(runRoot), 'lease.json') ||
        receipt.launchRequested !== false) throw new Error('invalid receipt')
    return receipt
  } catch {
    throw new Error('App launcher binding refused')
  }
}
