/** Keep facade, schemas, transaction checks and the error prototype from the same core input.
 * In particular, an adapter's definite abort must not fail an instanceof check in the facade. */
export {
  ExternalState,
  ExternalStateError,
  EXTERNAL_STATE_KEY,
  checkExternalPhase,
  prepareExternalLedger,
  decodeExternalDocument,
  type ExternalStateReason,
  type ExternalLedgerChanges,
  type ExternalPhaseBatch,
  type ExternalStatePort,
  type ExternalChange,
} from '@abele/sync-core'
