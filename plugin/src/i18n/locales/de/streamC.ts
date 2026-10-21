export const streamC = {
  'debug.requestsImporting': 'Anfragen werden importiert…',
  'debug.httpIncoming': 'Eingehend',
  'debug.httpOutgoing': 'Ausgehend',
  'debug.httpOpenRecorded': 'Aufgezeichnete Anfrage öffnen',

  'debug.requestsBrowserOnly':
    'Anfragen werden von einem verbundenen Browser aufgezeichnet. Dieser Knoten erfasst keine HTTP-Anfragen, die das Programm empfängt oder sendet.',
  'debug.referencesTextFallback': 'Verweise auf {name} suchen (Textsuche als Ersatz)',
  'sync.phone.offline': 'Synchronisierung: Server nicht verfügbar',
  'sync.phone.error': 'Synchronisierung erfordert Aufmerksamkeit',
  'sync.phone.held': 'Synchronisierung: Löschungen zurückgehalten',
  'sync.phone.conflicts': {
    one: 'Synchronisierung: {count} Konfliktkopie',
    other: 'Synchronisierung: {count} Konfliktkopien',
  },
  'sync.phone.review': 'Synchronisierung: {count} warten auf dich',
  'sync.window.progress': '{completed} von {total}',
  'sync.window.notSent': 'Nicht gesendet',
  'sync.window.conflicts': 'Konfliktkopien',
  'sync.window.conflictsDesc':
    'Beide Versionen bleiben erhalten. Öffne die Kopie, übernimm das Benötigte und lösche sie anschließend.',
  'sync.window.openCopy': 'Konfliktkopie öffnen',
  'sync.window.waiting': 'Wartet auf dich',
  'sync.window.trusted': 'Vertrauenswürdig',
  'sync.window.trustedDesc':
    'Installiert eingehenden Code automatisch und teilt verknüpfte private Dateien auf diesem Gerät ohne Rückfrage.',
  'sync.window.recent': 'Zuletzt',
  'sync.window.recentDesc':
    'Hier werden die letzten Aktivitäten dieser Sitzung angezeigt. Öffne die Synchronisierungseinstellungen über die Befehlspalette für die Diagnose.',
  'sync.window.disconnect': 'Trennen…',
  'sync.window.disconnectTip': 'Diese Verbindung beenden; die Dateien bleiben auf diesem Gerät',
  'sync.window.close': 'Schließen',
  'sync.window.closeTip': 'Dieses Fenster schließen',
  'sync.window.share': 'Teilen…',
  'sync.window.shareTip':
    'Einen Ordner oder eine Gruppe mit jemandem teilen oder ein weiteres eigenes Gerät verbinden',
  'sync.window.error':
    'Die Aktion konnte nicht abgeschlossen werden. Ausstehende Änderungen bleiben erhalten.',
  'sync.status.disconnected': 'Nicht verbunden',
  'sync.status.joining': 'Verbindung wird hergestellt',
  'sync.status.idle': 'Vollständig synchronisiert',
  'sync.status.syncing': 'Synchronisierung läuft',
  'sync.status.paused': 'Pausiert',
  'sync.status.offline': 'Offline',
  'sync.status.error': 'Synchronisierungsfehler',
  'sync.status.held': 'Löschungen zurückgehalten',
  'sync.status.review': 'Zu prüfen',
  'sync.status.waiting': 'Wartet',
  'sync.status.conflicts': { one: '{count} Konflikt', other: '{count} Konflikte' },
  'sync.status.heldLine': {
    one: 'Die Löschung von {count} Datei auf diesem Gerät wurde noch nicht an die anderen Geräte gesendet, weil so viele auf einmal gelöscht wurden. Entscheide im Tab Synchronisierung, ob sie überall gelöscht oder wiederhergestellt werden.',
    other:
      'Die Löschung von {count} Dateien auf diesem Gerät wurde noch nicht an die anderen Geräte gesendet, weil so viele auf einmal gelöscht wurden. Entscheide im Tab Synchronisierung, ob sie überall gelöscht oder wiederhergestellt werden.',
  },
  'sync.status.stagedLine':
    'Wartende Einstellungen ({count}) — im Tab Synchronisierung anwenden und neu laden.',
  'sync.status.changesAre': { one: '{count} Änderung wartet', other: '{count} Änderungen warten' },
  'sync.status.title': 'Abele Sync: {status}',
  'sync.status.found': {
    one: '{count} Änderung zum Senden gefunden',
    other: '{count} Änderungen zum Senden gefunden',
  },
  'sync.status.unsent': {
    one: '{count} Änderung wartet auf das Senden',
    other: '{count} Änderungen warten auf das Senden',
  },
  'sync.status.copies': {
    one: '{count} Konfliktkopie wurde neben dem Original gespeichert. Öffne sie im Tab Synchronisierung.',
    other:
      '{count} Konfliktkopien wurden neben dem Original gespeichert. Öffne sie im Tab Synchronisierung.',
  },
  'sync.status.decision': '{count} warten im Tab Synchronisierung auf deine Entscheidung.',
  'sync.status.connecting': 'Verbindung zum Synchronisierungsserver wird hergestellt.',
  'sync.status.last': 'Letzte Synchronisierung: {when}',
  'sync.when.never': 'nie',
  'sync.held.title': 'Löschungen zurückgehalten',
  'sync.held.later': 'Später entscheiden',
  'sync.held.laterTip':
    'Schließen; die Dateien bleiben zurückgehalten und die Frage bleibt im Tab Synchronisierung',
  'sync.arrived.title': 'Einstellungen auf einem anderen Gerät geändert',
  'sync.arrived.later': 'Später',
  'sync.arrived.laterTip': 'Schließen; die Einstellungen warten weiter im Tab Synchronisierung',
  'sync.qr.title': 'QR-Code lesen',
  'sync.qr.description': 'Fotografiere den Code mit dem Telefon oder wähle ein Bild davon.',
  'sync.qr.read': 'QR lesen…',
  'sync.qr.readTip': 'Kamera verwenden oder QR-Bild auswählen',
  'sync.qr.missing':
    'Kein Verbindungstoken gefunden. Halte die Kamera näher, damit der Code fast das ganze Bild ausfüllt, oder füge das Token ein.',
  'sync.qr.error':
    'Das Bild konnte nicht gelesen werden. Versuche ein anderes Bild oder füge das Token ein.',
} as const
