import { readFile } from 'node:fs/promises'

// Idle and evidence persistence are separate acknowledgements from the renderer.
export async function waitForJsonExport(
  file,
  {
    read = (path) => readFile(path, 'utf8'),
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs = 30000,
  } = {}
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await read(file))
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    await delay(50)
  }
  throw new Error(`Timed out waiting for JSON evidence export: ${file}`)
}
