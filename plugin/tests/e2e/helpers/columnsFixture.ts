export const COLUMNS_FIXTURE_PREFIX = 'Sample columns probe '

export function columnsFixtureCleanup(folder: string, stale = false): string {
  return `
    const paths = app.vault.getAllLoadedFiles().filter(f => 'children' in f && f.parent === app.vault.getRoot() &&
      (f.path === ${JSON.stringify(folder)} || (${stale} && (f.path === ${JSON.stringify(COLUMNS_FIXTURE_PREFIX.trimEnd())} || f.path.startsWith(${JSON.stringify(COLUMNS_FIXTURE_PREFIX)}))))).map(f => f.path);
    for(const l of app.workspace.getLeavesOfType('markdown')) if(paths.some(p => l.view.file?.path?.startsWith(p + '/'))) l.detach();
    for(const path of paths) {const folder=app.vault.getAbstractFileByPath(path); if(folder) await app.vault.delete(folder,true)}
    return true;
  `
}
