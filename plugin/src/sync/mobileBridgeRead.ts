import { boundedNativeRead } from './nativeReadDeadline'
import { observePortableIo } from './portableIoDiagnostics'
import { waitForSyncRead } from './syncTaskBudget'

/** Only read-only bridge calls: abandoning a waiter never authorizes a mutation. */
export function mobileBridgeRead<T>(
  operation: string,
  path: string,
  read: () => PromiseLike<T>,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted()
  return waitForSyncRead(
    boundedNativeRead(
      observePortableIo('bridge ' + operation, path, read),
      'mobile bridge ' + operation
    ),
    signal
  )
}
