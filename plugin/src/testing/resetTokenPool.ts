export interface TokenPoolResetRequest {
  vault: string
  confirm: string
}
export interface TokenPoolResetPorts {
  vault: string
  stop(): Promise<void>
  databases(): string[] | Promise<string[]>
  removeDatabase(name: string): Promise<void>
  forget(): Promise<void>
  restart(): Promise<void>
}
export async function resetTokenPool(
  ports: TokenPoolResetPorts,
  request: TokenPoolResetRequest
): Promise<void> {
  if (
    !request.vault ||
    request.vault !== ports.vault ||
    request.confirm !== 'reset-sync-token-state'
  )
    throw new Error('Exact leased pool vault and reset-sync-token-state confirmation required')
  const databases = [...new Set(await ports.databases())]
  await ports.stop()
  const failures: unknown[] = []
  for (const name of databases) {
    try {
      await ports.removeDatabase(name)
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length)
    throw new AggregateError(failures, 'Token pool reset failed; ownership retained for retry')
  await ports.forget()
  await ports.restart()
}
