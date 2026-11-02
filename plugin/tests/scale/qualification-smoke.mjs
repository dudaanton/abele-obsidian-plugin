/** Readiness to measure the full fixture is separate from the smoke's strict verdict.
 * Attribution failures stay FAIL in both reports; they are a full-run measurement,
 * not a fatal product state. Every other smoke invariant must already pass.
 */
export function canContinueQualificationFromSmoke(report, expectedChecks) {
  return (
    report?.phase === 'complete' &&
    report.verificationComplete === true &&
    report.verifiedFiles === expectedChecks &&
    report.mismatches?.length === 0 &&
    report.failures?.length === 0 &&
    !report.failure &&
    !report.fatalDiagnostic &&
    !report.fatalDiagnostics?.length &&
    !report.errorObservations?.length &&
    Array.isArray(report.budgets) &&
    report.budgets.length > 0 &&
    report.budgets.every(
      (row) =>
        row.status === 'PASS' || (row.name === 'long task attribution' && row.status === 'FAIL')
    )
  )
}
