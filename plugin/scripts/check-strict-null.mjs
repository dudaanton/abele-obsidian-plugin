import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function validateFolders(folders) {
  if (!Array.isArray(folders) || !folders.length)
    throw new Error('Strict null folders must be a nonempty list')
  for (const folder of folders) {
    if (typeof folder !== 'string' || !/^[\w-]+(?:\/[\w-]+)*$/.test(folder))
      throw new Error(`Invalid strict null folder: ${folder}`)
    if (folders.filter((other) => other === folder || folder.startsWith(`${other}/`)).length !== 1)
      throw new Error(`Overlapping strict null folder: ${folder}`)
  }
  return folders
}

/** Check the complete program with strict nulls, enforce every diagnostic in selected folders. */
export function checkedDiagnostics(program, sourceRoot, folders) {
  validateFolders(folders)
  return ts.getPreEmitDiagnostics(program).filter((diagnostic) => {
    // Global/configuration diagnostics have no owning folder and must never be hidden.
    if (!diagnostic.file) return true
    const path = relative(sourceRoot, diagnostic.file.fileName).split(sep).join('/')
    return folders.some((folder) => path.startsWith(`${folder}/`))
  })
}

export function checkStrictNull(root = plugin, buildInfo) {
  const folders = validateFolders(
    JSON.parse(readFileSync(resolve(root, 'strict-null-folders.json'), 'utf8'))
  )
  const configPath = resolve(root, 'tsconfig.json')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) return { folders, diagnostics: [config.error] }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    root,
    {
      strictNullChecks: true,
      noEmit: true,
      skipLibCheck: true,
      ...(buildInfo ? { incremental: true, tsBuildInfoFile: buildInfo } : {}),
    },
    configPath
  )
  if (parsed.errors.length) return { folders, diagnostics: parsed.errors }
  for (const folder of folders) {
    if (
      !parsed.fileNames.some((file) =>
        relative(resolve(root, 'src'), file).split(sep).join('/').startsWith(`${folder}/`)
      )
    )
      throw new Error(`Strict null folder has no TypeScript files: ${folder}`)
  }
  const program = buildInfo
    ? ts.createIncrementalProgram({
        rootNames: parsed.fileNames,
        options: parsed.options,
        projectReferences: parsed.projectReferences,
      })
    : ts.createProgram({
        rootNames: parsed.fileNames,
        options: parsed.options,
        projectReferences: parsed.projectReferences,
      })
  const diagnostics = checkedDiagnostics(program, resolve(root, 'src'), folders)
  // noEmit still emits build info; using the builder for diagnostics preserves its cache.
  if (buildInfo) program.emit()
  return { folders, diagnostics }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { cacheEntry, compilerCacheKey } = await import('./check-cache.mjs')
  const configPath = resolve(plugin, 'tsconfig.json')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(
    config.config ?? {},
    ts.sys,
    plugin,
    { strictNullChecks: true, noEmit: true, skipLibCheck: true },
    configPath
  )
  const cache =
    process.env.ABELE_CHECK_CACHE_DIR && process.env.ABELE_CHECK_COLD !== '1'
      ? cacheEntry(
          resolve(plugin, '..'),
          'strict-null',
          compilerCacheKey(resolve(plugin, '..'), 'strict-null', {
            options: parsed.options,
            folders: readFileSync(resolve(plugin, 'strict-null-folders.json'), 'utf8'),
          })
        )
      : null
  let result
  try {
    result = checkStrictNull(plugin, cache?.path)
    cache?.release(result.diagnostics.length === 0)
  } finally {
    cache?.release()
  }
  const { folders, diagnostics } = result
  if (diagnostics.length) {
    console.error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        getCanonicalFileName: (file) => file,
        getNewLine: () => '\n',
      })
    )
    process.exitCode = 1
  } else console.log(`strict null checks: ${folders.join(', ')}`)
}
