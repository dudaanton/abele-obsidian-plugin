import type { TranslationCatalog } from '../../catalogs'
export const de = {
  'settings.metadata.tracePointRemove': 'Aufzeichnungspunkt entfernen',
  'requests.file.formUnsupported':
    'Dieses Formularfeld kann nicht in einer Bruno-Datei dargestellt werden',
  'requests.file.secretPending':
    'Beim Speichern der Umgebung gab es einen Konflikt oder das Ergebnis steht aus; aktualisiere vor einem erneuten Versuch',
  'requests.file.secretChecked':
    'Die vorherige Geheimnisübertragung wurde geprüft; prüfe vor einem erneuten Versuch die aktualisierte Umgebung',
  'requests.file.sensitiveUnavailable': 'Das Schreiben sensibler Dateien ist nicht verfügbar',
  'requests.file.pendingEdit': 'Prüfe zuerst die ausstehende Dateiänderung',
  'requests.file.methodProblem': 'HTTP-Methode und Adresse erwartet',
  'requests.file.headerProblem': 'Headername und Doppelpunkt erwartet',

  'requests.file.sending': 'wird gesendet…',
  'requests.file.notSent': 'nicht gesendet',
  'requests.file.openAnswer': '{name} mit Antwort öffnen',

  'requests.file.problem': 'Ein Teil der Datei konnte nicht gelesen werden',
  'requests.file.sendAll': 'Alle der Reihe nach senden',
  'requests.file.open': 'Datei öffnen',
  'requests.file.line': 'Zeile {line}: {text}',
  'requests.file.openLine': 'Datei in Zeile {line} öffnen',
  'requests.file.at': '{file} · Zeile {line}',
  'requests.file.gone': '{file} ist nicht mehr vorhanden',
  'requests.capture.title': 'Aus Antworten',
  'requests.env.exposed': 'ein Geheimnis in {file}',
  'requests.env.toKeys': 'Zu Schlüsseln verschieben',
  'requests.capture.notSent': '{name} wurde noch nicht gesendet',
  'requests.capture.sendFirst': '{name} senden',
  'requests.capture.blocked': 'Zuerst {name} senden: Diese Anfrage verwendet dessen Antwort',
  'requests.file.saveCopy': 'Kopie in Anfragen speichern',
  'requests.file.openPanel': 'In Anfragen öffnen',
  'requests.file.scriptShown': 'Dieses Skript wird als Quelltext angezeigt und nicht ausgeführt.',

  'settings.ai.apiMode': 'API',
  'settings.ai.apiModeDescription':
    'API dieses Anbieters. Bestehende Verbindungen verwenden Chat Completions.',
  'settings.ai.chatCompletions': 'Chat Completions',
  'settings.ai.responses': 'Responses',

  'node.analysis.contentUnavailable': 'Der Dateiinhalt ist für die Analyse nicht verfügbar.',

  'node.analysis.nodeUnsupported': 'Codeanalyse ist auf diesem Knoten nicht verfügbar.',
  'node.analysis.fileTooLarge': 'Die Datei ist zu groß für die Analyse (Grenze: 512 KiB).',
  'node.analysis.noServers': 'Kein Sprachserver hat diese Datei angenommen.',
  'node.analysis.noConnection': 'Keine Verbindung zu diesem Knoten verfügbar.',
  'node.analysis.pastRevision': 'Diese Ansicht zeigt eine frühere Version.',
  'node.analysis.comparison': 'Öffne die Dateiansicht zur Codeanalyse.',
  'node.analysis.unsupportedFile': 'Die Codeanalyse unterstützt diesen Dateityp nicht.',
  'node.analysis.documentLimit':
    'Der Knoten hat die Grenze für Analysedokumente erreicht. Schließe andere Codedateien und versuche es erneut.',

  'node.loading.changes': 'Änderungen werden geladen…',
  'node.loading.history': 'Verlauf wird geladen…',
  'node.loading.files': 'Dateien werden geladen…',
  'node.loading.updatingChanges': 'Änderungen werden aktualisiert…',
  'node.loading.updatingFiles': 'Dateien werden aktualisiert…',
  'node.loading.slow': 'Dateien werden noch gelesen… bisher {loaded}',

  'node.error.readingFile': '{path} lesen',
  'node.log.truncated': 'Nur der neueste Teil des Protokolls wird angezeigt.',
  'node.log.missing': 'Auf diesem Knoten sind keine Protokolldateien verfügbar.',
  'node.log.unavailable': 'Der Knoten konnte seine Protokolldateien nicht lesen.',
  'node.log.unknownTime': 'Unbekannte Zeit',
  'node.state.offline': 'Der Knoten ist offline.',
  'node.state.reconnecting': 'Der Knoten ist offline. Verbindung wird wiederhergestellt…',
  'node.state.slow': 'Der Knoten antwortet langsam. Bitte warten…',
  'node.action.retry': 'Erneut versuchen',
  'node.action.refresh': 'Aktualisieren',
  'node.action.reconnect': 'Erneut verbinden',
  'node.action.trust': 'Diesem Ordner vertrauen…',
  'node.action.pair': 'Erneut koppeln',
  'node.action.settings': 'Knoteneinstellungen',
  'node.action.update': 'So aktualisierst du',
  'node.action.install': 'So installierst du',
  'node.error.copyDetails': 'Details kopieren',
  'node.error.code': 'Code',
  'node.error.what': 'Vorgang',
  'node.error.where': 'Ort',
  'node.error.when': 'Zeit',
  'node.error.original': 'Ursprüngliche Aktion',
  'node.log.title': 'Knotenprotokoll',
  'node.log.all': 'Alle Zeilen',
  'node.log.warnings': 'Warnungen und Fehler',
  'node.log.filter': 'Welche Zeilen',
  'node.log.copy': 'Sichtbares kopieren',
  'node.log.offline':
    'Das Protokoll kann gelesen werden, sobald der Knoten online ist. Unten stehen die zuvor geladenen Einträge.',
  'node.log.empty': 'Keine Protokolleinträge.',
  'node.log.loading': 'Knotenprotokoll wird geladen…',
  'node.error.ownerOnly': 'Nur der Eigentümer des Knotens kann diesem Ordner vertrauen.',
  'node.error.gitTimeout':
    'Git auf dem Knoten hat nicht rechtzeitig geantwortet. Der Computer des Knotens ist möglicherweise ausgelastet.',
  'node.error.operationTimeout':
    'Der Vorgang auf dem Knoten wurde nicht rechtzeitig abgeschlossen. Der Computer des Knotens ist möglicherweise ausgelastet.',
  'node.error.connectionTimeout':
    'Die Verbindung zum Knoten wurde nicht rechtzeitig hergestellt. Der Computer des Knotens ist möglicherweise ausgelastet.',
  'node.error.controlTimeout':
    'Die lokale Knotensteuerung hat nicht rechtzeitig geantwortet. Der Computer des Knotens ist möglicherweise ausgelastet.',
  'node.error.tooOld':
    'Diese Knotenversion unterstützt diesen Vorgang nicht. Aktualisiere den Knoten.',
  'node.error.providerMissing':
    'Der benötigte Anbieter ist auf dem Knoten nicht verfügbar. Prüfe, ob er installiert und eingerichtet ist.',
  'node.file.waitingForNode': 'Die Datei wird geöffnet, sobald der Knoten wieder erreichbar ist.',
  'node.file.retry': 'Erneut versuchen',
  'node.error.details': 'Details',
  'node.analysis.restart': 'Analyse neu starten',
  'node.analysis.stopped': 'gestoppt: {reason}',

  'node.analysis.title': 'Codeanalyse',
  'node.analysis.untrusted': 'Ordner nicht vertrauenswürdig',
  'node.analysis.notSetUp': 'in diesem Projekt nicht eingerichtet',
  'node.analysis.failed': 'fehlgeschlagen',
  'node.analysis.starting': 'wird gestartet',
  'node.analysis.running': 'läuft',
  'node.analysis.loading': 'Codeanalyse wird gestartet…',
  'node.analysis.off': 'Codeanalyse ist für diese Datei deaktiviert',
  'node.analysis.error': 'Codeanalyse fehlgeschlagen',
  'node.analysis.trustNeeded': 'Codeanalyse: Ordner nicht vertrauenswürdig',
  'node.analysis.typescriptOnly': 'Codeanalyse: nur TypeScript. ESLint ist nicht eingerichtet.',
  'node.analysis.summary': 'Codeanalyse: {names}',
  'node.analysis.trust': 'Diesem Ordner vertrauen…',
  'node.analysis.eslintHelp': 'ESLint einrichten',

  'node.manager.failed': 'Befehl fehlgeschlagen',
  'node.manager.applied': 'Änderungen angewendet',
  'node.manager.cancelled': 'Abgebrochen',
  'node.manager.running': 'Wird ausgeführt',
  'node.commit.refresh': 'Aktualisieren',
  'node.manager.contextUpdate':
    'Aktualisiere den Knoten auf 0.4.47 oder neuer, um Befehle aus diesem Chat auszuführen.',
  'node.manager.notSubmitted': 'Der Befehl wurde nicht zur Ausführung übermittelt: {reason}',
  'node.manager.permissionChanged':
    'Die Befehlsberechtigungen haben sich geändert. Fordere den Befehl erneut an.',

  'requests.refresh': 'Anfragen aktualisieren',
  'debug.launchUnknown':
    'Das Startergebnis ist unbekannt. Verbinde dich erneut und prüfe die Debug-Sitzungen vor einem weiteren Versuch.',
  'debug.launchMissing': 'Das Programm wurde nicht gefunden. Prüfe den Pfad relativ zum Ordner.',
  'debug.followNoMatches': 'Kein aufgezeichneter Schritt enthält diesen Wert.',
  'node.chat.deleteHint':
    'Diese Sitzung und ihren Chatverlauf vom Knoten löschen? Die Dateien in ihrem Ordner bleiben unverändert.',
  'node.search.invalidRegex': 'Prüfen Sie den regulären Ausdruck und versuchen Sie es erneut.',
  'node.lsp.locations': 'Fundstellen: {count}',
  'node.lsp.noLocations': 'Keine passenden Fundstellen',
  'node.lsp.count': 'Diagnosen: {count}',
  'node.lsp.loading': 'Code wird analysiert…',
  'node.lsp.error': 'Codeanalyse nicht verfügbar: {message}',
  'node.lsp.retry': 'Erneut versuchen',
  'node.lsp.untrusted':
    'Sprachserver benötigen die Erlaubnis, Projektcode in diesem Ordner auszuführen.',
  'node.lsp.trust': 'Ordner vertrauen',
  'node.lsp.missing': 'Sprachserver fehlt. Auf dem Knoten installieren:',
  'node.lsp.copy': 'Befehl kopieren',
  'node.lsp.install': 'Gängige Server installieren',
  'node.lsp.eslintMissing':
    'ESLint fehlt in diesem Projekt oder ist nicht konfiguriert. Die TypeScript-Analyse bleibt verfügbar.',
  'node.lsp.noDiagnostics': 'Keine Diagnosen',
  'node.lsp.references': 'Verwendungen von {name} suchen',

  'debug.stopAtStart': 'Beim Start anhalten',
  'debug.pausedAtStart': 'Beim Start angehalten',
  'node.disconnectRevokeNotice':
    'Dieses Gerät trennen und seinen Schlüssel auf dem Knoten widerrufen? Andere Geräte bleiben verbunden.',
  'node.tools.callPlace': 'auf {device}',
  'node.tools.askedAgent': 'Fragte {agent}',
  'node.tools.runner': 'Wird in Obsidian auf {device} ausgeführt',
  'node.tools.noRunner': 'Derzeit ist kein Gerät mit Obsidian mit dem Knoten verbunden',
  'node.tools.nodeAgent': 'Knoten-Agent',
  'node.tools.modes':
    'Aus = nicht verfügbar. Fragen = Zustimmung erforderlich. Auto = wird selbstständig ausgeführt.',
  'node.tools.waiting': 'Wartet auf Obsidian',
  'node.tools.executing': 'Wird in Obsidian ausgeführt',
  'node.tools.unknown':
    'Das Ergebnis der Aktion konnte nicht bestätigt werden. Prüfe die betroffenen Dateien, bevor du sie erneut anforderst.',
  'node.actionDeniedByOwner': 'Der Benutzer hat diese Aktion abgelehnt',
  'streamB.runSummary.move.done': 'Verschoben',
  'streamB.runSummary.move.running': 'Verschieben',
  'streamB.runSummary.move.waiting': 'Verschieben angefragt',
  'node.disconnectTokenNotice':
    'Die gespeicherte Verbindung dieses Geräts entfernen? Der Schlüssel auf dem Knoten bleibt gültig. Widerrufe den Geräteschlüssel in der Token-Liste des Knotens, um weiteren Zugriff damit zu verhindern.',
  'node.error.requestMissing': 'Diese Anfrage ist nicht mehr auf dem Knoten vorhanden.',
  'debug.frameSourceUnavailable': 'Für diesen Frame ist in diesem Ordner kein Quellcode verfügbar.',
  'node.delegation.updateRequired':
    'Dieser Node benötigt ein Update, um Aufgaben aus Chats anzunehmen',
  'node.files.directoryDeleteSummary': 'Ordner {path} mit {files} in {folders} löschen?',
  'node.files.directoryMoveSummary':
    'Ordner {path} mit {files} in {folders} nach {destination} verschieben?',
  'node.files.showFiles': 'Dateien anzeigen',
  'node.files.uncommitted': 'Nicht committet',
  'node.files.untracked': 'Nicht verfolgt',
  'node.files.gitStatusUnavailable': 'Git-Status nicht verfügbar',
  'node.files.gitRecoveryWarning':
    'Nicht committierte und nicht verfolgte Inhalte können nicht aus Git wiederhergestellt werden.',
  'node.files.fileCount': { one: '{count} Datei', other: '{count} Dateien' },
  'node.files.folderCount': { one: '{count} Ordner', other: '{count} Ordnern' },
  'node.files.renameAction': 'Umbenennen',
  'node.files.moveAction': 'Verschieben',
  'node.files.directoryConfirm':
    'Ordner {path} löschen? Alle aufgeführten Einträge werden entfernt:',
  'node.files.directoryMoveConfirm':
    'Ordner {path} nach {destination} verschieben? Alle aufgeführten Einträge werden verschoben:',
  'node.files.gitLock': 'Git-Arbeitsbaum-Sperre',
  'node.localRunning': 'AbeleNode läuft auf diesem Computer',
  'node.files.nameOnly': 'Geben Sie einen Dateinamen ohne Ordner ein.',
  'node.files.attachMessage':
    'Andere Worktrees dieses Repositorys anzeigen und Dateibearbeitung im ausgewählten Worktree erlauben? Agentenausführung erfordert weiterhin eine separate Zustimmung.',
  'node.files.saveLocked': 'Speichern ist hier gesperrt',
  'node.files.newFile': 'Neue Datei…',
  'node.files.newFolder': 'Neuer Ordner…',
  'node.files.rename': 'Umbenennen…',
  'node.files.move': 'Verschieben…',
  'node.files.delete': 'Löschen…',
  'node.files.deleteConfirm': '{path} löschen? Die Datei wird aus diesem Ordner entfernt.',
  'node.files.allowEditing':
    'Dateien in diesem Worktree erstellen, bearbeiten, verschieben und löschen erlauben? Dies erlaubt keine Agentenausführung.',
  'node.files.worktreeBusyTitle': 'Worktree wird verwendet',
  'node.files.worktreeBusy':
    'Dieser Worktree wird verwendet von: {holders}. Stoppen Sie seine Sitzungen vor dem Löschen.',
  'node.files.unknownHolder': 'einem anderen Vorgang auf dem Knoten',
  'node.files.stopSessions': 'Diese Sitzungen stoppen',
  'node.files.sessionsStopped':
    'Sitzungen gestoppt. Wählen Sie nach dem Beenden erneut Worktree löschen.',
  'node.error.busy':
    'Diese Ressource wird verwendet. Warte auf das Ende des aktuellen Vorgangs und versuche es erneut.',
  'node.error.busyStage':
    'Die Dateien konnten nicht vorgemerkt werden, da der Worktree belegt ist. Warten Sie und versuchen Sie es erneut.',
  'node.error.busyChat':
    'Der Chat konnte nicht gestartet werden, da der Ordner oder Worktree belegt ist. Warten Sie und versuchen Sie es erneut.',
  'node.error.busyRead':
    'Bearbeitung beendet. Die Datei konnte nicht aktualisiert werden, da der Worktree belegt ist. Aktualisieren Sie nach Abschluss der aktuellen Aktion.',
  'node.error.workspaceDirty':
    'Der Arbeitsbaum enthält nicht committete Änderungen. Committen oder verwerfen Sie diese vor dem Löschen.',
  'node.codeLineUnavailable': 'Die verlinkten Zeilen existieren in dieser Datei nicht mehr.',
  'image.timeLimit.label': 'Zeitlimit für die Bilderzeugung',
  'image.timeLimit.unlimited': 'Kein Limit',
  'image.timeLimit.minutes': '{minutes} Minuten',
  'image.timeLimit.error':
    'Die Bildanfrage hat das Limit von {minutes} Minuten erreicht. Ändern Sie es unter Einstellungen → KI → Modelle → Zeitlimit für die Bilderzeugung.',

  'node.delegation.activity': 'Aktivität und Berichte',
  'node.delegation.done': 'Fertig',
  'node.delegation.working': 'Arbeitet',
  'node.delegation.unknown': 'Angehalten; Ergebnis ungewiss',
  'maps.lightAddressExample': 'https://tiles.example.com/{z}/{x}/{y}.png',
  'maps.darkAddressExample': 'https://tiles.example.com/dark/{z}/{x}/{y}.png',
  'node.error.size': 'Die Anfrage ist zu groß. Größe reduzieren und erneut versuchen.',
  'node.error.route':
    'Die Knotenadresse wurde abgelehnt. Die in der Kopplungseinladung erlaubte Adresse prüfen.',

  'node.error.tls':
    'Der Knoten konnte nicht sicher erreicht werden. Adresse, Zertifikat und Verbindung prüfen.',
  'node.error.access':
    'Der Knoten hat den Zugriff verweigert. Erneut koppeln oder Berechtigungen prüfen.',
  'node.error.unknownOutcome':
    'Das Ergebnis ist unbekannt. Vor einem erneuten Versuch aktualisieren und das Ergebnis prüfen.',
  'node.error.outputLimit':
    'Der Knoten hat zu viele Daten zurückgegeben. Grenze die Anfrage ein oder verwende Seiten.',
  'node.error.limit': 'Der Knoten hat ein Limit erreicht. Vor einem erneuten Versuch warten.',
  'node.error.debugger':
    'Der Debugger ist nicht verfügbar. Debug-Konfiguration prüfen und erneut verbinden.',
  'node.error.generic':
    'Der Knoten konnte die Anfrage nicht abschließen. Vor einem erneuten Versuch die Details prüfen.',
  'node.error.connection': 'Der Knoten ist getrennt. Verbindung prüfen und erneut verbinden.',
  'node.error.pairing':
    'Die Kopplung konnte nicht abgeschlossen werden. Einladung prüfen und erneut koppeln.',
  'node.error.identity':
    'Der Knoten oder das Ziel hat sich geändert. Identität prüfen und erneut verbinden.',
  'node.error.stale': 'Die Daten haben sich geändert. Vor einem erneuten Versuch aktualisieren.',
  'node.error.staleResource':
    'Der Ordner oder die Arbeitskopie hat sich geändert. Aktualisieren und erneut auswählen.',
  'node.error.folderUnavailable':
    'Dieser Ordner ist auf dem Knoten nicht mehr verfügbar. Er wurde möglicherweise entfernt oder ist kein Repository mehr.',
  'node.folderRefreshed':
    'Der Ordner wurde aktualisiert. Erneut auf Erstellen klicken, um den angegebenen Ordner zu erstellen.',
  'node.error.trust':
    'Dieser Ordner ist nicht vertrauenswürdig. Vor dem Fortfahren die Vertrauenseinstellungen prüfen.',
  'node.error.unavailable':
    'Diese Funktion ist nicht verfügbar. Konfiguration und Version des Knotens prüfen.',

  'kit.cancel': 'Abbrechen',
  'kit.delete': 'Löschen',
  'kit.deleteTooltip': 'Dieses Element löschen',
  'kit.cancelTooltip': 'Ohne Änderungen schließen',
  'kit.filename': 'Dateiname',
  'kit.create': 'Erstellen',
  'kit.submitTooltip': 'Mit diesem Text fortfahren',
  'kit.where': 'Position',
  'kit.allLevels': 'Alle Ebenen anzeigen',
  'kit.empty': 'Noch keine Einträge',
  'kit.noMatches': 'Keine Treffer',
  'kit.loading': 'Wird geladen…',
  'kit.loadError': 'Einträge konnten nicht geladen werden',
  'kit.details': 'Details',
  'kit.noEvents': 'Noch keine Ereignisse',
  'kit.sourceMissing': 'Quelle nicht verfügbar',
  'kit.saveError': 'Speichern fehlgeschlagen',
  'kit.progress': 'Fortschritt',
  'kit.clear': 'Auswahl aufheben',
  'kit.selectAll': 'Alles auswählen',
  'kit.chooseNone': 'Alle abwählen',
  'kit.chooseAll': 'Alle Einträge auswählen',
  'kit.chooseIcon': 'Symbol auswählen',
  'kit.searchIcons': 'Symbole suchen, z. B. calendar',
  'kit.noIcon': 'Kein Symbol hat einen Namen ähnlich „{query}“.',
  'kit.refreshing': 'Wird aktualisiert…',
  'kit.objectMissing': 'Objekt nicht verfügbar',
  'kit.objectError': 'Objekt konnte nicht geladen werden',
  'kit.waiting': 'Warten auf deine Antwort',
  'kit.closeSearch': 'Suche schließen',
  'kit.folder': 'Ordner',
  'kit.scope': 'Bereich',
  'kit.unknown': 'Unbekannt',
  'kit.removeNote': 'Diese Notiz entfernen',
  'kit.copyPath': 'Vollständigen Pfad kopieren',
  'kit.reveal': 'Im Dateiexplorer anzeigen',
  'kit.targetMissing': 'Ziel nicht verfügbar',
  'kit.vaultRoot': 'Wurzel des Vaults',
  'kit.previousMonth': 'Vorheriger Monat',
  'kit.dateRange': 'Datumsbereich auswählen',
  'kit.nextMonth': 'Nächster Monat',
  'kit.noQuote': 'Kein zitierter Text',
  'kit.collapseQuote': 'Zitat einklappen',
  'kit.expandQuote': 'Zitat ausklappen',
  'kit.exactTime': 'Genaue Zeit',
  'kit.working': 'In Bearbeitung',
  'kit.done': 'Fertig',
  'kit.failed': 'Fehlgeschlagen',
  'kit.skipped': 'Unverändert',
  'kit.errors': 'Fehler',
  'kit.moreBelow': 'Weiter unten',
  'kit.selection': 'Auswahl',
  'kit.moreActions': 'Weitere Aktionen',
  'kit.showRest': 'Rest der Liste anzeigen',
  'kit.showMore': { one: '{count} weitere anzeigen', other: '{count} weitere anzeigen' },
  'kit.underlineOn': 'Unterstreichung an',
  'kit.underlineOff': 'Unterstreichung aus',
  'kit.underline': 'Anmerkung unterstreichen',
  'kit.savingColour': 'Farbe wird gespeichert',
  'kit.selectionMissing': 'Auswahl nicht verfügbar',
  'kit.noColour': 'Keine Farbe',
  'kit.savingNamedColour': 'Wird gespeichert: {colour}…',
  'kit.colourDisabled': 'Farbe kann hier nicht geändert werden',
  'kit.waveform': 'Wellenform',
  'kit.colour.grey': 'Grau',
  'kit.colour.red': 'Rot',
  'kit.colour.orange': 'Orange',
  'kit.colour.yellow': 'Gelb',
  'kit.colour.green': 'Grün',
  'kit.colour.cyan': 'Cyan',
  'kit.colour.blue': 'Blau',
  'kit.colour.purple': 'Violett',
  'kit.colour.pink': 'Rosa',
  'settings.tabs.tasks': 'Aufgaben',
  'settings.tabs.logs': 'Protokolle',
  'settings.tabs.journals': 'Tagebücher',
  'settings.tabs.calendars': 'Kalender',
  'settings.tabs.finance': 'Finanzen',
  'settings.tabs.timeTracking': 'Zeiterfassung',
  'settings.tabs.ai': 'KI-Agent',
  'settings.tabs.scripts': 'Skripte',
  'settings.tabs.links': 'Links',
  'settings.tabs.github': 'Git-Hosting',
  'settings.tabs.nodes': 'Knoten',
  'settings.tabs.reader': 'Bücher',
  'settings.tabs.quickButton': 'Schnellschaltfläche',
  'settings.tabs.headerButtons': 'Kopfzeilen-Schaltflächen',
  'settings.tabs.linter': 'Notizprüfung',
  'settings.tabs.transfer': 'Übertragung',
  'settings.tabs.sync': 'Synchronisierung',
  'settings.tabs.other': 'Sonstiges',
  'settings.groups.notes': 'Notizen',
  'settings.groups.moneyTime': 'Geld und Zeit',
  'settings.groups.agents': 'Agenten',
  'settings.groups.buttons': 'Schaltflächen',
  'settings.groups.data': 'Daten',
  'settings.documentation': 'Dokumentation',
  'settings.documentationTooltip': 'Einstellungen schließen und mehr über diesen Tab lesen',
  'settings.englishDocs': 'Die Dokumentation ist auf Englisch',
  'kit.imageMissing': 'Bild nicht verfügbar',
  'kit.loadingImage': 'Bild wird geladen…',
  'kit.deviceMissing': 'Auf diesem Gerät nicht verfügbar',
  'kit.hideDetail': '{label} ausblenden',
  'kit.showDetail': '{label} anzeigen',
  'kit.description': 'Beschreibung',
  'kit.openSource': 'Quelle für {title} öffnen',
  'kit.retry': '{title} erneut versuchen',
  'kit.moreIcons': '{count} weitere Symbole unten',
  'kit.image': 'Bild',
  'kit.imageMissingNamed': 'Bild nicht verfügbar: {name}',
  'kit.previewImage': 'Vorschau: {name}',
  'kit.inputLoading': 'Wird geladen',
  'kit.partOf': '{shown} von {total}',
  'kit.workspace': 'Arbeitsbereich: {name}',
  'kit.qrCode': 'QR-Code',
  'kit.askSelection': 'Den Agenten in einem neuen Chat dazu fragen',
  'kit.addSelection': 'Zum geöffneten Chat hinzufügen',
  'node.trust.title': 'Diesem Ordner für Agenten vertrauen?',
  'node.trust.message':
    'Agenten können in {path} Befehle ausführen und Dateien ändern. Vertraue diesem Ordner nur, wenn du seinen Inhalt kennst. Du kannst den Agenten im Chat verfolgen und dort stoppen.',
  'node.trust.allow': 'Ordner vertrauen',
  'node.chat.closeTab':
    'Tab schließen — die Sitzung bleibt auf dem Knoten. Öffne sie über die Knotenleiste, um sie zu verfolgen oder zu stoppen.',
  'kit.noteSelection': 'In die zuletzt geöffnete Notiz einfügen',
  'kit.linkSelection': 'Link zu diesen Zeilen kopieren',
  'kit.saving': 'Wird gespeichert…',
  'commands.convert-drawings-to-canvases': 'Alte Zeichnungen in Canvases umwandeln',
  'drawing.conversion-result':
    'Zeichnungen: {converted} umgewandelt, {existing} bereits umgewandelt, {failed} fehlgeschlagen. Originale behalten.',
  'commands.migrate-excalidraw-drawing': 'Diese Excalidraw-Zeichnung auf eine Leinwand migrieren',
  'commands.migrate-excalidraw-vault': 'Alle Excalidraw-Zeichnungen auf Leinwände migrieren',
  'commands.new-canvas': 'Neue Leinwand',
  'commands.open-canvas-viewer': 'Aktuelle Leinwand im Diagrammbetrachter öffnen',
  'commands.open-changelog': 'Änderungsprotokoll öffnen',
  'commands.cycle-checkbox-state': 'Kontrollkästchenstatus wechseln',
  'commands.insert-columns': 'Spalten einfügen',
  'commands.column-options': 'Spaltenoptionen',
  'commands.remove-columns': 'Spalten entfernen',
  'commands.add-text-comment': 'Kommentar hinzufügen',
  'commands.open-node-repository': 'Knoten-Repository öffnen',
  'commands.chat-about-github-item': 'Über dieses GitHub-Element chatten',
  'commands.open-github-repository': 'GitHub-Repository öffnen…',
  'commands.show-github-notifications': 'GitHub-Benachrichtigungen anzeigen',
  'commands.open-github-link': 'GitHub-Link oder -Element öffnen',
  'commands.copy-link-to-lines': 'Link zu ausgewählten Zeilen kopieren',
  'commands.linter-open': 'Linter öffnen',
  'commands.linter-lint-note': 'Aktuelle Notiz mit Linter prüfen',
  'commands.linter-lint-folder': 'Ordner mit Linter prüfen…',
  'commands.linter-lint-vault': 'Vault mit Linter prüfen',
  'commands.sync-now': 'Jetzt synchronisieren',
  'commands.sync-pause-resume': 'Synchronisierung pausieren oder fortsetzen',
  'commands.sync-log': 'Synchronisierungseinstellungen öffnen',
  'commands.sync-deleted-files': 'Gelöschte Dateien öffnen',
  'commands.reader-toggle-eink': 'E-Ink-Modus für Bücher auf diesem Gerät umschalten',
  'commands.reader-toggle-zen': 'Zen-Modus für Bücher auf diesem Gerät umschalten',
  'commands.open-requests': 'Anfragen öffnen',
  'commands.import-requests': 'Anfragen aus der Zwischenablage importieren',
  'commands.new-presentation': 'Neue Präsentation',
  'commands.open-presentation': 'Präsentation öffnen',
  'commands.preview-presentation': 'Präsentationsvorschau neben dem Editor',
  'commands.play-presentation': 'Präsentation abspielen',
  'commands.present-presentation': 'Präsentation mit Referentenansicht zeigen',
  'commands.agents': 'Agenten',
  'ribbon.agents': 'Agenten',
  'commands.comment-here': 'Hier kommentieren',
  'commands.show-ai-sidebar': 'KI-Chat-Seitenleiste anzeigen',
  'commands.find-in-chat': 'Im aktuellen Chat suchen',
  'commands.search-all-chats': 'Alle Chats durchsuchen',
  'commands.chat-close-tab': 'Aktuellen Chat-Tab schließen',
  'commands.chat-reopen-tab': 'Zuletzt geschlossenen Chat-Tab wieder öffnen',
  'commands.chat-next-tab': 'Zum nächsten Chat-Tab wechseln',
  'commands.chat-previous-tab': 'Zum vorherigen Chat-Tab wechseln',
  'ribbon.show-ai-chat': 'KI-Chat anzeigen',
  'commands.voice-input': 'In die Notiz diktieren',
  'commands.show-script-runs': 'Skriptausführungen anzeigen',
  'commands.open-documentation': 'Dokumentation öffnen',
  'commands.open-quick-menu': 'Schnellmenü öffnen',
  'commands.show-script-api': 'Skript-API-Referenz anzeigen',
  'commands.review-key-destinations': 'Schlüsselziele prüfen',
  'commands.create-task': 'Neue Aufgabe erstellen',
  'commands.create-task-and-insert-link':
    'Neue Aufgabe erstellen und in die aktuelle Notiz einfügen',
  'commands.find-and-replace':
    'In Metadaten und Inhalt aller den Kriterien entsprechenden Notizen suchen und ersetzen',
  'commands.import-files': 'Dateien in den Vault importieren',
  'commands.save-media': 'Entfernte Mediendateien im Vault speichern',
  'commands.unused-media': 'Ungenutzte Mediendateien suchen und löschen',
  'commands.deduplicate-media': 'Doppelte Medienanhänge entfernen',
  'commands.migrate-from-dataview': 'Aufgaben aus Dataview migrieren',
  'commands.migrate-from-firefly': 'Daten aus Firefly III migrieren',
  'commands.create-transaction': 'Neue Transaktion erstellen',
  'commands.create-transaction-and-insert-link':
    'Neue Transaktion erstellen und in die aktuelle Notiz einfügen',
  'commands.show-timeline-sidebar': 'Zeitleisten-Seitenleiste anzeigen',
  'commands.migrate-dataview-fields': 'Dataview-Felder migrieren',
  'commands.show-todo-sidebar': 'Aufgaben-Seitenleiste anzeigen',
  'commands.show-finance-sidebar': 'Finanz-Seitenleiste anzeigen',
  'commands.show-accounts-sidebar': 'Konten-Seitenleiste anzeigen',
  'commands.migrate-from-toggl': 'Zeiteinträge aus Toggl migrieren',
  'commands.show-time-tracking-sidebar': 'Zeiterfassungs-Seitenleiste anzeigen',
  'commands.start-timer': 'Timer für die aktuelle Notiz starten',
  'commands.stop-timer': 'Aktiven Timer stoppen',
  'commands.paste-from-clipboard': 'Zwischenablage an der Cursorposition einfügen',
  'commands.create-note-from-template': 'Notiz aus Vorlage erstellen',
  'commands.create-note-in-group': 'Notiz in Gruppe erstellen',
  'commands.replace-note-with-template': 'Aktuelle Notiz durch Vorlage ersetzen',
  'commands.insert-template-at-cursor': 'Vorlage an der Cursorposition einfügen',
  'commands.insert-gallery': 'Bildergalerie einfügen',
  'commands.convert-images-to-galleries': 'Bilder auf der Seite in Galerien umwandeln',
  'commands.reindex-footnotes': 'Fußnoten neu nummerieren',
  'commands.insert-highlight': 'Farbige Hervorhebung einfügen',
  'commands.remove-highlight': 'Farbige Hervorhebung entfernen',
  'commands.set-cover-from-first-media': 'Erstes Bild oder Video der Notiz als Titelbild festlegen',
  'commands.open-today-daily-note': 'Heutige tägliche Notiz öffnen',
  'commands.create-css-snippet': 'CSS-Snippet erstellen',
  'commands.reload-css-snippets': 'CSS-Snippets neu laden',
  'commands.create-script': 'Skript erstellen',
  'ribbon.show-timeline-sidebar': 'Zeitleisten-Seitenleiste anzeigen',
  'ribbon.show-todo-sidebar': 'Aufgaben-Seitenleiste anzeigen',
  'ribbon.show-finance-sidebar': 'Finanz-Seitenleiste anzeigen',
  'ribbon.show-time-tracking': 'Zeiterfassung anzeigen',
  'ribbon.show-script-runs': 'Skriptausführungen anzeigen',
  'commands.open-node': 'Knoten öffnen',
  'ribbon.node': 'Knoten',
  'commands.toggle-zen-mode': 'Zen-Modus umschalten',
  'commands.add-to-agent-context': 'Zum Agentenkontext hinzufügen',
  'commands.chat-about-current-note': 'Darüber chatten',
  'commands.attach-note-to-chat': 'An einen Chat anhängen',
  'commands.attach-chat-to-current-note': 'Chat an Notiz anhängen',
  'commands.copy-note-wikilink': 'Wikilink kopieren',
  'commands.review-scripts': 'Auf Bestätigung wartende Skripte prüfen',
  'commands.script': 'Skript: {name}',
  'settings.nodes.title': 'Knoten',
  'settings.nodes.description':
    'Computer, auf denen der Agent für Sie arbeiten kann: Öffnen Sie einen, wählen Sie ein Projekt und verfolgen und beantworten Sie hier die Arbeit. Schlüssel und Verlauf bleiben auf diesem Gerät.',
  'settings.nodes.check': 'Knotenverbindung dieses Geräts prüfen',
  'settings.nodes.open': 'Sitzung öffnen',
  'settings.nodes.openTip': 'Sitzung auswählen oder Projekte und Arbeitsbereiche verwalten',
  'settings.nodes.more': 'Kopplung, Debugger-Zugriff, Entfernen',
  'settings.nodes.pairTitle': 'Knoten auf einem anderen Computer koppeln',
  'settings.nodes.pairDesc':
    'Ein entfernter Computer oder Server über dessen Einladung. Ein Gerät mit widerrufenem Zugriff wird auf dieselbe Weise erneut gekoppelt.',
  'settings.nodes.pair': 'Koppeln',
  'settings.nodes.pairTip':
    'Einladung scannen oder einfügen; erneut koppeln oder geänderten Knotenschlüssel prüfen',
  'settings.nodes.addTitle': 'Knoten auf diesem Computer hinzufügen',
  'settings.nodes.addDesc': 'Einen hier laufenden Knoten über dessen Token.',
  'settings.nodes.add': 'Hinzufügen',
  'settings.nodes.addTip': 'Knoten hier benennen und dessen Token einfügen',
  'settings.nodes.traceTitle': 'Notizen zu aufgezeichneten Ausführungen',
  'settings.nodes.traceDesc':
    'Ordner für eine Notiz zu einer vom Debugger aufgezeichneten Ausführung von Ihnen oder dem Agenten: ein Vault-Ordner oder auf einem Computer ein beliebiger Ordner mit vollständigem Pfad. Die Ausführung selbst bleibt auf dem Knoten.',
  'settings.nodes.traceExample': 'z. B. Trace',
  'settings.nodes.traceFolder': 'Ordner für Notizen zu aufgezeichneten Ausführungen',
  'settings.nodes.chooseFolderTip':
    'Ordner auf diesem Computer innerhalb oder außerhalb des Vaults auswählen',
  'settings.nodes.chooseFolder': 'Ordner für Notizen zu aufgezeichneten Ausführungen auswählen',
  'settings.nodes.name': 'Name',
  'settings.nodes.nameDesc': 'Wie dieser Knoten auf diesem Gerät heißt.',
  'settings.nodes.localPlaceholder': 'Lokaler Knoten',
  'settings.nodes.label': 'Knotenbezeichnung',
  'settings.nodes.address': 'Adresse',
  'settings.nodes.addressDesc':
    'Nur die Adresse dieses Computers; ein anderer Computer wird gekoppelt.',
  'settings.nodes.url': 'Knoten-URL',
  'settings.nodes.token': 'Token',
  'settings.nodes.tokenDesc':
    'Der von abele-node token create ausgegebene Token. Wird nur im Schlüsselbund dieses Geräts gespeichert.',
  'settings.nodes.pasteToken': 'Token einfügen',
  'settings.nodes.installationToken': 'Knoten-Installationstoken',
  'settings.nodes.cancel': 'Abbrechen',
  'settings.nodes.cancelTip': 'Schließen, ohne etwas hinzuzufügen',
  'settings.nodes.authenticateTip':
    'Authentifizieren und die Identität des lokalen Knotens auf diesem Gerät festhalten',
  'settings.nodes.untitledChat': 'Unbenannter Chat',
  'settings.nodes.unavailable': 'Knoten nicht verfügbar',
  'settings.nodes.added':
    'Verbunden. Öffnen Sie hier oder im Menü für einen neuen Chat eine Sitzung.',
  'settings.nodes.connected': 'Verbunden',
  'settings.nodes.connecting': 'Verbindung wird hergestellt…',
  'settings.nodes.disconnected': 'Nicht verbunden',
  'settings.nodes.repair': 'Koppeln / erneut koppeln',
  'settings.nodes.remove': 'Entfernen',
  'settings.nodes.removed':
    'Verbindung von diesem Gerät entfernt. Knotenverlauf und Daemon-Zugangsdaten bleiben unverändert.',
  'commands.insert-columns-two': 'Zwei gleich breite Spalten einfügen',
  'commands.insert-columns-three': 'Drei gleich breite Spalten einfügen',
  'commands.insert-columns-aside': 'Text mit Randspalte einfügen',
  'ribbon.agentsStatus': 'Agenten · Benötigen Aufmerksamkeit: {attention}. Aktiv: {running}',
  'ribbon.agentsStatusIncomplete':
    'Agenten · Benötigen Aufmerksamkeit: {attention}. Aktiv: {running} · Einige Unterhaltungen konnten nicht geprüft werden',
  'settings.AiSettings.general.c910d474': 'Allgemein',
  'settings.AiSettings.models.d17d2d78': 'Modelle',
  'settings.AiSettings.agents.279b44d2': 'Agenten',
  'settings.AiSettings.prompts.5f2e66e6': 'Aufforderungen',
  'settings.AttachmentRulesSettings.attachment_folders.4ec7937c': 'Anhangsordner',
  'settings.AttachmentRulesSettings.files_pasted_or_dropped_into.8c0c906d':
    'Dateien, die in einem dieser Ordner in eine Notiz eingefügt oder dort abgelegt werden, werden in den Ordner mit den Regelnamen verschoben. Der tiefste Ordner gewinnt.',
  'settings.AttachmentRulesSettings.add_a_rule.bed79361': 'Fügen Sie eine Regel hinzu',
  'settings.AttachmentRulesSettings.notes_in.af0c6387': 'Notizen in',
  'settings.AttachmentRulesSettings.notes_folder.b8c1e974': 'Ordner „Notizen“.',
  'settings.AttachmentRulesSettings.folder.74ccd433': 'Ordner',
  'settings.AttachmentRulesSettings.remove_this_rule.00612239': 'Entfernen Sie diese Regel',
  'settings.AttachmentRulesSettings.attachments_go_to.7b114ade': 'Anhänge gehen zu',
  'settings.AttachmentRulesSettings.attachment_folder.fce49098': 'Anhangordner',
  'settings.AttachmentRulesSettings.subfolder_name.f381c5ab': 'Name des Unterordners',
  'settings.AttachmentRulesSettings.no_rules_attachments_follow_obsidian.e2ae55a7':
    'Keine Regeln: Anhänge folgen der Einstellung von Obsidian.',
  'settings.AttachmentRulesSettings.add_a_folder_rule.879a8360': 'Fügen Sie eine Ordnerregel hinzu',
  'settings.AttachmentRulesSettings.same_folder_as_the_note.32781177':
    'Gleicher Ordner wie die Notiz',
  'settings.AttachmentRulesSettings.in_the_folder_specified_below.952cbb55':
    'Im unten angegebenen Ordner',
  'settings.AttachmentRulesSettings.in_subfolder_under_the_note.86da3483':
    'Im Unterordner unter dem Ordner der Notiz',
  'settings.AttachmentRulesSettings.whole_vault.cb44fe25': 'Ganzes Gewölbe',
  'settings.CalendarsSettings.calendars.e0b2b00c': 'Kalender',
  'settings.CalendarsSettings.events_from_google_icloud_outlook.9b493b4b':
    'Ereignisse von Google, iCloud, Outlook oder einem beliebigen CalDAV-Server werden neben den Aufgaben angezeigt: im Seitenleistenkalender, der Zeitleiste und einer täglichen Notiz. Schreibgeschützt – es wird nie etwas in einen Kalender geschrieben und es werden keine Notizen gemacht, es sei denn, Sie fragen bei einer Veranstaltung danach.',
  'settings.CalendarsSettings.read_every_minutes.f4ca625e': 'Alle (Minuten) lesen',
  'settings.CalendarsSettings.when_obsidian_starts_then_this.44513cbf':
    'Wenn Obsidian startet, dann oft, während es geöffnet ist. mindestens {value0}; Google selbst aktualisiert einen Link nur alle paar Stunden.',
  'settings.CalendarsSettings.read_now.20d8b246': 'Jetzt lesen',
  'settings.CalendarsSettings.read_every_calendar_that_is.7c3924c9':
    'Lesen Sie jetzt jeden angezeigten Kalender noch einmal',
  'settings.CalendarsSettings.no_calendar_is_shown_yet.ab997e6f':
    'Es wird noch kein Kalender angezeigt',
  'settings.CalendarsSettings.your_calendars.80ca6c5e': 'Ihre Kalender',
  'settings.CalendarsSettings.not_read.e4f441c4': 'Nicht gelesen: ',
  'settings.CalendarsSettings.change_this_calendar.a6ced910': 'Ändern Sie diesen Kalender',
  'settings.CalendarsSettings.add_another_calendar.744b9f9c':
    'Fügen Sie einen weiteren Kalender hinzu',
  'settings.CalendarsSettings.no_calendars_yet.0097b3fe': 'Noch keine Kalender',
  'settings.CalendarsSettings.a_secret_link_from_google.21e49135':
    'Ein geheimer Link von Google, iCloud oder Outlook oder ein CalDAV-Konto.',
  'settings.CalendarsSettings.add_calendar.9067e0e8': 'Kalender hinzufügen',
  'settings.CalendarsSettings.add_a_calendar_to_show.6973ff63':
    'Fügen Sie einen Kalender hinzu, der neben den Aufgaben angezeigt wird',
  'settings.CalendarsSettings.name.dcd1d522': 'Name',
  'settings.CalendarsSettings.shown_beside_each_of_its.c8dbf6ee':
    'Wird neben jedem seiner Ereignisse angezeigt.',
  'settings.CalendarsSettings.e_g_work.7f2ce0de': 'z.B. {literal0}',
  'settings.CalendarsSettings.colour.3a9dfa58': 'Farbe',
  'settings.CalendarsSettings.its_events_are_marked_with.16eafb54':
    'Seine Ereignisse sind damit gekennzeichnet.',
  'settings.CalendarsSettings.connected_by.9952ce52': 'Verbunden durch',
  'settings.CalendarsSettings.a_secret_link_to_the.9b051a7d':
    'Ein geheimer Link zum Kalender oder ein CalDAV-Konto mit Benutzername und Passwort.',
  'settings.CalendarsSettings.link.a6a32dbc': 'Link',
  'settings.CalendarsSettings.forget_the_link.45aee758': 'Vergiss den Link',
  'settings.CalendarsSettings.server.aef7de28': 'Server',
  'settings.CalendarsSettings.the_caldav_address_https_caldav.b4d38d72':
    'Die CalDAV-Adresse: {literal0} für iCloud, {literal1} für Fastmail, Ihre Nextcloud-Adresse für Nextcloud.',
  'settings.CalendarsSettings.username.e3b89e9d': 'Benutzername',
  'settings.CalendarsSettings.for_icloud_the_email_of.c5355f7f':
    'Für iCloud die E-Mail des Apple-Kontos.',
  'settings.CalendarsSettings.password.e7cf3ef4': 'Passwort',
  'settings.CalendarsSettings.app_specific_password.ffcc8f77': 'App-spezifisches Passwort',
  'settings.CalendarsSettings.forget_the_password.9d745dd0': 'Vergessen Sie das Passwort',
  'settings.CalendarsSettings.calendar.d5d0a30b': 'Kalender',
  'settings.CalendarsSettings.one_calendar_of_the_account.562ef915':
    'Ein Kalender des Kontos oder alle. „Kalender suchen“ fragt den Server, welche es gibt.',
  'settings.CalendarsSettings.find_calendars.d59c2286': 'Kalender finden',
  'settings.CalendarsSettings.set_the_server_the_username.111eaa0a':
    'Legen Sie zunächst den Server, den Benutzernamen und das Passwort fest',
  'settings.CalendarsSettings.ask_the_server_which_calendars.f73e27cb':
    'Fragen Sie den Server, welche Kalender dieses Konto hat',
  'settings.CalendarsSettings.delete.e2d0a549': 'Löschen',
  'settings.CalendarsSettings.delete_this_calendar_from_the.f4c43787':
    'Löschen Sie diesen Kalender aus den Einstellungen und seinen Schlüssel aus dem Schlüsselbund',
  'settings.CalendarsSettings.done.11a6767d': 'Fertig',
  'settings.CalendarsSettings.close_this_window_changes_are.91342d87':
    'Schließen Sie dieses Fenster. Änderungen bleiben erhalten, sobald Sie sie vornehmen',
  'settings.CalendarsSettings.delete_the_calendar.e601c301': 'Löschen Sie den Kalender',
  'settings.CalendarsSettings.delete_value_its_events_leave.e651a9e0':
    '{value0} löschen? Seine Ereignisse verlassen die Listen und sein {value1} wird aus dem Schlüsselbund entfernt. Der Kalender selbst wird nicht berührt.',
  'settings.CalendarsSettings.google_the_calendar_s_settings.065b586e':
    'Google: die Einstellungen des Kalenders, „Geheime Adresse im iCal-Format“. iCloud: Geben Sie den Kalender als öffentlichen Kalender frei und kopieren Sie seinen Link. Outlook: Veröffentlichen Sie den Kalender und kopieren Sie den ICS-Link. Wird im Schlüsselbund aufbewahrt – jeder, der über den Link verfügt, kann den Kalender lesen.',
  'settings.CalendarsSettings.for_icloud_an_app_specific.7d624f48':
    'Für iCloud ein anwendungsspezifisches Passwort, das unter account.apple.com erstellt wurde, nicht das eigene des Kontos. Wird im Schlüsselbund gespeichert, niemals in der Einstellungsdatei.',
  'settings.CalendarsSettings.secret_link_ics.a3f8db65': 'Geheimer Link (ICS)',
  'settings.CalendarsSettings.caldav_account.bb860701': 'CalDAV-Konto',
  'settings.CalendarsSettings.the_value_could_not_be.3daaa765':
    'Der {value0} konnte nicht im Schlüsselbund aufbewahrt werden: {value1}',
  'settings.CalendarsSettings.asking_the_server.fb689559': 'Den Server fragen...',

  'settings.CalendarsSettings.the_account_has_no_calendar.a059bc95':
    'Das Konto verfügt über keinen Kalender mit Ereignissen.',
  'settings.CalendarsSettings.all_calendars_of_the_account.3b138d44': 'Alle Kalender des Kontos',
  'settings.CalendarsSettings.just_now.7ddb44d8': 'soeben',
  'settings.CalendarsSettings.value_min_ago.c85acd7d': 'Vor {value0} Min',
  'settings.CalendarsSettings.not_shown.a08f0f94': 'Nicht angezeigt',
  'settings.CalendarsSettings.reading.874bfa5b': 'Lektüre…',
  'settings.CalendarsSettings.no_password_yet.11f1e05e': 'Noch kein Passwort',
  'settings.CalendarsSettings.no_link_yet.60e5be61': 'Noch kein Link',
  'settings.CalendarsSettings.could_not_be_read.51a02791': 'Konnte nicht gelesen werden',
  'settings.CalendarsSettings.not_read_yet.fbe841ea': 'Noch nicht gelesen',
  'settings.CalendarsSettings.reading_the_calendars.b8ec37a1': 'Die Kalender lesen…',
  'settings.CalendarsSettings.value_of_the_calendars_could.c86147d0':
    '{value0} der Kalender konnte nicht gelesen werden; Jeder sagt unten, warum.',
  'settings.CalendarsSettings.read_every_calendar_again_now.d8b13597':
    'Lesen Sie jeden Kalender jetzt noch einmal und nicht erst beim nächsten Mal.',
  'settings.FinanceSettings.transactions.3e5136fd': 'Transaktionen',
  'settings.FinanceSettings.transaction_path_template.39b564b9': 'Vorlage für den Transaktionspfad',
  'settings.FinanceSettings.template_for_new_transaction_file.0e3740ec':
    'Vorlage für neue Transaktionsdateipfade. Leer lassen, um vorhandene Pfade beizubehalten; Neue Transaktionen verwenden ihre Titel im Vaultstammverzeichnis. Variablen: {literal0}, {literalDate}, {literal1}, {literal2}, {literal3}, {literal4}.',
  'settings.FinanceSettings.e_g_finance_transactions_date.1fe69c45': 'z.B. {literal1}',
  'settings.FinanceSettings.transaction_template_note.010eab6c': 'Hinweis zur Transaktionsvorlage',
  'settings.FinanceSettings.path_to_a_template_note.397b813a':
    'Pfad zu einer Vorlagennotiz, die beim Erstellen neuer Transaktionen verwendet wird.',
  'settings.FinanceSettings.path_to_template_note.18b70a08': 'Pfad zur Vorlagennotiz',
  'settings.FinanceSettings.default_currency.67e65877': 'Standardwährung',
  'settings.FinanceSettings.default_currency_code_for_new.7d536f52':
    'Standardwährungscode für neue Transaktionen.',
  'settings.FinanceSettings.e_g_eur.00afdaf5': 'z.B. {literal0}',
  'settings.FinanceSettings.pinned_currencies.b882d6bc': 'Angepinnte Währungen',
  'settings.FinanceSettings.comma_separated_currencies_to_show.c63a2698':
    'Durch Kommas getrennte Währungen zur Anzeige von Saldozusammenfassungen in der Seitenleiste. Die Ordnung bleibt erhalten.',
  'settings.FinanceSettings.e_g_eur_usd_gbp.768ebc64': 'z.B. {literal0}',
  'settings.FinanceSettings.exchange_rates.a1875e41': 'Wechselkurse',
  'settings.FinanceSettings.fetch_today_s_rates.c175748e': 'Holen Sie sich die aktuellen Tarife',
  'settings.FinanceSettings.once_a_day_from_a.73d47942':
    'Einmal am Tag, von einem öffentlichen Tisch, der keinen Schlüssel benötigt; Es wird nichts über den Vault gesendet. Sie verwenden Summen mehrerer Währungen und die Reihenfolge der Konten nach Betrag.',
  'settings.FinanceSettings.show_sums_in.86b3b3d2': 'Summen anzeigen in',
  'settings.FinanceSettings.the_currency_a_sum_of.42c9988d':
    'Die Währung, in der eine Summe mehrerer Währungen angezeigt wird.',
  'settings.FinanceSettings.rates.54dd2169': 'Preise',
  'settings.FinanceSettings.fetch_today_s_rates_now.68e35189':
    'Holen Sie sich jetzt die aktuellen Tarife',
  'settings.FinanceSettings.firefly_iii_migration.59031cf7': 'Firefly III-Migration',
  'settings.FinanceSettings.firefly_iii_url.3050cc31': 'Firefly III-URL',
  'settings.FinanceSettings.base_url_of_your_firefly.f8d2bb5a':
    'Basis-URL Ihrer Firefly III-Instanz.',
  'settings.FinanceSettings.e_g_https_firefly_example.6999e343': 'z.B. {literal1}',
  'settings.FinanceSettings.firefly_iii_token.45c3acb2': 'Firefly III-Token',
  'settings.FinanceSettings.personal_access_token_for_firefly.7deff96a':
    'Persönliches Zugriffstoken für die Firefly III-API. Wird im Schlüsselbund gespeichert, niemals in der Einstellungsdatei.',
  'settings.FinanceSettings.enter_your_firefly_iii_token.c1c8a788':
    'Geben Sie Ihren Firefly III-Token ein',
  'settings.FinanceSettings.forget_the_token.961a44b9': 'Vergessen Sie den Token',
  'settings.FinanceSettings.accounts_folder.8f9b5bf3': 'Ordner „Konten“.',
  'settings.FinanceSettings.folder_for_account_notes_created.dab1fa98':
    'Ordner für Kontonotizen, die während der Migration erstellt wurden.',
  'settings.FinanceSettings.enter_accounts_folder_path.93935780':
    'Geben Sie den Pfad zum Kontoordner ein',
  'settings.FinanceSettings.categories_folder.60253c7c': 'Ordner „Kategorien“.',
  'settings.FinanceSettings.folder_for_category_notes_created.9f0764fe':
    'Ordner für Kategorienotizen, die während der Migration erstellt wurden.',
  'settings.FinanceSettings.enter_categories_folder_path.306fac3f':
    'Geben Sie den Ordnerpfad für die Kategorien ein',
  'settings.FinanceSettings.fetching_today_s_rates.1182bcb9':
    'Die aktuellen Tarife werden abgerufen…',
  'settings.FinanceSettings.could_not_fetch_value.ae250f78':
    'Konnte nicht abgerufen werden: {value0}',
  'settings.FinanceSettings.not_fetched_yet.21ca804f': 'Noch nicht abgerufen.',
  'settings.FinanceSettings.could_not_update_since_value.9af0a0fc':
    'Konnte nicht aktualisiert werden, da {value0}{value1}',
  'settings.FinanceSettings.from_value_value.11c05045': 'Von {value0}, {value1}',
  'settings.FinanceSettings.no_rate_for_value_left.b8718978':
    'Kein Tarif für {value0}: in den Summen weggelassen',
  'settings.GithubAccessReport.token.d2089be6': 'Token',
  'settings.GithubAccessReport.sent.c16bc82b': 'Gesendet',
  'settings.GithubAccessReport.not_sent.cd5f943d': 'Nicht gesendet',
  'settings.GithubAccessReport.refused.66b87354': 'Abgelehnt',
  'settings.GithubAccessReport.skipped.12698ce1': 'Übersprungen',
  'settings.GithubAccessReport.a_fine_grained_personal_access.04646cce':
    'ein feinkörniges persönliches Zugriffstoken',
  'settings.GithubAccessReport.a_classic_personal_access_token.a9fcbcbc':
    'ein klassischer persönlicher Zugangstoken',
  'settings.GithubAccessReport.an_oauth_token.4e87c03e': 'ein OAuth-Token',
  'settings.GithubAccessReport.a_github_app_s_token.911c13a3': 'Das Token einer GitHub-App',
  'settings.GithubAccessReport.a_token_of_a_kind.7af25278': 'Ein Token, den GitHub nicht markiert',
  'settings.GithubAccessReport.sent_with_every_request_value.a8affe59':
    'Wird bei jeder Anfrage gesendet: {value0}, {value1} Zeichen.',
  'settings.GithubAccessReport.no_token_was_sent_with.8d5461bf':
    'Bei diesen Anfragen wurde kein Token gesendet.',
  'settings.GithubAccessReport.token_is_set_for_value.2c01fdf9':
    'Token ist festgelegt für: {value0}',
  'settings.GithubAccessReport.repository_value_value_on_value.b4b9db3e':
    'Repository: {value0}/{value1} auf {value2}',
  'settings.GithubAccessReport.belongs_to_value.d316930d': 'Gehört zu {value0}.',
  'settings.GithubAccessReport.expires_value.f820bc15': 'Läuft ab {value0}.',
  'settings.GithubAccessReport.scopes_value.1d42883b': 'Bereiche: {value0}.',
  'settings.GithubAccessReport.api_value.011cfaea': 'API: {value0}',
  'settings.GithubAccessReport.needs_value.9e07998c': 'Bedarf: {value0}',
  'settings.GithubAccessReport.github_said_value.cc7a0df5': 'GitHub sagte: „{value0}“',
  'settings.GithubConnectionEditor.add_github_connection.a8b1ed9f': 'GitHub-Verbindung hinzufügen',
  'settings.GithubConnectionEditor.edit_github_connection.ca1cc639':
    'Bearbeiten Sie die GitHub-Verbindung',
  'settings.GithubConnectionEditor.account.7e1b0d56': 'Konto',
  'settings.GithubConnectionEditor.name.dcd1d522': 'Name',
  'settings.GithubConnectionEditor.a_name_for_this_connection.1c5554f0':
    'Ein Name für diese Verbindung, unabhängig von dem aus seinem Token ermittelten Konto.',
  'settings.GithubConnectionEditor.connection_name.686d4d5d': 'Verbindungsname',
  'settings.GithubConnectionEditor.server.aef7de28': 'Server',
  'settings.GithubConnectionEditor.empty_is_github_com_for.0f201123':
    'Leer ist github.com. Verwenden Sie für Enterprise die vollständige Adresse einschließlich aller Ports.',
  'settings.GithubConnectionEditor.github_com.3aeb0024': 'github.com',
  'settings.GithubConnectionEditor.token.d2089be6': 'Token',
  'settings.GithubConnectionEditor.github_pat.94238580': 'github_pat_...',
  'settings.GithubConnectionEditor.forget_the_token.961a44b9': 'Vergessen Sie den Token',
  'settings.GithubConnectionEditor.default_for_this_server.c7a4b365': 'Standard für diesen Server',
  'settings.GithubConnectionEditor.used_when_no_repository_owner.4af29859':
    'Wird verwendet, wenn keine Präferenz des Repository-Eigentümers eine andere Verbindung auswählt.',
  'settings.GithubConnectionEditor.repository_owners.89c91e93': 'Repository-Eigentümer',
  'settings.GithubConnectionEditor.one_per_line_sample_org.335517a9':
    'Eine pro Zeile: sample-org, sample-org/*, sample-* oder sample-org/project. Spezifischere Regeln gewinnen.',
  'settings.GithubConnectionEditor.sample_org_nsample_org_project.9045ecd8':
    'sample-org\\nsample-org/project',
  'settings.GithubConnectionEditor.check_access.abb9a172': 'Zugriff prüfen',
  'settings.GithubConnectionEditor.checks_only_this_connection_leave.71a745a0':
    'Überprüft nur diese Verbindung. Lassen Sie das Repository leer, um das Konto zu ermitteln.',
  'settings.GithubConnectionEditor.owner_repo_or_a_github.b6c51009':
    'Eigentümer/Repo oder ein GitHub-Link',
  'settings.GithubConnectionEditor.send_read_requests_with_this.e6f0e799':
    'Senden Sie Leseanfragen mit dem Token dieses Entwurfs, ohne ihn zu speichern',
  'settings.GithubConnectionEditor.another_connection_uses_the_same.db8b1327':
    'Eine andere Verbindung verwendet dasselbe Konto auf diesem Server. Sie können es immer noch speichern.',
  'settings.GithubConnectionEditor.cancel.19766ed6': 'Abbrechen',
  'settings.GithubConnectionEditor.discard_this_draft_without_changing.e8faacff':
    'Verwerfen Sie diesen Entwurf, ohne die Einstellungen oder den Schlüsselbund zu ändern',
  'settings.GithubConnectionEditor.save.1509f561': 'Speichern',
  'settings.GithubConnectionEditor.store_this_connection_and_its.1cf41364':
    'Speichern Sie diese Verbindung und ihr Token und schließen Sie dann den Editor',
  'settings.GithubConnectionEditor.the_token_will_be_forgotten.370b78f6':
    'Der Token wird beim Speichern vergessen.',
  'settings.GithubConnectionEditor.a_token_is_stored_on.cf14633e':
    'Auf diesem Gerät ist ein Token gespeichert. Geben Sie einen Ersatz ein oder lassen Sie das Feld leer, um es zu behalten. Änderungen werden nur mit Speichern gespeichert.',
  'settings.GithubConnectionEditor.synced_keys_are_locked_unlock.aeb37d60':
    'Synchronisierte Schlüssel sind gesperrt; Entsperren Sie sie, um den Token zu verwenden, oder geben Sie einen neuen ein.',
  'settings.GithubConnectionEditor.no_token_on_this_device.6ad3dfbf':
    'Kein Token auf diesem Gerät. Wird nur beim Speichern im Schlüsselbund gespeichert.',
  'settings.GithubConnectionEditor.give_owner_repo_or_a.5007d209':
    'Geben Sie Eigentümer/Repository oder einen Repository-Link an.',
  'settings.GithubConnectionEditor.this_repository_is_on_another.3dfb442d':
    'Dieses Repository befindet sich auf einem anderen Server. Wählen Sie stattdessen seine Verbindung.',
  'settings.GithubConnectionEditor.this_repository_is_on_a.2f633da4':
    'Dieses Repository befindet sich auf einer anderen Serveradresse, einem anderen Schema oder einem anderen Port. Verwenden Sie den Server dieser Verbindung.',
  'settings.GithubConnectionEditor.asking_github.5becc057': 'Ich frage GitHub…',
  'settings.GithubConnectionEditor.the_access_check_failed.90fa9dca':
    'Die Zugriffsprüfung ist fehlgeschlagen.',
  'settings.GithubSettings.open_github_issues_pull_requests.ad94cf5c':
    'Öffne Repositories, Issues, Pull Requests, Commits und Dateien von GitHub, Forgejo und Gitea in Tabs und Benachrichtigungen in der Seitenleiste. Verfügbare Aktionen hängen vom Dienst ab.',
  'settings.GithubSettings.open_github_links_in_obsidian.815b1959': 'Git-Links in Obsidian öffnen',
  'settings.GithubSettings.a_click_on_a_supported.f005fa1f':
    'Unterstützte Repository-Links öffnen sich in einem Tab. Andere Links und mit gedrückter Alt-Taste angeklickte Links öffnen sich im Browser.',
  'settings.GithubSettings.default_repository.525a8366': 'Standard-Repository',
  'settings.GithubSettings.where_the_command_open_github.750aa580':
    'Wo Open GitHub link or item sucht, wenn kein Repository-Tab den Kontext liefert. Nutze owner/repo oder einen Link; wähle bei mehrdeutigen Namen eine Verbindung.',
  'settings.GithubSettings.owner_repo.65e817ee': 'Eigentümer/Repo',
  'settings.GithubSettings.pinned_repositories.03dccfeb': 'Angepinnte Repositorys',
  'settings.GithubSettings.first_in_open_github_repository.067f8a9c':
    'Zuerst in Open GitHub repository…; wird mit den Einstellungen übertragen. Pinne ein Repository dort (Alt+Enter) oder im Menü eines Repository-Tabs an.',
  'settings.GithubSettings.nothing_pinned_yet.0b27e4d1': 'Noch nichts angepinnt.',
  'settings.GithubSettings.unpin_this_repository.91038877':
    'Lösen Sie die Fixierung dieses Repositorys',
  'settings.GithubSettings.connections.dc273117': 'Verbindungen',
  'settings.GithubSettings.a_fine_grained_personal_access.d3f9cea9':
    'Jede Verbindung hat einen eigenen Dienst, Server und ein eigenes Konto; wähle einen Standard pro Server. Zum Durchsuchen genügt ein Token mit Lesezugriff auf das Repository. GitHub-Benachrichtigungen benötigen ein klassisches Token mit der Berechtigung notifications.',
  'settings.GithubSettings.no_connections_public_github_com.534d40f4':
    'Keine Verbindungen. Öffentliche github.com-Repositories werden anonym gelesen.',
  'settings.GithubSettings.default.2a7e0b7b': ' · Standard',
  'settings.GithubSettings.check.9d60841e': 'Überprüfen',
  'settings.GithubSettings.check_this_connection_s_account.64de4945':
    'Überprüfen Sie das Konto und den Repository-Zugriff dieser Verbindung',
  'settings.GithubSettings.edit.464c4ffd': 'Bearbeiten',
  'settings.GithubSettings.edit_this_connection_s_name.de8cb86e':
    'Bearbeiten Sie die Einstellungen für Name, Server, Token und Besitzer dieser Verbindung',
  'settings.GithubSettings.delete.e2d0a549': 'Löschen',
  'settings.GithubSettings.remove_this_connection_after_confirmation.f3a7dd7f':
    'Entfernen Sie diese Verbindung nach der Bestätigung',
  'settings.GithubSettings.public_github_com_anonymous.c18bb859': 'Öffentlich github.com (anonym)',
  'settings.GithubSettings.value_of_value_requests_remaining.037c7ebe':
    '{value0} von {value1} verbleibenden Anfragen{value2}',
  'settings.GithubSettings.quota_not_observed_yet_normally.b802706a':
    'Quote noch nicht eingehalten; Normalerweise werden von diesem Gerät 60 Anfragen pro Stunde geteilt.',
  'settings.GithubSettings.add_connection.685f88ae': 'Verbindung hinzufügen',
  'settings.GithubSettings.create_a_connection_with_its.a4245461':
    'Erstellen Sie eine Verbindung mit einem eigenen Schlüsselbund-Token',
  'settings.GithubSettings.notifications.78801183': 'Benachrichtigungen',
  'settings.GithubSettings.a_fine_grained_personal_access.259d3619':
    'Ein differenzierter persönlicher Zugriffstoken kann Repository-Inhalte lesen, GitHub stellt Benachrichtigungen jedoch nur einem klassischen Token mit dem Benachrichtigungsbereich zur Verfügung. Legen Sie unten das Benachrichtigungstoken für den beibehaltenen einzelnen Posteingang fest. Es bleibt an den Server gebunden, auf dem es festgelegt wurde.',
  'settings.GithubSettings.notifications_token.e314ce9b': 'Benachrichtigungstoken',
  'settings.GithubSettings.optional_a_classic_personal_access.0e7b2561':
    'Optional. Ein klassisches persönliches Zugriffstoken mit dem Benachrichtigungsbereich, das nur vom Benachrichtigungsfeld verwendet wird: GitHub lässt nicht zu, dass ein feinkörniges Token Benachrichtigungen liest. Leer: Das Panel verwendet die Standardverbindung. Im Schlüsselbund gespeichert.',
  'settings.GithubSettings.ghp.ff475c83': 'ghp_...',
  'settings.GithubSettings.forget_the_notifications_token.5f48625d':
    'Vergessen Sie das Benachrichtigungstoken',
  'settings.GithubSettings.pages.9046da16': 'Seiten',
  'settings.GithubSettings.how_a_github_tab_lays.f030133b':
    'Wie ein GitHub-Tab darlegt, was er anzeigt.',
  'settings.GithubSettings.page_width.217fbef1': 'Seitenbreite',
  'settings.GithubSettings.how_wide_the_text_of.8d0e20a7':
    'Wie breit der Text eines Tabs ist: Konversationen, Commit-Nachrichten, gerenderter Markdown und Ordnerseiten. Unterschiede und Code nehmen immer die gesamte Registerkarte ein.',
  'settings.GithubSettings.width_in_pixels.b3f8f713': 'Breite in Pixel',
  'settings.GithubSettings.from_value_to_value_a.87f8c5fb':
    'Von {value0} bis {value1}. Eine schmalere Lasche nutzt das, was sie hat.',
  'settings.GithubSettings.markdown_files_open_as.5541a0b8': 'Markdown-Dateien werden geöffnet als',
  'settings.GithubSettings.preview_rendered_and_a_link.7f27338b':
    'Vorschau: wird gerendert und ein Link zu Zeilen der Datei markiert die Absätze, Listen oder Codeblöcke, in denen sie enthalten sind. Code: die Datei, wie sie geschrieben wird, Zeile für Zeile. Der Schalter über einer Datei ändert sie für diese Registerkarte.',
  'settings.GithubSettings.people.7db20897': 'Menschen',
  'settings.GithubSettings.who_wrote_an_issue_a.deb19dbb':
    'Wer hat mit seinem Bild ein Problem, einen Kommentar, eine Rezension oder einen Commit geschrieben? Namen und Bilder werden einmalig von GitHub abgefragt und eine Woche lang auf diesem Gerät gespeichert.',
  'settings.GithubSettings.show_people_by.989a820c': 'Zeigen Sie den Leuten vorbei',
  'settings.GithubSettings.their_name_as_their_profile.2452b5a6':
    'Ihr Name, wie es ihr Profil vorgibt, oder ihr Login. Die andere befindet sich im Tooltip, und ein Klick oder ein Tipp auf eine Person vertauscht die beiden direkt dort. Jemand, dessen Profil keinen Namen hat, wird beim Login so oder so angezeigt.',
  'settings.GithubSettings.kept_names_and_pictures.586c5b5f': 'Namen und Bilder beibehalten',
  'settings.GithubSettings.clear.83b12c22': 'Auswahl aufheben',
  'settings.GithubSettings.forget_every_kept_name_and.ddf1b164':
    'Vergessen Sie jeden Namen und jedes Bild; Sie werden erneut abgefragt, wenn Personen gezeigt werden',
  'settings.GithubSettings.nothing_is_kept_yet.7287d9c8': 'Es ist noch nichts aufbewahrt',
  'settings.GithubSettings.code_search.ca5e7167': 'Codesuche',
  'settings.GithubSettings.search_the_code_of_the.1ce06300':
    'Durchsuchen Sie den Code der Version, die auf einer Registerkarte angezeigt wird, und rufen Sie die Definition innerhalb der Registerkarte auf. Das Repository dieser Version wird einmal pro Sitzung heruntergeladen und hier durchsucht.',
  'settings.GithubSettings.largest_repository_to_download_mb.c4edc368':
    'Größtes Repository zum Herunterladen (MB)',
  'settings.GithubSettings.its_files_at_that_version.5d039cfc':
    'Gesamtgröße der Dateien dieser Version. Größere GitHub-Repositories nutzen die Serversuche im Standardbranch mit einem Token. Forgejo und Gitea melden stattdessen das Archivlimit.',
  'settings.GithubSettings.delete_github_connection.e4dfa050': 'Git-Verbindung löschen',
  'settings.GithubSettings.delete_connection.e960651b': 'Verbindung löschen',
  'settings.GithubSettings.delete_value_its_local_token.b78722f1':
    '{value0} löschen? Sein lokaler Token wird vergessen; andere Verbindungen bleiben erhalten.',
  'settings.GithubSettings.remove_the_notifications_token_from.5b3f8312':
    'Benachrichtigungstoken aus dem Schlüsselbund entfernen? Das Benachrichtigungsfeld geht zurück zum Haupttoken.',
  'settings.GithubSettings.token_available_on_this_device.8141399a':
    'Token auf diesem Gerät verfügbar',
  'settings.GithubSettings.synced_keys_locked.1673153c': 'Synchronisierte Schlüssel gesperrt',
  'settings.GithubSettings.no_token_on_this_device.a87b4f4f': 'Kein Token auf diesem Gerät',
  'settings.GithubSettings.this_connection_changed_elsewhere_close.7283b1d4':
    'Dieser Zusammenhang hat sich an anderer Stelle geändert. Schließen Sie diesen Entwurf und bearbeiten Sie seine aktuellen Einstellungen.',
  'settings.GithubSettings.could_not_save_the_token.8edbb7d6':
    'Das Token konnte nicht im Schlüsselbund gespeichert werden. Es wurde nichts geändert; versuchen Sie es erneut.',
  'settings.GithubSettings.readable_line_width_like_notes.526184e3':
    'Lesbare Linienbreite, wie Notizen',
  'settings.GithubSettings.full_width.d34008d2': 'Volle Breite',
  'settings.GithubSettings.preview.324b134f': 'Vorschau',
  'settings.GithubSettings.code.340f4630': 'Code',
  'settings.GithubSettings.name.dcd1d522': 'Name',
  'settings.GithubSettings.login.9d6322c1': 'Login',
  'settings.GithubSettings.value_value_kept_on_this.ceefdd92': {
    one: '{count} Person auf diesem Gerät gespeichert. Leere den Cache, damit alle Namen und Bilder erneut abgefragt werden, etwa nachdem jemand sie geändert hat.',
    other:
      '{count} Personen auf diesem Gerät gespeichert. Leere den Cache, damit alle Namen und Bilder erneut abgefragt werden, etwa nachdem jemand sie geändert hat.',
  },
  'settings.GithubSettings.none_kept_on_this_device.bfb58c42':
    'Bisher ist noch keiner auf diesem Gerät gespeichert.',
  'settings.ImageModelEditModal.add_image_model.6b3a2d66': 'Bildmodell hinzufügen',
  'settings.ImageModelEditModal.edit_image_model.ca72d086': 'Bildmodell bearbeiten',
  'settings.ImageModelEditModal.model_id.089ef2b6': 'Modell-ID',
  'settings.ImageModelEditModal.api_model_identifier_e_g.c112d31d':
    'API-Modell-ID (z. B. gpt-image-1, Flux-Pro).',
  'settings.ImageModelEditModal.e_g_gpt_image.c781dc87': 'z.B. {literal0}',
  'settings.ImageModelEditModal.display_name.2b7f6a84': 'Anzeigename',
  'settings.ImageModelEditModal.optional_label_shown_in_model.3bf6fb7f':
    'Optionales Etikett wird in der Modellauswahl angezeigt.',
  'settings.ImageModelEditModal.e_g_gpt_image.5ae53afd': 'z.B. {literal0}',
  'settings.ImageModelEditModal.size.1af85190': 'Größe',
  'settings.ImageModelEditModal.image_dimensions.1a4bb2f3': 'Bildabmessungen.',
  'settings.ImageModelEditModal.quality.1b2c08a8': 'Qualität',
  'settings.ImageModelEditModal.output_format.93c53d37': 'Ausgabeformat',
  'settings.ImageModelEditModal.delete_image_model.f28aaecc': 'Bildmodell löschen',
  'settings.ImageModelEditModal.delete_value_agents_using_it.c65217d0':
    '{value0} löschen? Agenten, die es verwenden, haben kein Modell, bis eines vorhanden ist\n        erneut gewählt.',
  'settings.ImageModelEditModal.save.1509f561': 'Speichern',
  'settings.ImageModelEditModal.keep_these_settings_and_close.88a64dfa':
    'Behalten Sie diese Einstellungen bei und schließen Sie',
  'settings.ImageModelEditModal.delete.e2d0a549': 'Löschen',
  'settings.ImageModelEditModal.remove_this_image_model_from.c139edec':
    'Entfernen Sie dieses Bildmodell vom Anbieter',
  'settings.ImageModelEditModal.landscape.caa8642b': '1536×1024 (Querformat)',
  'settings.ImageModelEditModal.portrait.29d9d2d0': '1024×1536 (Hochformat)',
  'settings.ImageModelEditModal.auto.02862497': 'Auto',
  'settings.ImageModelEditModal.low.f793de20': 'Niedrig',
  'settings.ImageModelEditModal.medium.8e588cd1': 'Medium',
  'settings.ImageModelEditModal.high.c4ebc6d4': 'Hoch',
  'settings.JournalsSettings.value_journal.cc8a4dd5': '{value0} Journal',
  'settings.JournalsSettings.journal_value.06b87038': 'Journal #{value0}',
  'settings.JournalsSettings.remove_this_journal.c3a84c0a': 'Entfernen Sie dieses Tagebuch',
  'settings.JournalsSettings.default_journal.b54bf1fd': 'Standardjournal',
  'settings.JournalsSettings.journal_name.4a021433': 'Zeitschriftenname',
  'settings.JournalsSettings.journal_type_property_value_or.04441eaf':
    'Eigenschaftswert des Journaltyps oder Dateiname RegExp',
  'settings.JournalsSettings.type_or_regexp.241a5ad0': 'Geben Sie oder RegExp ein',
  'settings.JournalsSettings.date_property_name.8e90965d': 'Name der Datumseigenschaft',
  'settings.JournalsSettings.optional.59be7133': 'Optional',
  'settings.JournalsSettings.new_journal_note_path_template.862462e1':
    'Neue Pfadvorlage für Tagebuchnotizen',
  'settings.JournalsSettings.path_template.ec234daf': 'Pfadvorlage',
  'settings.JournalsSettings.day_of_reccurence_period_when.ae1517a9':
    'Tag des Wiederholungszeitraums, an dem die Notiz erstellt wird',
  'settings.JournalsSettings.optional_default_to_first.e58c831d':
    'Optional. Standardmäßig ist „erster“.',
  'settings.JournalsSettings.template_note_path.de4db36f': 'Pfad der Vorlagennotiz',
  'settings.JournalsSettings.journal_reccurence.8957b0f1': 'Wiederholung des Journals',
  'settings.JournalsSettings.add_journal.f49ae75e': 'Tagebuch hinzufügen',
  'settings.JournalsSettings.add_another_journal.0d345224': 'Fügen Sie ein weiteres Tagebuch hinzu',
  'settings.JournalsSettings.daily.b36c2611': 'Täglich',
  'settings.JournalsSettings.weekly.29751324': 'Wöchentlich',
  'settings.JournalsSettings.monthly.9b11f6b7': 'Monatlich',
  'settings.JournalsSettings.yearly.6e69b59e': 'Jährlich',
  'settings.KeyDestinationsModal.review_key_destinations.2058c462': 'Schlüsselziele prüfen',
  'settings.KeyDestinationsModal.choose_a_key_and_recipient.25b7b597':
    'Wählen Sie einen Schlüssel und einen Empfänger. Bestätigung und HTTP-Zulassung gelten lokal für dieses Gerät.',
  'settings.KeyDestinationsModal.saved_key.85ec79d9': 'Schlüssel gespeichert',
  'settings.KeyDestinationsModal.recipient_address.454d0391': 'Empfängeradresse',
  'settings.KeyDestinationsModal.recipient_url.59ef2635': 'Empfänger-URL',
  'settings.KeyDestinationsModal.new_key_name.0e18145f': 'Neuer Schlüsselname',
  'settings.KeyDestinationsModal.new_key_value.7a7e9552': 'Neuer Schlüsselwert',
  'settings.KeyDestinationsModal.protected_storage_saved_only_when.86338477':
    'Geschützte Lagerung; erst nach Bestätigung gespeichert.',
  'settings.KeyDestinationsModal.key_permissions.1f24b6b7': 'Schlüsselberechtigungen',
  'settings.KeyDestinationsModal.let_value_be_sent_to.3057160b':
    'Lassen Sie {value0} von diesem Gerät an {value1} senden',
  'settings.KeyDestinationsModal.remove_key_permission.60713985': 'Schlüsselberechtigung entfernen',
  'settings.KeyDestinationsModal.stop_sending_value_to_value.c158dbdd':
    'Hören Sie auf, {value0} an {value1} zu senden. Der Schlüssel bleibt gespeichert',
  'settings.KeyDestinationsModal.service_destinations_to_confirm.e397cae5':
    'Serviceziele zur Bestätigung',
  'settings.KeyDestinationsModal.let_value_receive_its_key.90e1b8f2':
    'Lassen Sie {value0} seinen Schlüssel bei {value1} von diesem Gerät erhalten',
  'settings.KeyDestinationsModal.http_transport_on_this_device.caafbfd3':
    'HTTP-Transport auf diesem Gerät',
  'settings.KeyDestinationsModal.unencrypted_transport_only_each_key.82a7923f':
    'Nur unverschlüsselter Transport; Jeder Schlüssel benötigt weiterhin eine eigene Empfängerberechtigung.',
  'settings.KeyDestinationsModal.remove_http_exception.ae72ff92': 'HTTP-Ausnahme entfernen',
  'settings.KeyDestinationsModal.stop_allowing_unencrypted_key_transport.0b903e28':
    'Erlauben Sie den unverschlüsselten Schlüsseltransport zu {value0} nicht mehr.',
  'settings.KeyDestinationsModal.allow_key_and_address.5e3ba2cc': 'Schlüssel und Adresse zulassen',
  'settings.KeyDestinationsModal.save_this_key_permission_on.38e5eb82':
    'Speichern Sie diese Schlüsselberechtigung auf diesem Gerät. Es wird jetzt nichts gesendet',
  'settings.KeyDestinationsModal.unencrypted_anyone_on_the_network.a467237d':
    ' — Unverschlüsselt: Jeder im Netzwerkpfad kann den Schlüssel lesen.',
  'settings.KeyDestinationsModal.public_http_cannot_receive_keys.9151a1c1':
    ' — Öffentliches HTTP kann keine Schlüssel empfangen. Ändern Sie diese Adresse in HTTPS.',
  'settings.KeyDestinationsModal.choose_a_key.68bb8fb8': 'Wählen Sie einen Schlüssel',
  'settings.KeyDestinationsModal.save_a_new_named_key.7982a2de':
    'Speichern Sie einen neuen benannten Schlüssel…',
  'settings.KeyDestinationsModal.save_this_new_key_in.9a0a7afb':
    ' Speichern Sie diesen neuen Schlüssel im geschützten Speicher.',
  'settings.KeyDestinationsModal.choose_a_saved_key_and.065702b0':
    'Wählen Sie einen gespeicherten Schlüssel und geben Sie die Empfängeradresse ein.',
  'settings.KeyDestinationsModal.allowed_on_this_device.bac894b7': 'Auf diesem Gerät zulässig',
  'settings.KeyDestinationsModal.needs_confirmation_on_this_device.55badbda':
    'Auf diesem Gerät ist eine Bestätigung erforderlich',
  'settings.KeyDestinationsModal.allow_unencrypted_http.e905502b':
    'Erlauben Sie unverschlüsseltes HTTP',
  'settings.KeyDestinationsModal.allow_on_this_device.a92ce243': 'Auf diesem Gerät zulassen',
  'settings.KeyDestinationsModal.the_store_key_cannot_be.61f3c9e8':
    'Der Schlüsselspeicher-Schlüssel kann nicht an einen Empfänger gesendet werden.',
  'settings.KeyDestinationsModal.allowed_value_value_retry_the.61f6ca46':
    'Erlaubt {value0} → {value1}. Wiederholen Sie das ursprüngliche Skript. Es wurde nichts automatisch gesendet.',
  'settings.KeyDestinationsModal.allowed_value_value_retry_the.a9933642':
    'Erlaubt {value0} → {value1}. Wiederholen Sie das ursprüngliche Skript.',
  'settings.KeyDestinationsModal.removed_value_value_the_saved.a1ac62ad':
    '{value0} → {value1} entfernt. Der gespeicherte Schlüssel und andere Berechtigungen bleiben erhalten.',
  'settings.KeyDestinationsModal.confirmed_value_value.b96426a6': 'Bestätigt {value0} → {value1}.',
  'settings.KeyDestinationsModal.http_exception_removed_keys_cannot.07f54f86':
    'HTTP-Ausnahme entfernt. Schlüssel können diese unverschlüsselte Adresse nicht verwenden.',
  'settings.LinksSettings.links_that_run_things.6849bb37': 'Links, die Dinge steuern',
  'settings.LinksSettings.each_one_is_an_obsidian.bcfd9260':
    'Bei jeder Adresse handelt es sich um eine obsidian://-Adresse, die beim Öffnen ein Skript oder einen Befehl ausführt – über ein Lesezeichen, eine andere App oder eine Verknüpfung.',
  'settings.LinksSettings.untitled_link.be1c93df': 'Unbenannter Link',
  'settings.LinksSettings.copy_the_link_s_address.331a3bd9': 'Kopieren Sie die Adresse des Links',
  'settings.LinksSettings.change_this_link.f6aa89bf': 'Ändern Sie diesen Link',
  'settings.LinksSettings.add_another_link.a8b73866': 'Fügen Sie einen weiteren Link hinzu',
  'settings.LinksSettings.no_links_yet.30d3e862': 'Noch keine Links',
  'settings.LinksSettings.a_name_for_the_address.f36bdc5a':
    'Ein Name für die Adresse und das Skript oder der Befehl, den sie ausführt.',
  'settings.LinksSettings.add_link.dfe9ca4d': 'Link hinzufügen',
  'settings.LinksSettings.add_a_link_and_set.5eb68448':
    'Fügen Sie einen Link hinzu und richten Sie ihn ein',
  'settings.LinksSettings.new_link.98ee0dfb': 'Neuer Link',
  'settings.LinksSettings.name.dcd1d522': 'Name',
  'settings.LinksSettings.the_part_of_the_address.2929fc21':
    'Der Teil der Adresse nach name=, in Klarschrift und Bindestrichen.',
  'settings.LinksSettings.add_movie.2f79eca6': 'Film hinzufügen',
  'settings.LinksSettings.runs.848f54e8': 'Läuft',
  'settings.LinksSettings.script.102acc10': 'Skript',
  'settings.LinksSettings.choose_a_script.d8ff6dd0': 'Wählen Sie ein Skript…',
  'settings.LinksSettings.search_the_scripts_for_the.e5119ad8':
    'Durchsuchen Sie die Skripte nach dem Skript, das über diesen Link ausgeführt wird',
  'settings.LinksSettings.command.71316697': 'Befehl',
  'settings.LinksSettings.search_the_commands_for_the.ebe2fa5b':
    'Suchen Sie nach den Befehlen, die über diesen Link ausgeführt werden',
  'settings.LinksSettings.wait_for_sync.8d3efbd1': 'Warten Sie auf die Synchronisierung',
  'settings.LinksSettings.run_only_once_obsidian_sync.91ba259b':
    'Nur ausführen, wenn Obsidian Sync den Vault auf den neuesten Stand gebracht hat.',
  'settings.LinksSettings.address.56ef8f20': 'Adresse',
  'settings.LinksSettings.add_param_value_to_hand.2c89675e':
    'Fügen Sie &param=value hinzu, um dem Skript seine Werte zu übergeben.',
  'settings.LinksSettings.delete.e2d0a549': 'Löschen',
  'settings.LinksSettings.remove_this_link.d7173cb1': 'Entfernen Sie diesen Link',
  'settings.LinksSettings.done.11a6767d': 'Fertig',
  'settings.LinksSettings.close_this_window_changes_are.91342d87':
    'Schließen Sie dieses Fenster. Änderungen bleiben erhalten, sobald Sie sie vornehmen',
  'settings.LinksSettings.choose_a_command.58e501e1': 'Wählen Sie einen Befehl…',
  'settings.LinksSettings.runs_the_script_value.c5e5c031': 'Führt das Skript {value0} aus',
  'settings.LinksSettings.runs_a_script_none_chosen.1b6f1723':
    'Führt ein Skript aus – noch keines ausgewählt',
  'settings.LinksSettings.runs_the_command_value.c397fa11': 'Führt den Befehl {value0} aus',
  'settings.LinksSettings.runs_a_command_none_chosen.67edb64d':
    'Führt einen Befehl aus – noch keiner ausgewählt',
  'settings.LinksSettings.link_copied.d12860c2': 'Link kopiert',
  'settings.LintRuleModal.on.13001175': 'An',
  'settings.LintRuleModal.switched_off_the_rule_checks.db75c03b':
    'Im ausgeschalteten Zustand prüft die Regel nichts.',
  'settings.LintRuleModal.how_bad.016a19df': 'Wie schlimm',
  'settings.LintRuleModal.an_error_or_a_warning.ea93bb11':
    'Ein Fehler oder eine Warnung, wie die Liste zeigt.',
  'settings.LintRuleModal.where_it_applies.39e44cbf': 'Wo es gilt',
  'settings.LintRuleModal.left_empty_everywhere_lists_are.5675de53':
    'Überall leer gelassen. Listen werden durch Kommas getrennt.',
  'settings.LintRuleModal.only_in.aed9f516': 'Nur in',
  'settings.LintRuleModal.folders_or_globs_like_projects.3f2b32ac':
    'Ordner oder Globs wie Projects/*/Tasks.',
  'settings.LintRuleModal.everywhere.dcc10bfd': 'Überall',
  'settings.LintRuleModal.not_in.1bc8651b': 'Nicht drin',
  'settings.LintRuleModal.folders_or_globs_left_alone.a5983464':
    'Darin bleiben Ordner oder Klumpen allein zurück.',
  'settings.LintRuleModal.nowhere.7e32434d': 'Nirgends',
  'settings.LintRuleModal.note_types.52d728fb': 'Notiztypen',
  'settings.LintRuleModal.only_notes_whose_type_is.a3e5cd66':
    'Nur Notizen, deren Typ einer dieser ist.',
  'settings.LintRuleModal.any_type.b05fc1fe': 'Jeder Typ',
  'settings.LintRuleModal.having_a_property.07dd0569': 'Eine Immobilie haben',
  'settings.LintRuleModal.only_notes_with_this_property.adbc72b9':
    'Nur Notizen mit dieser Eigenschaft – gleich dem Wert, wenn einer angegeben ist.',
  'settings.LintRuleModal.property.40040cb1': 'Eigenschaft',
  'settings.LintRuleModal.any_value.004f62d2': 'Jeder Wert',
  'settings.LintRuleModal.settings_of_the_rule.99e57b0c': 'Einstellungen der Regel',
  'settings.LintRuleModal.as_it_ships.be4ca4de': 'So wie es versendet wird',
  'settings.LintRuleModal.put_this_rule_back_the.6e2ebc57':
    'Setzen Sie diese Regel auf die Art und Weise zurück, wie das Plugin sie ausliefert',
  'settings.LintRuleModal.done.11a6767d': 'Fertig',
  'settings.LintRuleModal.close_this_the_changes_are.459403b0':
    'Schließen Sie dies; Die Änderungen werden gespeichert',
  'settings.LintRuleModal.error.54a0e8c1': 'Fehler',
  'settings.LintRuleModal.warning.e981ddae': 'Warnung',
  'settings.LinterSettings.the_linter_checks_notes_against.67baa82b':
    'Der Linter prüft Notizen anhand der folgenden Regeln – eine Notiz nach der anderen, einen Ordner oder den gesamten Vault – und listet in einer eigenen Registerkarte auf, was ihnen nicht folgt. Vieles davon kann dort auf einmal behoben werden; Der Rest lässt sich an der Linie öffnen, um ihn von Hand zu fixieren.',
  'settings.LinterSettings.linter.99bede8d': 'Notizprüfung',
  'settings.LinterSettings.the_tab_with_what_the.e019607d':
    'Die Registerkarte mit dem, was beim letzten Lauf gefunden wurde.',
  'settings.LinterSettings.open_linter.72c54acd': 'Linter öffnen',
  'settings.LinterSettings.close_the_settings_and_open.125786ff':
    'Schließen Sie die Einstellungen und öffnen Sie die Registerkarte des Linters',
  'settings.LinterSettings.folders_to_skip.ad324780': 'Ordner zum Überspringen',
  'settings.LinterSettings.no_rule_looks_in_these.2a478951':
    'Darin sieht keine Regel vor, es sei denn, eine Notiz darin ist mit dem Namen versehen. Durch Kommas getrennt; ein Ordner oder ein Glob wie Archive/**.',
  'settings.LinterSettings.templates_attachments.2440bdba': 'Vorlagen, Anhänge',
  'settings.LinterSettings.rules.4228aeb0': 'Regeln',
  'settings.LinterSettings.each_can_be_switched_off.240786af':
    'Jeder kann ausgeschaltet werden, es kann mitgeteilt werden, wie schlecht ein Befund ist, in bestimmten Ordnern oder Notiztypen gespeichert und mit eigenen Einstellungen versehen werden.',
  'settings.LinterSettings.set_up_value.45578254': '{value0} einrichten',
  'settings.LinterSettings.rules_of_your_own.f29b0461': 'Eigene Regeln',

  'settings.LinterSettings.no_script_rules_yet.37cf496e': 'Noch keine Skriptregeln.',
  'settings.LinterSettings.not_in_value.d95a4831': 'nicht in {value0}',
  'settings.LinterSettings.for_value_notes.670a9ee4': 'für {value0} Notizen',
  'settings.LinterSettings.is_set.c7d5e11f': ' eingestellt ist',
  'settings.LinterSettings.error.54a0e8c1': 'Fehler',
  'settings.LinterSettings.warning.e981ddae': 'Warnung',
  'settings.LogsSettings.logs_note_types.0793e6f2': 'Protokolliert Notiztypen',
  'settings.LogsSettings.optional_comma_separated_list_of.8730c2d2':
    'Optionale durch Kommas getrennte Liste von Notiztypen, die als Protokollnotizen berücksichtigt werden sollen.',
  'settings.LogsSettings.e_g_journal_log_daily.a54faefe': 'z.B. {literal0}',
  'settings.ModelEditModal.add_model.7060e824': 'Modell hinzufügen',
  'settings.ModelEditModal.edit_model.e76cc0ba': 'Modell bearbeiten',
  'settings.ModelEditModal.model_id.089ef2b6': 'Modell-ID',
  'settings.ModelEditModal.api_model_identifier_e_g.5c0e2892':
    'API-Modell-ID (z. B. gpt-4o, claude-sonnet-4-20250514).',
  'settings.ModelEditModal.e_g_gpt_o.c6a41eb7': 'z.B. {literal0}',
  'settings.ModelEditModal.display_name.2b7f6a84': 'Anzeigename',
  'settings.ModelEditModal.optional_label_shown_in_model.3bf6fb7f':
    'Optionales Etikett wird in der Modellauswahl angezeigt.',
  'settings.ModelEditModal.e_g_gpt_o.c9f23b2e': 'z.B. {literal0}',
  'settings.ModelEditModal.context_window.7696d085': 'Kontextfenster',
  'settings.ModelEditModal.maximum_input_tokens_the_model.c52a6a14':
    'Maximale Eingabetokens, die das Modell unterstützt.',
  'settings.ModelEditModal.max_output_tokens.397dda07': 'Maximale Anzahl ausgegebener Token',
  'settings.ModelEditModal.maximum_tokens_in_a_single.476bdff9':
    'Maximale Token in einer einzelnen Antwort.',
  'settings.ModelEditModal.request_timeout_seconds.1b1b1d08': 'Anforderungszeitlimit (Sekunden)',
  'settings.ModelEditModal.wait_for_the_first_response.08adebcb':
    'Warten Sie auf die erste Antwort oder den nächsten Teil, nicht auf die gesamte Antwort. 1–3600 Sekunden; empty verwendet das globale Timeout. Gilt für Chat und Hintergrundarbeit mit diesem Modell.',
  'settings.ModelEditModal.global_timeout.542c2bf3': 'Globales Timeout',
  'settings.ModelEditModal.reasoning.d8211e24': 'Argumentation',
  'settings.ModelEditModal.enable_reasoning_thinking_for_supported.f198e996':
    'Aktivieren Sie Argumentation/Denken für unterstützte Modelle.',
  'settings.ModelEditModal.thinking_effort.264c28cb': 'Denkanstrengung',
  'settings.ModelEditModal.controls_how_much_reasoning_the.cccb2ae5':
    'Steuert, wie viel Argumentation das Modell durchführt. Belassen Sie die Standardeinstellung für das eigene Verhalten des Modells.',
  'settings.ModelEditModal.delete_model.b7828ba0': 'Modell löschen',
  'settings.ModelEditModal.delete_value_agents_using_it.c65217d0':
    '{value0} löschen? Agenten, die es verwenden, haben kein Modell, bis eines vorhanden ist\n        erneut gewählt.',
  'settings.ModelEditModal.save.1509f561': 'Speichern',
  'settings.ModelEditModal.keep_these_settings_and_close.88a64dfa':
    'Behalten Sie diese Einstellungen bei und schließen Sie',
  'settings.ModelEditModal.delete.e2d0a549': 'Löschen',
  'settings.ModelEditModal.remove_this_model_from_the.2838dd4b':
    'Entfernen Sie dieses Modell vom Anbieter',
  'settings.ModelEditModal.enter_seconds_correct_this_value.508147a7':
    'Geben Sie 1–3600 Sekunden ein. Korrigieren Sie diesen Wert vor dem Speichern.',
  'settings.OtherSettings.look.a0de5719': 'Suchen',
  'settings.OtherSettings.full_width_sidebars.bc7a2b4e': 'Seitenleisten in voller Breite',
  'settings.OtherSettings.make_sidebars_take_the_full.15d01abc':
    'Stellen Sie sicher, dass die Seitenleisten auf einem Telefon die gesamte Bildschirmbreite einnehmen.',
  'settings.OtherSettings.half_width_sidebars_on_tablet.9c66ca63':
    'Seitenleisten mit halber Breite auf dem Tablet',
  'settings.OtherSettings.make_sidebars_take_half_the.f915aa8e':
    'Stellen Sie sicher, dass die Seitenleisten auf einem Tablet die halbe Bildschirmbreite einnehmen.',
  'settings.OtherSettings.css_snippets_folder.0f718ada': 'CSS-Snippets-Ordner',
  'settings.OtherSettings.vault_folder_with_css_files.063bfc1c':
    'Vault-Ordner mit CSS-Dateien zur automatischen Anwendung als Style-Snippets. Zum Deaktivieren leer lassen.',
  'settings.OtherSettings.e_g_snippets.d1877812': 'z.B. {literal0}',
  'settings.OtherSettings.drawn_by_abele_in_a.3c7dbc19': 'Von Abele in einer Notiz gezeichnet',
  'settings.OtherSettings.each_one_in_place_of.7bc5aa3f':
    'Jedes anstelle von Obsidians eigener Zeichnung.',
  'settings.OtherSettings.own_drawing_of_properties.909062a8': 'Eigene Grundstückszeichnung',
  'settings.OtherSettings.in_a_note_s_properties.769ed541':
    'In den Eigenschaften einer Notiz: der Kontostand einer Brieftasche neben einem Link dazu, in Zahlenfeldern berechnete Beträge und Karten für die Eigenschaften „Datei“ und „Dateien“ sowie für den Umschlag. Off ist Obsidians eigene Zeichnung.',
  'settings.OtherSettings.counter_properties.8ebc8e5b': 'Gegeneigenschaften',
  'settings.OtherSettings.comma_separated_property_names_drawn.054f1654':
    'Durch Kommas getrennte Eigenschaftsnamen, die als Zahl mit den Schaltflächen „–“ und „+“ dargestellt werden. Ein leerer Wert zählt als 0. Erfordert eine eigene Zeichnung der Eigenschaften.',
  'settings.OtherSettings.e_g_reps_glasses.bcb26756': 'z.B. {literal0}',
  'settings.OtherSettings.mermaid_viewer.0fee57c7': 'Diagramme zeichnen',
  'settings.OtherSettings.draw_mermaid_diagrams_at_the.48ca67fa':
    'Mermaid- und pele-Blöcke mit Zoom, Verschieben und Vollbild anzeigen. Ausschalten, um den Quelltext als Code anzuzeigen.',
  'settings.OtherSettings.open_canvases_in_abele.0104f91b': 'Offene Leinwände in Abele',
  'settings.OtherSettings.open_diagrams_in_the_read.b48fc66f':
    'Öffnen Sie Diagramme im schreibgeschützten Viewer mit exemplarischen Schritten. Verwenden Sie „In Obsidian Canvas öffnen“ in der Kopfzeile, um ein Diagramm im nativen Canvas zu bearbeiten.',
  'settings.OtherSettings.editor_syntax_highlighting.9bbd35c2': 'Hervorhebung der Editor-Syntax',
  'settings.OtherSettings.highlight_more_fenced_code_languages.89e723bd':
    'Heben Sie weitere Sprachen mit eingezäuntem Code in der Quell- und Live-Vorschau hervor, indem Sie das eigene Thema von Obsidian verwenden. Native Hervorhebungen und gerenderte Blöcke bleiben unverändert. Die zusätzliche Hervorhebung ist auf Blöcke mit 32.768 Zeichen und 1.000 Zeilen beschränkt.',
  'settings.OtherSettings.opening_notes.d2eceee4': 'Eröffnungsnotizen',
  'settings.OtherSettings.remember_where_notes_were_left.1010d0b2':
    'Denken Sie daran, wo Notizen hinterlassen wurden',
  'settings.OtherSettings.open_each_note_at_the.c4f04706':
    'Öffnen Sie jede Notiz mit dem Bildlauf und dem Cursor, an dem sie belassen wurde, und bleiben Sie auf diesem Gerät. Ein Link zu einer Überschrift oder einem Block, einem Suchergebnis oder der Hervorhebung eines Buchs wird weiterhin an seiner eigenen Stelle angezeigt.',
  'settings.OtherSettings.maps.119e66d1': 'Karten',
  'settings.OtherSettings.coordinates_property.afe852a5': 'Koordinateneigenschaft',
  'settings.OtherSettings.note_property_holding_a_place.d3b2dd8b':
    'Beachten Sie die Eigenschaft, die einen Ort als „lat, lon“ enthält. Der Agent wird angewiesen, in dieses zu schreiben.',
  'settings.OtherSettings.coordinates.29abdbc9': 'Koordinaten',
  'settings.OtherSettings.map_style.62a4d250': 'Kartenstil',
  'settings.OtherSettings.how_maps_in_notes_and.dc2e0608':
    'So sehen Karten in Notizen und Chats aus. Die kostenlosen Styles benötigen keinen Schlüssel oder Account.',
  'settings.OtherSettings.style_url.221b2c65': 'Stil-URL',
  'settings.OtherSettings.a_maplibre_style_json_of.2c7c7cee':
    'Eine MapLibre style.json Ihres eigenen Anbieters.',
  'settings.OtherSettings.the_plugin.cb8c07f4': 'Das Plugin',
  'settings.OtherSettings.changelog.ead07c84': 'Änderungsprotokoll',
  'settings.OtherSettings.see_what_changed_in_every.b28c48a6':
    'Sehen Sie, was sich in jeder Plugin-Version geändert hat, die neueste zuerst.',
  'settings.OtherSettings.open_changelog.f8738613': 'Änderungsprotokoll öffnen',
  'settings.OtherSettings.open_the_plugin_changelog.f99c92b8':
    'Öffnen Sie das Plugin-Änderungsprotokoll',
  'settings.OtherSettings.keyboard_diagnostics.b559c4cd': 'Tastaturdiagnose',
  'settings.OtherSettings.show_at_the_top_of.2cad0798':
    'Zeigen Sie oben auf dem Bildschirm an, was die App über die Bildschirmtastatur meldet – für einen Screenshot, wenn ein Dialog darunter landet. Bleibt auf diesem Gerät.',
  'settings.OtherSettings.date_properties.9201e6b8': 'Datumseigenschaften',
  'settings.OtherSettings.comma_separated_property_names_drawn.2b3d1640':
    'Durch Kommas getrennte Eigenschaftsnamen, die als Datum dargestellt werden, mit Schaltflächen für einen Tag vor und zurück, wie weit es entfernt ist und einer Schaltfläche für die tägliche Notiz. Erfordert eine eigene Zeichnung der Eigenschaften.',
  'settings.OtherSettings.priority_properties.21f4bae9': 'Vorrangige Eigenschaften',
  'settings.OtherSettings.comma_separated_property_names_drawn.b31eb248':
    'Durch Kommas getrennte Eigenschaftsnamen, dargestellt als Aufgabenpriorität, niedrig, mittel oder hoch, mit Schaltflächen zum Erhöhen und Verringern der Priorität. Erfordert eine eigene Zeichnung der Eigenschaften.',
  'settings.OtherSettings.label_properties.7ad8c49d': 'Etiketteneigenschaften',
  'settings.OtherSettings.comma_separated_property_names_drawn.fcb4c6c7':
    'Durch Kommas getrennte Eigenschaftsnamen, die als Beschriftungen gezeichnet und aus den bereits im Vault verwendeten oder eingegebenen hinzugefügt wurden. Erfordert eine eigene Zeichnung der Eigenschaften.',
  'settings.OtherSettings.group_properties.23d1a496': 'Gruppeneigenschaften',
  'settings.OtherSettings.comma_separated_property_names_that.cb39dad8':
    'Durch Kommas getrennte Eigenschaftsnamen, die neben ihrer Liste eine Schaltfläche erhalten, mit der eine der bereits als Gruppen verwendeten Notizen hinzugefügt wird. Die Liste wird weiterhin wie gewohnt abgetippt. Erfordert eine eigene Zeichnung der Eigenschaften.',
  'settings.QuickButtonSettings.a_round_button_at_the.aa095d26':
    'Eine runde Taste am Rand des Bildschirms eines Telefons. Es öffnet sich ein Menü mit Schnellaktionen für alles, was vorne angezeigt wird: Ihre eigenen Aktionen unten, die Kopfzeilenschaltflächen einer Notiz und was das Plugin dort bietet – die Suche und Hervorhebungen eines Buchs, den Timer und den Chat einer Notiz. Es steht Ihnen beim Lesen oder Tippen nicht im Weg. Ziehen Sie es, um es zu verschieben. Es behält die Seite und Höhe bei, auf der es belassen wurde.',
  'settings.QuickButtonSettings.show_the_quick_button.65b455f7':
    'Zeigen Sie die Schnellschaltfläche an',
  'settings.QuickButtonSettings.on_a_phone_it_is.0737337d':
    'Auf einem Telefon. Es ist ein Konzept, also beginnt es ausgeschaltet.',
  'settings.QuickButtonSettings.also_on_a_tablet.5f696152': 'Auch auf einem Tablet',
  'settings.QuickButtonSettings.show_it_on_a_tablet.015eac3d':
    'Zeigen Sie es sowohl auf einem Tablet als auch auf einem Telefon.',
  'settings.QuickButtonSettings.side.630ef00b': 'Seite',
  'settings.QuickButtonSettings.the_edge_of_the_screen.20ef4e46':
    'Der Rand des Bildschirms, an dem es steht. Durch Ziehen wird es geändert.',
  'settings.QuickButtonSettings.height.bfe2eca4': 'Höhe',
  'settings.QuickButtonSettings.dragged_higher_than_where_it.8e838ed1':
    'Wird höher gezogen als dort, wo es sich befindet, über der unteren Leiste jedes Bildschirms.',
  'settings.QuickButtonSettings.where_it_rests_just_above.3d9aff94':
    'Wo es liegt: direkt über der unteren Leiste jedes Bildschirms.',
  'settings.QuickButtonSettings.put_it_back.55057d7e': 'Legen Sie es zurück',
  'settings.QuickButtonSettings.move_it_back_down_to.4bb8ca2b':
    'Bewegen Sie es wieder nach unten, wo es aufliegt',
  'settings.QuickButtonSettings.it_is_already_where_it.36b74557':
    'Es ist bereits dort, wo es ruht; Ziehen Sie es, um es anzuheben',
  'settings.QuickButtonSettings.your_actions.6c06c355': 'Ihre Handlungen',
  'settings.QuickButtonSettings.at_the_top_of_the.b6848b73':
    'Oben im Menü, in dieser Reihenfolge. Ein Befehl wird nur dort angezeigt, wo er ausgeführt werden kann. Daher wird ein für Notizen gedachter Befehl nicht über ein Buch angeboten.',
  'settings.QuickButtonSettings.nothing_of_your_own_yet.3d8c2002': 'Noch nichts Eigenes.',
  'settings.QuickButtonSettings.name_in_the_menu.feca41eb': 'Name im Menü',
  'settings.QuickButtonSettings.choose_the_icon_it_has.e8357476':
    'Wählen Sie das Symbol im Menü aus',
  'settings.QuickButtonSettings.already_the_first.eab62d41': 'Schon der Erste',
  'settings.QuickButtonSettings.move_it_up_the_menu.20938d10':
    'Verschieben Sie es im Menü nach oben',
  'settings.QuickButtonSettings.already_the_last.a6ec4b12': 'Schon der Letzte',
  'settings.QuickButtonSettings.move_it_down_the_menu.dc508335':
    'Verschieben Sie es im Menü nach unten',
  'settings.QuickButtonSettings.take_it_out_of_the.4a64934c': 'Nehmen Sie es aus dem Menü',
  'settings.QuickButtonSettings.add_a_command.b907f252': 'Fügen Sie einen Befehl hinzu',
  'settings.QuickButtonSettings.search_obsidian_s_commands_any.4054c0d7':
    'Durchsuchen Sie die Befehle von Obsidian – alle Plugins – nach einem Befehl, den Sie in das Menü einfügen können',
  'settings.QuickButtonSettings.add_a_script.c4526bc4': 'Fügen Sie ein Skript hinzu',
  'settings.QuickButtonSettings.search_your_scripts_for_one.df40b370':
    'Durchsuchen Sie Ihre Skripte nach einem, das Sie in das Menü einfügen können',
  'settings.QuickButtonSettings.take_out_of_the_menu.756bbe6a': 'Aus der Speisekarte nehmen',
  'settings.QuickButtonSettings.take_value_out_of_the.f628c5a3':
    '{value0} aus dem Schnellmenü entfernen? Der Befehl oder das Skript selbst bleibt bestehen.',
  'settings.QuickButtonSettings.right.883361d5': 'Rechts',
  'settings.QuickButtonSettings.left.58eb9032': 'Links',
  'settings.QuickButtonSettings.unnamed.e504e615': 'Unbenannt',
  'settings.QuickButtonSettings.command_value.b7bcffe4': 'Befehl: {value0}',
  'settings.QuickButtonSettings.script_value.804f5354': 'Skript: {value0}',
  'settings.ReaderSettings.epub_books_in_the_vault.7574b8de':
    'EPUB-Bücher im Vault werden in einem eigenen Reader-Tab geöffnet, und PDFs können dies auch. Diese Auswahl gilt für jedes Buch und kann auch auf der Registerkarte eines Buchs mit der Schaltfläche „Aa“ geändert werden.',
  'settings.SavedKeyRequestModal.send_saved_keys.618ddec9': 'Gespeicherte Schlüssel senden?',
  'settings.SavedKeyRequestModal.key.99a52df3': 'Schlüssel',
  'settings.SavedKeyRequestModal.keys.f0d66a79': 'Schlüssel',
  'settings.SavedKeyRequestModal.sent_to.4e7201c7': 'Gesendet an',

  'settings.SavedKeyRequestModal.cancel.19766ed6': 'Abbrechen',
  'settings.SavedKeyRequestModal.send_nothing_and_leave_the.3e8911a8':
    'Senden Sie nichts und lassen Sie die Berechtigungen unverändert',
  'settings.SavedKeyRequestModal.allow_address_and_send.47ca9b17': 'Adresse zulassen und senden',
  'settings.SavedKeyRequestModal.remember_value_for_these_keys.15742eb3':
    'Merken Sie sich {value0} für diese Schlüssel auf diesem Gerät und senden Sie dann die Anfrage',
  'settings.SavedKeyRequestModal.could_not_save_this_key.b1ac8a82':
    'Diese Schlüsselberechtigung konnte nicht gespeichert werden, daher wurde nichts gesendet. Überprüfen Sie die wichtigsten Ziele und versuchen Sie es erneut.',
  'settings.ScriptsSettings.library.dc20b3d5': 'Bibliothek',
  'settings.ScriptsSettings.every_script_in_the_folder.8e2a3585':
    'Jedes Skript im Ordner und was es tut',
  'settings.ScriptsSettings.selection_menus.22601a32': 'Auswahlmenüs',
  'settings.ScriptsSettings.choose_scripts_for_books_and.71bc0ae4':
    'Wählen Sie unabhängig voneinander Skripte für Bücher und Chats aus',
  'settings.ScriptsSettings.header_buttons.1d80ae78': 'Kopfzeilen-Schaltflächen',
  'settings.ScriptsSettings.buttons_in_note_headers_that.922a8f0e':
    'Schaltflächen in Notizkopfzeilen, die ein Skript ausführen',
  'settings.ScriptsSettings.automations.ad1fb9ec': 'Automatisierungen',
  'settings.ScriptsSettings.scripts_that_run_by_themselves.32dace66':
    'Skripte, die von selbst ausgeführt werden, wenn sich eine Aufgabe oder eine Notiz ändert',
  'settings.ScriptsSettings.startup.65d48235': 'Start-up',
  'settings.ScriptsSettings.scripts_that_run_each_time.695fa1cc':
    'Skripte, die bei jedem Start von Obsidian ausgeführt werden',
  'settings.ScriptsSettings.general.c910d474': 'Allgemein',
  'settings.ScriptsSettings.turn_scripts_on_and_choose.d4857b2d':
    'Aktivieren Sie Skripte und wählen Sie deren Ordner aus',
  'settings.ScriptsSettings.books.9da7f76b': 'Bücher',
  'settings.ScriptsSettings.scripts_on_words_selected_in.862c0f97':
    'Skripte zu Wörtern, die in einem Buch ausgewählt wurden',
  'settings.ScriptsSettings.chats.ef5b4049': 'Chats',
  'settings.ScriptsSettings.scripts_chosen_for_words_selected.6086fa3b':
    'Ausgewählte Skripte für in einem Chat ausgewählte Wörter',
  'settings.SecretField.hide_the_key.46a22923': 'Verstecke den Schlüssel',
  'settings.SecretField.show_the_key.90d90eb7': 'Zeigen Sie den Schlüssel',
  'settings.SecretField.copy_the_key.30d7860a': 'Kopieren Sie den Schlüssel',
  'settings.SecretField.new_key.31ffdeb5': 'Neuer Schlüssel...',
  'settings.SecretField.save_key.b6e0aef2': 'Schlüssel speichern',
  'settings.SecretField.the_key.144976d8': 'Der Schlüssel',
  'settings.SecretStoreSettings.synced_keys.a764d83d': 'Synchronisierte Schlüssel',
  'settings.SecretStoreSettings.every_api_key_and_token.5e8bd0ab':
    'Jeder API-Schlüssel und jedes Token werden in einem verschlüsselten Speicher gespeichert, der mit den Einstellungen des Plugins synchronisiert wird. Für jedes Gerät ist nur die einmal eingegebene Passphrase erforderlich. Ohne sie ist der Speicher auf keinem Gerät und in jeder Kopie der Einstellungsdatei lesbar.',
  'settings.SecretStoreSettings.status.920e413c': 'Status',
  'settings.SecretStoreSettings.all_keys.9e5c5da4': 'Alle Schlüssel',
  'settings.SecretStoreSettings.every_key_the_plugin_uses.f09952da':
    'Jeder Schlüssel, den das Plugin auf diesem Gerät verwendet: wozu er dient, ob er synchronisiert ist und eine Möglichkeit, ihn anzuzeigen oder zu kopieren.',
  'settings.SecretStoreSettings.show.0df6f1ca': 'Anzeigen',
  'settings.SecretStoreSettings.list_every_key_on_this.ab7f11c1':
    'Listen Sie jeden Schlüssel auf diesem Gerät auf',
  'settings.SecretStoreSettings.passphrase.e7611f05': 'Passphrase',
  'settings.SecretStoreSettings.at_least_characters_typed_on.fcf5d43e':
    'Mindestens 12 Zeichen. Auf jedem Gerät getippt, das über die Tasten verfügen sollte; nichts kann es wiederherstellen.',
  'settings.SecretStoreSettings.repeat_the_passphrase.4b93336c': 'Wiederholen Sie die Passphrase',
  'settings.SecretStoreSettings.passphrase_again.47b97578': 'Passphrase erneut eingeben',
  'settings.SecretStoreSettings.keys_moving_into_the_store.fadc3573':
    'Schlüssel werden in den Schlüsselspeicher gebracht: {value0}',
  'settings.SecretStoreSettings.cancel.19766ed6': 'Abbrechen',
  'settings.SecretStoreSettings.close_this_and_change_nothing.80f7e492':
    'Ohne Änderungen schließen',
  'settings.SecretStoreSettings.turn_on.5a1f096a': 'Aktivieren',
  'settings.SecretStoreSettings.encrypt_this_device_s_keys.4fb9ef24':
    'Verschlüsseln Sie die Schlüssel dieses Geräts im Schlüsselspeicher und synchronisieren Sie sie',
  'settings.SecretStoreSettings.moves_the_keys_this_device.07bf9910':
    'Verschiebt die Schlüssel dieses Geräts unter einer von Ihnen gewählten Passphrase in den Speicher.',
  'settings.SecretStoreSettings.set_up.4da10f1f': 'Einrichten',
  'settings.SecretStoreSettings.choose_a_passphrase_for_the.6f457f5b':
    'Wählen Sie eine Passphrase für die synchronisierten Schlüssel',
  'settings.SecretStoreSettings.unlock_on_this_device.ec7699b7': 'Auf diesem Gerät entsperren',
  'settings.SecretStoreSettings.unlock.4ac709aa': 'Entsperren',
  'settings.SecretStoreSettings.open_the_store_here_and.879288fd':
    'Öffnen Sie den Schlüsselspeicher hier und stecken Sie die Schlüssel in den Schlüsselbund dieses Geräts',
  'settings.SecretStoreSettings.new_passphrase.5cc14549': 'Neue Passphrase',
  'settings.SecretStoreSettings.every_other_device_asks_for.6b298c8e':
    'Jedes andere Gerät fragt einmal danach, wenn die Einstellungen es das nächste Mal erreichen.',
  'settings.SecretStoreSettings.repeat_the_new_passphrase.c0e298be':
    'Wiederholen Sie die neue Passphrase',
  'settings.SecretStoreSettings.new_passphrase_again.6ab2f2bb': 'Wieder neue Passphrase',
  'settings.SecretStoreSettings.change_the_passphrase.a9a3e51b': 'Ändern Sie die Passphrase',
  'settings.SecretStoreSettings.change.c0bf75bd': 'Ändern',
  'settings.SecretStoreSettings.encrypt_the_store_again_under.d0f767af':
    'Verschlüsseln Sie den Schlüsselspeicher erneut mit der neuen Passphrase',
  'settings.SecretStoreSettings.change_passphrase.a0ffb851': 'Passphrase ändern',
  'settings.SecretStoreSettings.the_keys_are_encrypted_again.78c3db29':
    'Die Schlüssel werden erneut verschlüsselt. Andere Geräte arbeiten weiterhin mit ihren Schlüsseln und fragen nach der neuen Passphrase.',
  'settings.SecretStoreSettings.choose_a_new_passphrase.bedf8286':
    'Wählen Sie eine neue Passphrase',
  'settings.SecretStoreSettings.remove_from_this_device.43b9a522': 'Von diesem Gerät entfernen',
  'settings.SecretStoreSettings.the_passphrase_and_every_key.adebe1d0':
    'Die Passphrase und jeder Schlüssel im Schlüsselspeicher verlassen dieses Gerät. Der Schlüsselspeicher und andere Geräte bewahren sie auf; entsperren Sie sie erneut, um sie zurückzubekommen.',
  'settings.SecretStoreSettings.remove.c3812fc4': 'Entfernen',
  'settings.SecretStoreSettings.take_the_synced_keys_off.537f867f':
    'Entfernen Sie die synchronisierten Schlüssel von diesem Gerät',
  'settings.SecretStoreSettings.turn_off.06f0e210': 'Ausschalten',
  'settings.SecretStoreSettings.the_store_leaves_the_settings.617a2df0':
    'Der Schlüsselspeicher verlässt die Einstellungen. Jedes entsperrte Gerät behält seine Schlüssel in seinem eigenen Schlüsselbund; Bei jedem anderen Gerät müssen sie manuell eingegeben werden.',
  'settings.SecretStoreSettings.stop_syncing_keys_keeping_them.e20ea31d':
    'Stoppen Sie die Synchronisierung von Schlüsseln und behalten Sie sie auf jedem Gerät',
  'settings.SecretStoreSettings.start_over.5eed7e9f': 'Fangen Sie von vorne an',
  'settings.SecretStoreSettings.removes_the_store_from_the.2b150d0f':
    'Entfernt den Schlüsselspeicher aus den Einstellungen auf jedem Gerät für ein neues mit einer neuen Passphrase. Die Tasten, über die dieses Gerät verfügt, bleiben hier.',
  'settings.SecretStoreSettings.remove_the_synced_keys_from.8aac0de2':
    'Entfernen Sie die synchronisierten Schlüssel aus den Einstellungen',
  'settings.SecretStoreSettings.remove_the_synced_keys_from.b2662195':
    'Entfernen Sie die synchronisierten Schlüssel von diesem Gerät',
  'settings.SecretStoreSettings.the_passphrase_and_the_value.33ba68ae':
    'Die Passphrase und der {value0} im Schlüsselspeicher verlassen den Schlüsselbund dieses Geräts. Funktionen, die sie verwenden, funktionieren hier nicht mehr, bis sie wieder entsperrt werden.',
  'settings.SecretStoreSettings.turn_off_synced_keys.f0438a6c':
    'Schalten Sie synchronisierte Schlüssel aus',
  'settings.SecretStoreSettings.the_store_leaves_the_settings.b87b1814':
    'Der Schlüsselspeicher hinterlässt die Einstellungen auf jedem Gerät. Entsperrte Geräte behalten ihre Schlüssel; Ein neues Gerät wird sie nicht bekommen.',
  'settings.SecretStoreSettings.the_store_is_removed_from.7d71216a':
    'Der Schlüsselspeicher wird aus den Einstellungen auf jedem Gerät entfernt, mit allen darin enthaltenen Schlüsseln, die auf keinem Gerät gespeichert sind. Die eigenen Schlüssel dieses Geräts bleiben erhalten.',
  'settings.SecretStoreSettings.off.ca7981b4': 'Aus',
  'settings.SecretStoreSettings.each_device_keeps_its_own.02c01692':
    'Jedes Gerät behält seine eigenen Schlüssel, die auf diesem Gerät eingegeben werden.',
  'settings.SecretStoreSettings.locked_on_this_device.e1223c06': 'Auf diesem Gerät gesperrt',
  'settings.SecretStoreSettings.another_device_keeps_keys_in.f266e954':
    'Ein anderes Gerät bewahrt die Schlüssel im Schlüsselspeicher auf. Geben Sie die Passphrase ein, um sie auch hier zu haben.',
  'settings.SecretStoreSettings.unlocked_on_this_device.09bd8bd4': 'Auf diesem Gerät entsperrt',
  'settings.SecretStoreSettings.out_of_date.c8f1506a': 'Veraltet',
  'settings.SecretStoreSettings.the_passphrase_was_changed_on.43f18603':
    'Die Passphrase wurde auf einem anderen Gerät geändert. Bereits vorhandene Schlüssel funktionieren weiterhin; Geben Sie die neue Passphrase ein, um die Änderungen erneut zu erhalten.',
  'settings.SecretStoreSettings.damaged.3604e21d': 'Beschädigt',
  'settings.SecretStoreSettings.the_store_in_the_settings.d9c2c3b8':
    'Der Speicher in der Einstellungsdatei kann nicht entschlüsselt werden, obwohl dieses Gerät über die richtige Passphrase verfügt: Die Datei wurde von etwas anderem als dem Plugin geändert. Bereits auf diesem Gerät vorhandene Schlüssel funktionieren weiterhin.',
  'settings.SecretStoreSettings.value_in_the_store_a.02db016b':
    '{value0} im Schlüsselspeicher. Ein an einer beliebigen Stelle im Plugin hinzugefügter oder geänderter Schlüssel geht hinein und gelangt mit den Einstellungen zu Ihren anderen Geräten.',
  'settings.SecretStoreSettings.that_passphrase_does_not_open.525fb3a8':
    'Mit dieser Passphrase wird der Schlüsselspeicher nicht geöffnet.',
  'settings.SecretStoreSettings.the_new_passphrase_as_set.f4e9f983':
    'Die neue Passphrase, wie sie auf dem anderen Gerät festgelegt ist.',
  'settings.SecretStoreSettings.the_passphrase_chosen_when_synced.27696e36':
    'Die Passphrase, die beim Aktivieren der synchronisierten Schlüssel ausgewählt wurde.',
  'settings.SecretStoreSettings.the_two_do_not_match.184006b7': 'Die beiden passen nicht zusammen.',
  'settings.SecretStoreSettings.at_least_value_characters.0bd5b7d6': 'Mindestens {value0} Zeichen.',
  'settings.SecretStoreSettings.synced_keys_are_on_value.406e7e86':
    'Synchronisierte Schlüssel sind aktiviert: {value0} Schlüssel im Schlüsselspeicher.',
  'settings.SecretStoreSettings.synced_keys_could_not_be.162ddd6c':
    'Synchronisierte Schlüssel konnten nicht aktiviert werden',
  'settings.SecretStoreSettings.unlocked_value_keys_on_this.646c741b':
    'Entsperrt: {value0} Schlüssel auf diesem Gerät.',
  'settings.SecretStoreSettings.the_store_could_not_be.be373a49':
    'Der Schlüsselspeicher konnte nicht entsperrt werden',
  'settings.SecretStoreSettings.the_passphrase_is_changed_other.b8dd49ec':
    'Die Passphrase wurde geändert. Andere Geräte werden danach fragen.',
  'settings.SecretStoreSettings.the_passphrase_could_not_be.61e326c1':
    'Die Passphrase konnte nicht geändert werden',
  'settings.SecretStoreSettings.the_keys_could_not_be.a70d217b':
    'Die Schlüssel konnten nicht von diesem Gerät entfernt werden',
  'settings.SecretStoreSettings.synced_keys_could_not_be.ac40cb3f':
    'Synchronisierte Schlüssel konnten nicht deaktiviert werden',
  'settings.SecretStoreSettings.the_store_could_not_be.76043571':
    'Der Schlüsselspeicher konnte nicht entfernt werden',
  'settings.SecretsListModal.all_keys.9e5c5da4': 'Alle Schlüssel',
  'settings.SecretsListModal.passphrase.e7611f05': 'Passphrase',
  'settings.SecretsListModal.unlock.4ac709aa': 'Entsperren',
  'settings.SecretsListModal.open_the_store_here_and.6be7e00a':
    'Öffnen Sie hier den Schlüsselspeicher und listen Sie seine Schlüssel auf',
  'settings.SecretsListModal.type_the_passphrase_first.397584ff':
    'Geben Sie zuerst die Passphrase ein',
  'settings.SecretsListModal.the_synced_store_cannot_be.df30eba8':
    'Der synchronisierte Speicher kann nicht entschlüsselt werden, daher können die nur darin enthaltenen Schlüssel nicht aufgelistet werden. Die folgenden Tasten sind diejenigen, über die dieses Gerät verfügt.',
  'settings.SecretsListModal.hide_the_key.46a22923': 'Verstecke den Schlüssel',
  'settings.SecretsListModal.show_the_key.90d90eb7': 'Zeigen Sie den Schlüssel',
  'settings.SecretsListModal.copy_the_key.30d7860a': 'Kopieren Sie den Schlüssel',
  'settings.SecretsListModal.no_keys_yet_a_key.9c87ddf6':
    'Noch keine Schlüssel. Hier wird ein Schlüssel aufgeführt, der irgendwo in den Einstellungen des Plugins eingegeben wurde.',
  'settings.SecretsListModal.copy_all.96e3f09a': 'Alles kopieren',
  'settings.SecretsListModal.put_every_key_on_the.a26cf3c7':
    'Legen Sie jeden Schlüssel nach einer Warnung in die Zwischenablage',
  'settings.SecretsListModal.no_key_is_set.f4f5b239': 'Es ist kein Schlüssel festgelegt',
  'settings.SecretsListModal.copy_every_key.2f918de3': 'Kopieren Sie jeden Schlüssel',
  'settings.SecretsListModal.on_this_device.38b9d88c': 'Auf diesem Gerät',
  'settings.SecretsListModal.synced.5da22fe4': 'Synchronisiert',
  'settings.SecretsListModal.differs_from_keychain.922767e7':
    'Unterscheidet sich vom Schlüsselanhänger',
  'settings.SecretsListModal.only_in_the_store.9bb2ce40': 'Nur im Schlüsselspeicher',
  'settings.SecretsListModal.not_in_the_store.507fd6ce': 'Nicht im Schlüsselspeicher',
  'settings.SecretsListModal.store_locked.d47ee0fe': 'Schlüsselspeicher verschlossen',
  'settings.SecretsListModal.not_set.4895f731': 'Nicht festgelegt',
  'settings.SecretsListModal.this_device_s_keychain_holds.1b27e956':
    'Der Schlüsselbund dieses Geräts enthält einen anderen Wert, der außerhalb des Plugins geändert wurde. Der Wert des Schlüsselspeicher ist der verwendete Wert.',
  'settings.SecretsListModal.in_the_store_but_not.5e27c94a':
    'Im Schlüsselspeicher, aber nicht im Schlüsselbund dieses Geräts. Das Plugin verwendet es immer noch.',
  'settings.SecretsListModal.set_on_this_device_and.db43f1dd':
    'Auf diesem Gerät einstellen und nicht im Schlüsselspeicher. Stellen Sie es erneut ein, um es dort abzulegen.',
  'settings.SecretsListModal.not_used_by_any_setting.85faf2ac':
    'Wird von keiner Einstellung auf diesem Gerät verwendet',
  'settings.SecretsListModal.updated_value.51194723': 'Aktualisiert {value0}',
  'settings.SecretsListModal.every_key_that_is_set.19a2b157':
    'Jeder festgelegte Schlüssel, als Zeilen mit Name = Wert – für einen Passwort-Manager oder zum Einfügen in eine andere App.',
  'settings.SecretsListModal.every_key_listed_here_value.a6aac65e':
    'Jeder hier aufgeführte Schlüssel – {value0} davon – wird als Klartext in die Zwischenablage verschoben, wo er von jeder App auf diesem Gerät gelesen werden kann. ',
  'settings.SecretsListModal.it_is_cleared_from_the.06480e6f':
    'Es wird in einer Minute aus der Zwischenablage gelöscht, wenn es noch dort ist.',
  'settings.SecretsListModal.on_this_device_it_stays.57af8178':
    'Auf diesem Gerät bleibt es dort, bis etwas anderes kopiert wird.',
  'settings.SecretsListModal.synced_keys_are_out_of.408b671b':
    'Synchronisierte Schlüssel sind hier veraltet',
  'settings.SecretsListModal.synced_keys_are_locked_on.3cab7b24':
    'Synchronisierte Schlüssel sind auf diesem Gerät gesperrt',
  'settings.SecretsListModal.that_passphrase_does_not_open.525fb3a8':
    'Mit dieser Passphrase wird der Schlüsselspeicher nicht geöffnet.',
  'settings.SecretsListModal.the_store_may_hold_keys.5b2f6105':
    'Im Schlüsselspeicher befinden sich möglicherweise Schlüssel, über die dieses Gerät nicht verfügt. Ihre Namen sind ebenfalls verschlüsselt, sodass sie nach der Entsperrung aufgelistet werden.',
  'settings.SecretsListModal.the_store_could_not_be.bafdcd54':
    'Der Schlüsselspeicher konnte nicht entsperrt werden.',
  'settings.SyncSettings.waiting_for_you.9f760ab2': 'Warten auf Sie',
  'settings.SyncSettings.code_that_came_from_another.89b6b46f':
    'Code, der von einem anderen Gerät stammt, und private Dateien, auf die eine freigegebene Notiz verweist.',

  'settings.SyncSettings.view_the_exact_incoming_version.6497a546':
    'Sehen Sie sich die genaue eingehende Version an',

  'settings.SyncSettings.allow_or_deny_this_file.5d819259':
    'Erlauben oder verweigern Sie diese Datei für diese Verbindung',
  'settings.SyncSettings.connections.dc273117': 'Verbindungen',
  'settings.SyncSettings.each_connection_works_on_its.4a88585e':
    'Jede Verbindung funktioniert für sich. Durch das Trennen der Verbindung bleiben alle Dateien auf diesem Gerät erhalten.',
  'settings.SyncSettings.no_connections_yet.8697571e': 'Noch keine Verbindungen',
  'settings.SyncSettings.paste_a_token_or_scan.257b9a79':
    'Fügen Sie einen Token ein oder scannen Sie einen QR-Code, um eine Verbindung herzustellen.',
  'settings.SyncSettings.sync_this_connection_now.52cd5ea4':
    'Synchronisieren Sie diese Verbindung jetzt',
  'settings.SyncSettings.pause_share_deleted_files_disconnect.20903c85':
    'Anhalten, teilen, Dateien löschen, trennen',
  'settings.SyncSettings.connect_to_a_server.232ac7de':
    'Stellen Sie eine Verbindung zu einem Server her',
  'settings.SyncSettings.by_a_token_you_were.d2dab8e7':
    'Durch einen Token, der Ihnen gegeben, eingeklebt oder eingescannt wurde.',
  'settings.SyncSettings.connect.c0e20f6d': 'Verbinden…',
  'settings.SyncSettings.paste_a_token_for_a.256b8463':
    'Fügen Sie ein Token für einen Server, Ordner oder eine Gruppe ein',
  'settings.SyncSettings.file_exchange_is_opening_connections.980fe6d6':
    'Der Dateiaustausch wird geöffnet. Verbindungen, die Aufmerksamkeit benötigen, bewahren ihre Dateien hier auf.',
  'settings.SyncSettings.sync_is_opening_if_it.1225ed54':
    'Die Synchronisierung wird geöffnet. Wenn es nicht geöffnet werden kann, starten Sie Obsidian neu und versuchen Sie es erneut.',
  'settings.SyncSettings.the_whole_vault.0a409543': 'das ganze Gewölbe',
  'settings.SyncSettings.deleted_value_from_the_server.70376e92':
    '{value0} vom Server gelöscht. Seine Dateien bleiben auf diesem Gerät.',
  'settings.SyncSettings.keep_syncing_into_the_same.12873e9a':
    'Synchronisieren Sie weiterhin mit demselben lokalen Ordner',
  'settings.SyncSettings.follow_moved_folder.bba3cc92': 'Folgen Sie dem verschobenen Ordner',
  'settings.SyncSettings.restore_from_the_server.6186b8b7': 'Vom Server wiederherstellen',
  'settings.SyncSettings.resume.d640c742': 'Wieder aufnehmen',
  'settings.SyncSettings.pause.858e4ba7': 'Pause',
  'settings.SyncSettings.share.51fc2d24': 'Aktie…',
  'settings.SyncSettings.deleted_files.5352e2e9': 'Gelöschte Dateien',
  'settings.SyncSettings.what_this_device_syncs.979d00ce': 'Was dieses Gerät synchronisiert',
  'settings.SyncSettings.disconnect.f1142965': 'Trennen…',
  'settings.SyncSettings.delete_from_the_server.b3acd04d': 'Vom Server löschen…',
  'settings.SyncSettings.delete_from_the_server_read.5f7e4370':
    'Vom Server löschen: schreibgeschützt',
  'settings.SyncSettings.delete_from_the_server_unavailable.516a170e':
    'Vom Server löschen: nicht verfügbar; Überprüfen Sie die Serververbindung und -version',
  'settings.SyncSettings.the_file_could_not_be.accad798':
    'Die Datei konnte nicht geöffnet werden. Der Inhalt wurde beibehalten. Versuchen Sie es erneut, wenn ein Server verfügbar ist.',
  'settings.SyncSettings.incoming_changes_could_not_be.24745c6e':
    'Eingehende Änderungen konnten nicht geöffnet werden. Öffnen Sie die Synchronisierungseinstellungen erneut, um es erneut zu versuchen.',
  'settings.TaskLabelsSettings.labels.934b8899': 'Etiketten',
  'settings.TaskLabelsSettings.labels_are_read_from_a.310aa3b6':
    'Beschriftungen werden aus der Eigenschaft einer Aufgabe, einem Wert oder einer Liste davon gelesen. Jedes Etikett kann eine Farbe haben; der Rest ist grau.',
  'settings.TaskLabelsSettings.label_property.2b08cac9': 'Label-Eigenschaft',
  'settings.TaskLabelsSettings.the_task_property_labels_are.5b8a2eb7':
    'Die Aufgabeneigenschaftsbeschriftungen werden ausgelesen (Standard: „Beschriftungen“).',
  'settings.TaskLabelsSettings.priority_property.1588ceb0': 'Vorrangiges Eigentum',
  'settings.TaskLabelsSettings.the_task_property_priority_is.19d87f4b':
    'Von der Aufgabeneigenschaft Priorität wird gelesen und geschrieben (Standard: „Priorität“). Ändert nicht, welche Eigenschaften über Widgets verfügen.',
  'settings.TaskLabelsSettings.priority.3092a5f0': 'Priorität',
  'settings.TaskLabelsSettings.add_a_label.43db67d6': 'Fügen Sie ein Etikett hinzu',
  'settings.TaskLabelsSettings.to_colour_a_label_before.7f8888f5':
    'Um ein Etikett einzufärben, bevor eine Aufgabe es trägt.',
  'settings.TaskLabelsSettings.label.0e66373f': 'Etikett',
  'settings.TaskLabelsSettings.add.9fd728c6': 'Hinzufügen',
  'settings.TaskLabelsSettings.add_this_label_to_the.b2c3c5b9':
    'Fügen Sie dieses Label zur Liste hinzu',
  'settings.TasksSettings.tasks_folder.9c703cd1': 'Ordner „Aufgaben“.',
  'settings.TasksSettings.optional_folder_path_to_store.68deedd3':
    'Optionaler Ordnerpfad für Aufgabendateien (Standard: "Tasks").',
  'settings.TasksSettings.enter_tasks_folder_path.685fec4a':
    'Geben Sie den Pfad zum Aufgabenordner ein',
  'settings.TasksSettings.tasks_time_choices.97d2bb52': 'Zeitauswahl für Aufgaben',
  'settings.TasksSettings.optional_comma_separated_list_of.352a5929':
    'Optionale kommagetrennte Liste von Uhrzeiten für Aufgaben (z. B. "09:00,12:00,18:00").',
  'settings.TasksSettings.e_g.4c04e29e': 'z.B. {literal0}',
  'settings.TasksSettings.tasks_date_choices.56987dbf': 'Auswahl des Datums für Aufgaben',
  'settings.TasksSettings.optional_comma_separated_list_of.8d60bd5e':
    'Optionale kommagetrennte Liste von Datumsoptionen für Aufgaben (z. B. "Today,Tomorrow,Next Week").',
  'settings.TasksSettings.e_g_today_tomorrow_next.675fc3c0': 'z.B. {literal0}',
  'settings.TasksSettings.tasks_recurrence_choices.5933e491':
    'Auswahlmöglichkeiten für die Wiederholung von Aufgaben',
  'settings.TasksSettings.optional_comma_separated_list_of.f364b641':
    'Optionale kommagetrennte Liste von Wiederholungen für Aufgaben (z. B. "Daily,Weekly,Monthly").',
  'settings.TasksSettings.e_g_daily_weekly_monthly.1a1c72f3': 'z.B. {literal0}',
  'settings.TasksSettings.busy_day_threshold.ebd745bf': 'Schwellenwert für arbeitsreichen Tag',
  'settings.TasksSettings.number_of_tasks_in_a.def227ff':
    'Anzahl der Aufgaben an einem Tag, um ihn als „geschäftigen Tag“ zu betrachten.',
  'settings.TasksSettings.e_g.8c2fb766': 'z.B. {literal0}',
  'settings.TasksSettings.week_starts_on_monday.1e6c3ee3': 'Die Woche beginnt am Montag',
  'settings.TasksSettings.set_the_first_day_of.0426b53c':
    'Legen Sie den ersten Tag der Woche für Datumsberechnungen fest.',
  'settings.TasksSettings.birth_date.5164b245': 'Geburtsdatum',
  'settings.TasksSettings.where_the_life_layout_of.291ea708':
    'Wo das Life-Layout einer Kalenderbasis beginnt, Ihre Wochen zu zählen. Wird von jeder Basis verwendet.',
  'settings.TasksSettings.life_expectancy.da8e9e4d': 'Lebenserwartung',
  'settings.TasksSettings.the_years_the_life_layout.4cd598a4':
    'Die Jahre, die das Life-Layout anzeigt. Eine Kalenderbasis kann in den Optionen der Ansicht nach einer eigenen Kalenderbasis fragen.',
  'settings.TimeTrackingSettings.time_entry_path_template.b06163ff':
    'Vorlage für den Zeiteintragspfad',
  'settings.TimeTrackingSettings.template_for_new_time_entry.ef1556e8':
    'Vorlage für neue Dateipfade für Zeiteinträge. Variablen: {literal0}, {literal1}, {literal2}, {literalDate}.',
  'settings.TimeTrackingSettings.e_g_time_date_yyyy.dfcd03ce': 'z.B. {literal2}',
  'settings.TimeTrackingSettings.trackable_note_types.4b331926': 'Nachverfolgbare Notiztypen',
  'settings.TimeTrackingSettings.comma_separated_note_types_that.e5d132fd':
    'Durch Kommas getrennte Notiztypen, die die Timer-Schaltfläche in der Kopfzeile anzeigen (z. B. Aufgabe, Projekt).',
  'settings.TimeTrackingSettings.e_g_task.1c985447': 'z.B. {literal0}',
  'settings.TimeTrackingSettings.track_all_notes.41a2243c': 'Verfolgen Sie alle Notizen',
  'settings.TimeTrackingSettings.show_the_timer_button_in.983d0303':
    'Zeigen Sie die Timer-Schaltfläche in der Kopfzeile für alle Notizen an, unabhängig vom Typ.',
  'settings.TransferSettings.send_to_another_device.71ef2876': 'An ein anderes Gerät senden',
  'settings.TransferSettings.tick_what_should_travel_what.be4e856b':
    'Kreuzen Sie an, was reisen soll. Was Sie auswählen, kann als QR-Code, als Text zum Einfügen oder als Datei zum Senden verwendet werden.',
  'settings.TransferSettings.include_keys.f7508fd4': 'Schlüssel einschließen',
  'settings.TransferSettings.api_keys_travel_with_whatever.8cb769f9':
    'API-Schlüssel reisen mit allem, was sie braucht. Eine Übertragung mit einem Schlüssel wird hinter einem Einmalcode gesperrt, der hier angezeigt und auf dem anderen Gerät eingegeben wird.',
  'settings.TransferSettings.what_to_send.bceb988a': 'Was soll ich senden?',
  'settings.TransferSettings.clear.83b12c22': 'Auswahl aufheben',
  'settings.TransferSettings.select_all.1fc9a387': 'Alles auswählen',
  'settings.TransferSettings.send_nothing.1bc92d8a': 'Nichts senden',
  'settings.TransferSettings.send_everything_listed_here.f1ac2a00':
    'Senden Sie alles, was hier aufgeführt ist',
  'settings.TransferSettings.send_everything_under_value.1db19fa3': 'Alles unter {value0} senden',
  'settings.TransferSettings.send_value.c229d699': 'Senden Sie {value0}',
  'settings.TransferSettings.carries_a_key.0d090cb4': 'Trägt einen Schlüssel',
  'settings.TransferSettings.send_all_of_the_value.f01a8818': 'Senden Sie alle {value0}',
  'settings.TransferSettings.nothing_here_can_be_transferred.49a46df4':
    'Hier kann noch nichts übertragen werden.',
  'settings.TransferSettings.preview.324b134f': 'Vorschau',
  'settings.TransferSettings.see_exactly_what_would_be.5a694fa9':
    'Sehen Sie genau, was gesendet werden würde',
  'settings.TransferSettings.choose_something_to_send_first.5fde4c03':
    'Wählen Sie zuerst etwas aus, das Sie senden möchten',
  'settings.TransferSettings.send.f6f4688f': 'Schicken',
  'settings.TransferSettings.hand_what_you_chose_to.f4aa3506':
    'Geben Sie Ihre Auswahl an das andere Gerät weiter',
  'settings.TransferSettings.receive_from_another_device.955f97bb':
    'Von einem anderen Gerät empfangen',
  'settings.TransferSettings.read_the_codes_the_other.7d52f77b':
    'Lesen Sie die Codes, die das andere Gerät anzeigt. Es wird nichts geschrieben, bis Sie gesehen haben, was angekommen ist.',
  'settings.TransferSettings.read_a_transfer.da2dcc0f': 'Übertragung einlesen',
  'settings.TransferSettings.camera_a_photo_of_the.d9996865':
    'Kamera, ein Foto des Codes, eine Datei oder der Text selbst.',
  'settings.TransferSettings.scan.ea1c510d': 'Scan',
  'settings.TransferSettings.read_a_transfer_from_another.60d1c2f6':
    'Übertragung von einem anderen Gerät einlesen',
  'settings.TransferSettings.notes.8a7525b1': 'Notizen',
  'settings.TransferSettings.money_and_time.ebb5a49d': 'Geld und Zeit',
  'settings.TransferSettings.agents.279b44d2': 'Agenten',
  'settings.TransferSettings.buttons.d452583a': 'Schaltflächen',
  'settings.TransferSettings.data.cec3a9b8': 'Daten',
  'settings.TransferSettings.nothing_selected_yet.d6f9822a': 'Noch nichts ausgewählt.',
  'settings.TransferSettings.fits_in_one_code.324a2a38': 'Passt in einen Code.',
  'settings.TransferSettings.takes_value_codes_shown_one.8b7b80a4':
    'Akzeptiert {value0}-Codes, die nacheinander angezeigt werden.',
  'settings.TransferSettings.takes_value_codes_too_many.304d8234':
    'Nimmt {value0}-Codes auf – zu viele zum Fotografieren, daher würde es als Text oder als Datei gespeichert.',
  'settings.TransferSettings.applied_value.d4ffb612': 'Angewendet {value0}.',
  'settings.TransferSettings.value_could_not_be_stored.cf4fe457':
    '{value0} konnte nicht gespeichert werden – der Name, den dieser Vault dafür verwendet, ist einer, den Obsidian nicht annehmen wird.',
  'settings.TransferSettings.value_could_not_be_written.93eaa96e':
    '{value0} konnte nicht geschrieben werden.',
  'settings.ai.AgentEditorModal.agent_value.c67844d1': 'Agent: {value0}',
  'settings.ai.AgentEditorModal.agent.11b39c93': 'Agent',
  'settings.ai.AgentEditorModal.name.dcd1d522': 'Name',
  'settings.ai.AgentEditorModal.shown_in_the_agent_picker.fad20e51':
    'Wird in der Agentenauswahl angezeigt.',
  'settings.ai.AgentEditorModal.description.526e0087': 'Beschreibung',
  'settings.ai.AgentEditorModal.tells_other_agents_what_this.f64bf342':
    'Sagt anderen Agenten, wozu dieser Zweck dient.',
  'settings.ai.AgentEditorModal.utility_agent.e8384fe8': 'Dienstprogrammagent',
  'settings.ai.AgentEditorModal.hidden_from_the_chat_picker.a9f2b9dc':
    'Aus der Chat-Auswahl ausgeblendet. Weiterhin verfügbar für Skripte, Delegation und Entwürfe\n              Rezension.',
  'settings.ai.AgentEditorModal.model.5e2c614c': 'Modell',
  'settings.ai.AgentEditorModal.the_model_this_agent_runs.d092d7ab':
    'Das Modell, auf dem dieser Agent ausgeführt wird.',
  'settings.ai.AgentEditorModal.fallback_model.ed293bb6': 'Fallback-Modell',
  'settings.ai.AgentEditorModal.offered_as_a_retry_when.3264a4a0':
    'Wird als Wiederholungsversuch angeboten, wenn eine Anfrage fehlschlägt. Wird automatisch in delegierten Läufen verwendet.\n              wo niemand einen Knopf drücken kann.',
  'settings.ai.AgentEditorModal.background_model.905a0833': 'Hintergrundmodell',
  'settings.ai.AgentEditorModal.for_naming_and_compacting_this.772ec428':
    'Zur Benennung und Komprimierung der Chats dieses Agenten. Deaktivieren Sie den Plugin-weiten Hintergrund\n              Die Modelleinstellung entscheidet – und auch dort, wenn sie nicht festgelegt ist, entscheidet das eigene Modell des Chats.',
  'settings.ai.AgentEditorModal.they_read_this_agent_s.81992c4a':
    'Sie lesen die Chats dieses Agenten in dieser Reihenfolge, jeweils mit dem vorherigen\n              zurückgegeben: Ihre Nachrichten, bevor der Agent dies tut, seine Antworten, bevor sie bleiben, oder\n              beides. Ein Agent sagt, was er denkt; Ein Drehbuch entscheidet. Ein Chat kann eine eigene Liste führen.',
  'settings.ai.AgentEditorModal.blocks_are_joined_in_order.b7a98cc9':
    'Blöcke werden der Reihe nach mit einer Leerzeile dazwischen verbunden. Verwenden Sie {value0} für das heutige Datum.',
  'settings.ai.AgentEditorModal.block_value.dd05ec6a': 'Blockieren Sie {value0}',
  'settings.ai.AgentEditorModal.move_up.c66feb5e': 'Bewegen Sie sich nach oben',
  'settings.ai.AgentEditorModal.move_down.40bb50da': 'Bewegen Sie sich nach unten',
  'settings.ai.AgentEditorModal.remove.c3812fc4': 'Entfernen',
  'settings.ai.AgentEditorModal.path_to_note.ef6763e6': 'Pfad zur Notiz...',
  'settings.ai.AgentEditorModal.instructions_for_this_agent.6ef9a0d2':
    'Anweisungen für diesen Agenten...',
  'settings.ai.AgentEditorModal.no_prompt_blocks_this_agent.856efff4':
    'Keine Eingabeaufforderungsblöcke. Dieser Agent läuft ohne eigene Anweisungen.',
  'settings.ai.AgentEditorModal.add_text_block.4b0903f4': 'Textblock hinzufügen',
  'settings.ai.AgentEditorModal.append_a_block_of_instructions.b6b6e5b8':
    'Fügen Sie einen hier geschriebenen Block mit Anweisungen hinzu',
  'settings.ai.AgentEditorModal.add_note_block.34512584': 'Notizblock hinzufügen',
  'settings.ai.AgentEditorModal.append_a_block_read_from.f3396cf7':
    'Hängen Sie einen aus einer Notiz im Vault gelesenen Block an',
  'settings.ai.AgentEditorModal.permission_mode.c7a8e6db': 'Berechtigungsmodus',
  'settings.ai.AgentEditorModal.what_this_agent_may_do.5022e01c':
    'Was dieser Agent tun darf, ohne zu fragen.',
  'settings.ai.AgentEditorModal.github_connections.e95944e1': 'GitHub-Verbindungen',
  'settings.ai.AgentEditorModal.off_no_access_ask_approve.d4da8c61':
    'Aus: kein Zugriff. Fragen Sie: Genehmigen Sie jeden Vorgang in einem interaktiven Chat. Ein: Nutzung ohne zu fragen. Auf jedem Server werden neue Verbindungen gestartet. Diese Auswahlmöglichkeiten aktivieren kein Aus-Werkzeug.',
  'settings.ai.AgentEditorModal.github_com.3aeb0024': 'github.com',
  'settings.ai.AgentEditorModal.unavailable_connection_value.795252e1':
    'Nicht verfügbare Verbindung: {value0}',
  'settings.ai.AgentEditorModal.this_agent_refers_to_a.48e627ef':
    'Dieser Agent bezieht sich auf eine Verbindung, die auf diesem Gerät nicht vorhanden ist. Übertragen Sie die Verbindung oder lassen Sie sie ausgeschaltet.',
  'settings.ai.AgentEditorModal.scope.b073f6c6': 'Bereich',
  'settings.ai.AgentEditorModal.where_this_agent_works_by.08d21d74':
    'Wo dieser Agent standardmäßig funktioniert. Ein delegierter Lauf erhält auch alles, was im Chat steht\n              dass die an ihn delegierten Personen offen waren.',
  'settings.ai.AgentEditorModal.tools.ea93d6a2': 'Werkzeuge',
  'settings.ai.AgentEditorModal.off_unavailable_ask_needs_approval.845b7983':
    'Aus = nicht verfügbar. Fragen = erfordert Genehmigung. Auto = läuft selbstständig. Datei-Tools sind\n              immer verfügbar und unterliegt dem oben genannten Berechtigungsmodus.',
  'settings.ai.AgentEditorModal.offer_tools.677c3882': 'Bieten Sie Werkzeuge an',
  'settings.ai.AgentEditorModal.by_section_the_agent_sees.636028d7':
    'Nach Abschnitt: Der Agent sieht einen Eintrag pro Abschnitt mit seinem Zweck und öffnet einen Abschnitt, wenn er ihn benötigt. Alles auf einmal: Alle aktivierten Tools werden von Anfang an angeboten.',
  'settings.ai.AgentEditorModal.skills.66d0f523': 'Fähigkeiten',
  'settings.ai.AgentEditorModal.which_skills_this_agent_can.a35316d3':
    'Welche Fähigkeiten dieser Agent bei Bedarf laden kann.',

  'settings.ai.AgentEditorModal.delegation_depth.29ea0156': 'Delegationstiefe',
  'settings.ai.AgentEditorModal.how_far_this_agent_may.3ae4d41e':
    'Wie weit dieser Agent delegieren darf. 0 entfernt das Delegate-Tool vollständig.',
  'settings.ai.AgentEditorModal.basic.0e35f6e9': 'Basic',
  'settings.ai.AgentEditorModal.prompts.5f2e66e6': 'Aufforderungen',
  'settings.ai.AgentEditorModal.memory.c3963aed': 'Erinnerung',
  'settings.ai.AgentEditorModal.access.ec5ba0ab': 'Zugang',
  'settings.ai.AgentEditorModal.delegation.a6d910ba': 'Delegation',
  'settings.ai.AgentEditorModal.text.71988c4d': 'Text',
  'settings.ai.AgentEditorModal.note.d8da2c49': 'Notiz',
  'settings.ai.AgentEditorModal.all_skills.78abcbbf': 'Alle Fähigkeiten',
  'settings.ai.AgentEditorModal.no_skills.5083cd4b': 'Keine Fähigkeiten',
  'settings.ai.AgentEditorModal.only_selected.c1792bfe': 'Nur ausgewählt',
  'settings.ai.AgentEditorModal.cannot_delegate.6a16ca61': 'Kann nicht delegieren',
  'settings.ai.AgentEditorModal.level.3292ae98': '1 Ebene',
  'settings.ai.AgentEditorModal.levels.8b7cdd29': '2 Ebenen',
  'settings.ai.AgentEditorModal.levels.93b1554a': '3 Ebenen',
  'settings.ai.AgentEditorModal.off.ca7981b4': 'Aus',
  'settings.ai.AgentEditorModal.ask.b8c209cd': 'Nachfragen',
  'settings.ai.AgentEditorModal.on.13001175': 'An',
  'settings.ai.AgentMemoryEditor.what_this_agent_was_asked.66974c2c':
    'Woran sich dieser Agent erinnern sollte. Nur dieser Agent sieht es: Es wird zu seinem hinzugefügt\n      Systemaufforderung, festgelegt durch die Speichervorlage in den allgemeinen AI-Einstellungen. Der Agent fügt hinzu\n      und ändert Elemente mit dem Merken-Tool und entfernt sie mit Vergessen; beide können umgeschaltet werden\n      auf der Registerkarte „Zugriff“ deaktiviert.',
  'settings.ai.AgentMemoryEditor.added_value.29f396e2': '{value0} hinzugefügt',
  'settings.ai.AgentMemoryEditor.forget_this_item.5fddee9d': 'Vergessen Sie diesen Artikel',
  'settings.ai.AgentMemoryEditor.nothing_remembered_yet_ask_the.bc8e1ea6':
    'Noch nichts erinnert. Bitten Sie den Agenten in einem Chat, sich etwas zu merken, oder fügen Sie es hier hinzu.',
  'settings.ai.AgentMemoryEditor.something_this_agent_should_remember.d49c6b77':
    'Etwas, an das sich dieser Agent erinnern sollte ...',
  'settings.ai.AgentMemoryEditor.add.9fd728c6': 'Hinzufügen',
  'settings.ai.AgentMemoryEditor.add_this_line_to_the.7ca78ec8':
    'Fügen Sie diese Zeile zum Speicher des Agenten hinzu',
  'settings.ai.AgentsSettings.an_agent_is_a_model.148349b4':
    'Ein Agent ist ein Modell, eine Reihe von Anweisungen und das, was er tun darf. Chats laufen weiter\n      eins; Skripte und andere Agenten können an einen delegieren.',
  'settings.ai.AgentsSettings.default.37a8eec1': 'Standard',
  'settings.ai.AgentsSettings.utility.57ffcc28': 'Dienstprogramm',
  'settings.ai.AgentsSettings.duplicate_this_agent.1e1d9501': 'Duplizieren Sie diesen Agenten',
  'settings.ai.AgentsSettings.the_last_agent_cannot_be.c57e2a82':
    'Der letzte Agent kann nicht gelöscht werden – ein Chat muss über etwas laufen',
  'settings.ai.AgentsSettings.delete_this_agent.0ba11bd2': 'Löschen Sie diesen Agenten',
  'settings.ai.AgentsSettings.add_agent.d3e039d4': 'Agent hinzufügen',
  'settings.ai.AgentsSettings.create_an_agent_and_open.fd458de1':
    'Erstellen Sie einen Agenten und öffnen Sie ihn zur Bearbeitung',
  'settings.ai.AgentsSettings.delete_agent.602cc4da': 'Agent löschen',
  'settings.ai.AgentsSettings.delete_value_chats_still_running.80b7b7d4':
    '{value0} löschen? Chats, die noch darauf laufen, werden auf die zurückgreifen\n        Standardagent. Dies kann nicht rückgängig gemacht werden.',
  'settings.ai.AgentsSettings.a_utility_agent_cannot_be.3315c30d':
    'Ein Utility-Agent kann nicht die Standardeinstellung sein – er ist in Chats ausgeblendet',
  'settings.ai.AgentsSettings.already_the_default_agent.28842ed7': 'Bereits der Standardagent',
  'settings.ai.AgentsSettings.make_this_the_default_agent.4e646862':
    'Machen Sie dies zum Standardagenten für neue Chats',
  'settings.ai.AgentsSettings.no_model.f62c7d17': 'kein Modell',
  'settings.ai.AgentsSettings.whole_vault.18d9a3b5': 'ganzes Gewölbe',
  'settings.ai.AgentsSettings.no_scope.cc0ca29a': 'kein Spielraum',

  'settings.ai.GeneralSettings.ai_agent.b48c8be3': 'KI-Agent',
  'settings.ai.GeneralSettings.enable_ai_agent_features_including.f1bb9425':
    'Aktivieren Sie KI-Agent-Funktionen, einschließlich der Chat-Seitenleiste.',
  'settings.ai.GeneralSettings.the_ai_agent_is_off.e967af23':
    'Der KI-Agent ist ausgeschaltet. Aktivieren Sie es unter „Allgemein“.',
  'settings.ai.GeneralSettings.keep_running_in_background_while.32440789':
    'Laufen Sie weiterhin im Hintergrund, während die Agenten arbeiten',
  'settings.ai.GeneralSettings.play_silent_audio_while_a.325ce1f2':
    'Spielen Sie stummen Ton ab, während eine Runde läuft. Möglicherweise wird mehr Batterie verbraucht; Die Hintergrundausführung hängt vom System ab.',
  'settings.ai.GeneralSettings.keep_running_in_background_always.ea405fee':
    'Laufen Sie immer im Hintergrund weiter',
  'settings.ai.GeneralSettings.play_silent_audio_even_when.1582869f':
    'Spielen Sie stummen Ton ab, auch wenn Agenten inaktiv sind. Standardmäßig deaktiviert; verbraucht möglicherweise mehr Batterie.',
  'settings.ai.GeneralSettings.key_destinations.fe672569': 'Wichtige Reiseziele',
  'settings.ai.GeneralSettings.review_addresses_changed_outside_this.3108ccee':
    'Überprüfen Sie Adressen, die außerhalb dieses Geräts geändert wurden, bevor Sie Schlüssel dorthin senden.',
  'settings.ai.GeneralSettings.review.aff0766a': 'Rezension',
  'settings.ai.GeneralSettings.review_and_confirm_where_this.d9c7c591':
    'Überprüfen und bestätigen Sie, wohin dieses Gerät Schlüssel sendet',
  'settings.ai.GeneralSettings.chat_storage.b1ad73cf': 'Chat-Speicher',
  'settings.ai.GeneralSettings.chat_path_template.306fa23b': 'Chat-Pfad-Vorlage',
  'settings.ai.GeneralSettings.path_template_for_chat_files.68eb138e':
    'Pfadvorlage für Chatdateien. Variablen: {value0}, {value1}.',
  'settings.ai.GeneralSettings.ai_chats.f579b34b': 'KI/Chats',
  'settings.ai.GeneralSettings.rewind_space_mb.a3eaae55': 'Rückspulspeicher (MB)',
  'settings.ai.GeneralSettings.how_much_room_on_this.f5c80989':
    'Wie viel Platz, auf diesem Gerät, können die Kopien beanspruchen, die einen Chat zurücklegen lassen\n            Dateien, die sein Agent geändert hat. Chats, die erst kürzlich geschrieben wurden, verlieren zuerst ihren Status. 0 hält\n            nichts und Chats können nicht zurückgespult werden.',
  'settings.ai.GeneralSettings.migrate_chats.cd7a094d': 'Chats migrieren',
  'settings.ai.GeneralSettings.move_existing_chat_files_to.6ae0ce3b':
    'Verschieben Sie vorhandene Chat-Dateien so, dass sie mit der aktuellen Pfadvorlage übereinstimmen.',
  'settings.ai.GeneralSettings.migrating.e3c84baf': 'Migration...',
  'settings.ai.GeneralSettings.migrate.f988ed29': 'Wandern',
  'settings.ai.GeneralSettings.move_existing_chat_files_to.2048cf22':
    'Verschieben Sie vorhandene Chatdateien so, dass sie mit der obigen Vorlage übereinstimmen',
  'settings.ai.GeneralSettings.comment_agent.42067bbf': 'Kommentar-Agent',
  'settings.ai.GeneralSettings.which_agent_answers_comment_chats.d8ddd0b0':
    'Welcher Agent beantwortet Kommentar-Chats? Es werden auch Versorgungsagenten angeboten – der eine\n            Für Kommentare gesät ist eine davon.',
  'settings.ai.GeneralSettings.comment_folder.0f39b86a': 'Kommentarordner',
  'settings.ai.GeneralSettings.where_comment_chats_are_stored.dcd58501':
    'Wo Kommentar-Chats gespeichert werden',
  'settings.ai.GeneralSettings.ai_comments.e01654c6': 'KI/Kommentare',
  'settings.ai.GeneralSettings.skills.66d0f523': 'Fähigkeiten',
  'settings.ai.GeneralSettings.skills_folder.bc563bf9': 'Skills-Ordner',
  'settings.ai.GeneralSettings.skills_here_are_offered_to.32a3926b':
    'Fähigkeiten werden hier jedem Agenten angeboten. An anderer Stelle werden nur Fähigkeiten im Rahmen des Chats angeboten; Beim Laden eines anderen Skills werden Sie zuerst gefragt. Die Fähigkeitsauswahl des Agenten gilt weiterhin.',
  'settings.ai.GeneralSettings.ai_skills.cebb9b9a': 'KI/Fähigkeiten',
  'settings.ai.GeneralSettings.integrations.090512d9': 'Integrationen',
  'settings.ai.GeneralSettings.brave_search_api_key.309e5bff': 'API-Schlüssel für die Brave-Suche',
  'settings.ai.GeneralSettings.stored_securely_in_keychain.0d11e7d5':
    'Sicher im Schlüsselbund aufbewahrt.',
  'settings.ai.GeneralSettings.secrets.d8707d41': 'Geheimnisse',

  'settings.ai.GeneralSettings.unnamed.9edb143e': '(unbenannt)',
  'settings.ai.GeneralSettings.secret_name.5cdf573b': 'Geheimer Name',
  'settings.ai.GeneralSettings.value.fb2e2c72': 'Wert...',
  'settings.ai.GeneralSettings.allowed_addresses.0479f7eb': 'Zulässige Adressen',
  'settings.ai.GeneralSettings.add_an_address_from_a.f1ab507c':
    'Fügen Sie eine Adresse aus der Bestätigung einer Anfrage hinzu. Bei jeder gespeicherten Schlüsselanforderung wird weiterhin gefragt.',
  'settings.ai.GeneralSettings.remove.c3812fc4': 'Entfernen',
  'settings.ai.GeneralSettings.remove_this_address_from_the.e14aba72':
    'Entfernen Sie diese Adresse aus der Zulassungsliste des Schlüssels',
  'settings.ai.GeneralSettings.none_yet.adb85cf2': 'Noch keine',
  'settings.ai.GeneralSettings.remove_this_secret.42b31675': 'Entfernen Sie dieses Geheimnis',
  'settings.ai.GeneralSettings.cancel_leave_the_stored_value.ab838eaa':
    'Abbrechen – den gespeicherten Wert unverändert lassen',
  'settings.ai.GeneralSettings.add_secret.f57a23c6': 'Geheimnis hinzufügen',
  'settings.ai.GeneralSettings.add_another_named_secret.16c8806f':
    'Fügen Sie ein weiteres benanntes Geheimnis hinzu',
  'settings.ai.GeneralSettings.providers.996c32b3': 'Anbieter',
  'settings.ai.GeneralSettings.base_url.70589413': 'Basis-URL',
  'settings.ai.GeneralSettings.openai_compatible_api_endpoint.7e47af2e':
    'OpenAI-kompatibler API-Endpunkt.',
  'settings.ai.GeneralSettings.fetch_models_from_api.f5eaa7ef': 'Modelle von der API abrufen',
  'settings.ai.GeneralSettings.add_model_manually.c42ee506': 'Modell manuell hinzufügen',

  'settings.ai.GeneralSettings.filter_models.e91fd9af': 'Modelle filtern...',
  'settings.ai.GeneralSettings.reasoning.0c4d01e8': 'Argumentation',
  'settings.ai.GeneralSettings.no_models_yet.36604ff4': 'Noch keine Modelle.',
  'settings.ai.GeneralSettings.add_another_provider.91f9cd40':
    'Fügen Sie einen weiteren Anbieter hinzu',
  'settings.ai.GeneralSettings.no_providers_yet.55327313': 'Noch keine Anbieter',
  'settings.ai.GeneralSettings.any_service_that_speaks_the.e99bc8c8':
    'Jeder Dienst, der die OpenAI-API spricht: seine Adresse, einen Schlüssel und seine Modelle.',
  'settings.ai.GeneralSettings.add_provider.8cd1856b': 'Anbieter hinzufügen',
  'settings.ai.GeneralSettings.add_another_openai_compatible_provider.14842bd7':
    'Fügen Sie einen weiteren OpenAI-kompatiblen Anbieter hinzu',
  'settings.ai.GeneralSettings.background_model.eefa747e': 'Hintergrundmodell',
  'settings.ai.GeneralSettings.chat_models_are_chosen_per.1867a8fa':
    'Chat-Modelle werden pro Agent auf der Registerkarte „Agenten“ ausgewählt. Dieser wird für die verwendet\n          Eigene Hintergrundarbeit des Plugins – Benennen von Chats und Komprimieren langer Konversationen.',
  'settings.ai.GeneralSettings.auxiliary_model.6c245762': 'Hilfsmodell',
  'settings.ai.GeneralSettings.used_for_chat_titles_and.d3db0143':
    'Wird für Chattitel und Komprimierung verwendet. Wenn diese Option nicht aktiviert ist, verwendet jeder Chat das Modell, um das er sich handelt\n            rede schon mit; Ein Agent kann einen seiner eigenen nennen, der ihn überzeugt.',
  'settings.ai.GeneralSettings.sequential_auxiliary.f9fb6da7': 'Sequentielles Hilfsmittel',
  'settings.ai.GeneralSettings.run_auxiliary_tasks_after_the.d26cd159':
    'Führen Sie Hilfsaufgaben aus, nachdem das Hauptmodell abgeschlossen ist. Aktivieren Sie diese Option für lokale Modelle mit begrenztem Durchsatz.',
  'settings.ai.GeneralSettings.when_a_request_fails.8adc1690': 'Wenn eine Anfrage fehlschlägt',
  'settings.ai.GeneralSettings.only_failures_that_pass_on.40e2ce33':
    'Nur Fehler, die von selbst verschwinden, werden wiederholt – eine Ratenbegrenzung, ein überlasteter Anbieter, ein Verbindungsabbruch. Ein abgelehnter Schlüssel oder eine fehlerhafte Anfrage wird nicht erneut versucht.',
  'settings.ai.GeneralSettings.try_again_automatically.84c6a3e7':
    'Versuchen Sie es automatisch noch einmal',
  'settings.ai.GeneralSettings.how_many_further_tries_after.21ca31fd':
    'Wie viele weitere Versuche nach dem ersten.',
  'settings.ai.GeneralSettings.first_wait.548b0480': 'Warte erst einmal',
  'settings.ai.GeneralSettings.seconds_before_the_first_retry.60ee00fb':
    'Sekunden vor dem ersten Wiederholungsversuch. Jeder verdoppelt es, bis zu einer Minute.',
  'settings.ai.GeneralSettings.request_timeout_seconds.1b1b1d08':
    'Anforderungszeitlimit (Sekunden)',
  'settings.ai.GeneralSettings.wait_for_the_model_to.230c11b5':
    'Warten Sie, bis das Modell eine Verbindung herstellt oder den nächsten Antwortblock sendet, nicht auf die gesamte Antwort. 1–3600 Sekunden; empty stellt 60 wieder her. Wird für Chat- und Hintergrundmodelle ohne eigenes Timeout verwendet.',
  'settings.ai.GeneralSettings.voice_input.8748f239': 'Spracheingabe',
  'settings.ai.GeneralSettings.dictate_into_the_chat_or.6ffa829a':
    'Diktieren Sie in den Chat oder in eine Notiz mit dem Befehl „In die Notiz diktieren“. OpenRouter verfügt über keinen Transkriptionsendpunkt, daher geht der Ton an ein Modell, das hört – diese beiden wurden aufgrund des Preises ausgewählt, weil sie in Europa laufen und weil nicht trainiert wird, was gesendet wird.',
  'settings.ai.GeneralSettings.model.5e2c614c': 'Modell',
  'settings.ai.GeneralSettings.what_turns_speech_into_text.7083143f':
    'Was Sprache in Text verwandelt.',
  'settings.ai.GeneralSettings.model_id.7789530b': 'Modell-ID',
  'settings.ai.GeneralSettings.any_model_that_accepts_audio.ee899177':
    'Jedes Modell, das Audio akzeptiert, wie sein Anbieter es nennt.',
  'settings.ai.GeneralSettings.vendor_model.ba723767': 'Anbieter/Modell',
  'settings.ai.GeneralSettings.endpoint.3df9726c': 'Endpunkt',
  'settings.ai.GeneralSettings.left_empty_openrouter_s_chat.cfc34cb7':
    'Leer gelassen: Chat-Abschlüsse von OpenRouter.',
  'settings.ai.GeneralSettings.language.a4fe6526': 'Sprache',
  'settings.ai.GeneralSettings.told_to_the_model_as.35170cef':
    'Wird dem Model als Hinweis mitgeteilt. Bleibt das Feld leer, wird es anhand des Audios ermittelt.',
  'settings.ai.GeneralSettings.russian.5bcc40ad': 'Russisch',
  'settings.ai.GeneralSettings.client_name.b6626cd7': 'Kundenname',
  'settings.ai.GeneralSettings.default.21b111cb': 'Standard',
  'settings.ai.GeneralSettings.openrouter_api_key.89616b71': 'OpenRouter-API-Schlüssel',
  'settings.ai.GeneralSettings.stored_in_the_keychain_shared.26300c21':
    'Im Schlüsselbund gespeichert und mit der Bildgenerierung geteilt.',
  'settings.ai.GeneralSettings.image_generation.8f4716e6': 'Bilderzeugung',
  'settings.ai.GeneralSettings.short_identifier_used_in_model.1846b226':
    'Kurzbezeichner, der in Modellschlüsseln verwendet wird (z. B. openai, openrouter).',
  'settings.ai.GeneralSettings.e_g_openai.e3ce2f3c': 'z.B. {literal0}',
  'settings.ai.GeneralSettings.api_type.72e7cc4c': 'API-Typ',
  'settings.ai.GeneralSettings.openai_uses_v_images_generations.12e3117d':
    'OpenAI verwendet /v1/images/generations, OpenRouter verwendet Chat-Abschlüsse.',
  'settings.ai.GeneralSettings.leave_empty_for_default.ac9c8df3':
    'Für die Standardeinstellung leer lassen: ',
  'settings.ai.GeneralSettings.add_model.b2609f7d': 'Modell hinzufügen',
  'settings.ai.GeneralSettings.add_another_image_provider.fac89d72':
    'Fügen Sie einen weiteren Bildanbieter hinzu',
  'settings.ai.GeneralSettings.no_image_providers_yet.03ad87ca': 'Noch keine Bildanbieter',
  'settings.ai.GeneralSettings.a_service_that_makes_pictures.a39241cb':
    'Ein Dienst, der aus Wörtern Bilder erstellt, mit denen der Agent zeichnen kann.',
  'settings.ai.GeneralSettings.add_image_provider.858726bf': 'Bildanbieter hinzufügen',
  'settings.ai.GeneralSettings.add_another_image_generation_provider.8a3f2ea9':
    'Fügen Sie einen weiteren Bildgenerierungsanbieter hinzu',
  'settings.ai.GeneralSettings.default_image_model.164d9980': 'Standardbildmodell',
  'settings.ai.GeneralSettings.used_when_agent_doesn_t.a37bbc88':
    'Wird verwendet, wenn der Agent kein Modell angibt.',
  'settings.ai.GeneralSettings.prompts.5f2e66e6': 'Aufforderungen',
  'settings.ai.GeneralSettings.what_the_plugin_says_to.b62716b4':
    'Was das Plugin den Modellen für seine eigene Arbeit sagt. Jedes beginnt als eigenes Plug-in. Ändern Sie nur eines, um zu ändern, wie die Arbeit zustande kommt.',
  'settings.ai.GeneralSettings.tool_descriptions.eb258712': 'Werkzeugbeschreibungen',
  'settings.ai.GeneralSettings.what_each_tool_tells_the.577cc136':
    'Was jedes Tool dem Modell über sich selbst sagt, wird von jedem Agenten geteilt. Welche Tools ein Agent verwenden darf, wird pro Agent festgelegt.',
  'settings.ai.GeneralSettings.value_changed_from_the_plugin.6bb25106':
    '{value0} hat sich gegenüber dem Plugin-eigenen geändert',
  'settings.ai.GeneralSettings.change_what_the_tools_tell.4a192e39':
    'Ändern Sie, was die Tools dem Modell mitteilen',
  'settings.ai.GeneralSettings.changed_from_the_plugin_s.5eaba5ab':
    'Aus den eigenen Worten des Plugins geändert',
  'settings.ai.GeneralSettings.change_the_value_prompt.e3b3d921':
    'Ändern Sie die Eingabeaufforderung {value0}',
  'settings.ai.GeneralSettings.use_the_default.76f7faf5': 'Verwenden Sie die Standardeinstellung',
  'settings.ai.GeneralSettings.go_back_to_the_plugin.03eb09fb':
    'Gehen Sie zurück zu den eigenen Worten des Plugins',
  'settings.ai.GeneralSettings.cancel.19766ed6': 'Abbrechen',
  'settings.ai.GeneralSettings.close_this_and_change_nothing.80f7e492': 'Ohne Änderungen schließen',
  'settings.ai.GeneralSettings.save.1509f561': 'Speichern',
  'settings.ai.GeneralSettings.use_these_words_from_now.0d2b4a3d':
    'Benutzen Sie von nun an diese Wörter',
  'settings.ai.GeneralSettings.done.11a6767d': 'Fertig',
  'settings.ai.GeneralSettings.close_this_window.3f02fc8e': 'Schließen Sie dieses Fenster',
  'settings.ai.GeneralSettings.migrated_value_chat_s.9cf610c9': '{value0} Chat(s) migriert',
  'settings.ai.GeneralSettings.migration_failed_value.109b5f7f':
    'Migration fehlgeschlagen: {value0}',
  'settings.ai.GeneralSettings.default_agent.94da52ec': 'Standardagent',
  'settings.ai.GeneralSettings.enter_seconds_this_value_has.ec39a7c9':
    'Geben Sie 1–3600 Sekunden ein. Dieser Wert wurde nicht gespeichert.',
  'settings.ai.GeneralSettings.something_else.b4768d66': 'Etwas anderes…',
  'settings.ai.GeneralSettings.remove_secret.1422ca6e': 'Geheimnis entfernen',

  'settings.ai.GeneralSettings.saved_value_to_the_keychain.9ec0f101':
    '{value0} im Schlüsselbund gespeichert',
  'settings.ai.GeneralSettings.agent_memory.f3cd4df6': 'Agentenspeicher',
  'settings.ai.GeneralSettings.how_what_an_agent_was.45d8f0ab':
    'Wie das, was ein Agent sich merken sollte, zu seiner Systemaufforderung hinzugefügt wird; {value0} ist der Ort, an dem die Elemente abgelegt werden.',
  'settings.ai.GeneralSettings.chat_titles.950a9874': 'Chattitel',
  'settings.ai.GeneralSettings.names_a_chat_from_its.b2ea780a':
    'Benennt einen Chat nach seinen ersten Nachrichten; {value0} ist der Ort, an den sie gehen.',
  'settings.ai.GeneralSettings.chat_titles_system.2f3fd2f9': 'Chattitel, System',
  'settings.ai.GeneralSettings.what_the_model_that_names.4a08978e':
    'Was dem Modell, das Chats benennt, gesagt wird, ist es.',
  'settings.ai.GeneralSettings.chat_recap.adaaf80a': 'Chat-Zusammenfassung',
  'settings.ai.GeneralSettings.the_sentence_on_a_chat.af42907c':
    'Der Satz auf der Karte eines Chats unter einer Notiz, die er geändert hat; {value0} ist der Ort, an den die Nachrichten gehen.',
  'settings.ai.GeneralSettings.chat_summary.b82dab10': 'Chat-Zusammenfassung',
  'settings.ai.GeneralSettings.the_short_line_under_a.c81696a8':
    'Die kurze Zeile unter dem Titel eines Chats im Verlauf; {value0} ist der Ort, an den die Nachrichten gehen.',
  'settings.ai.GeneralSettings.compacting.df77799c': 'Verdichten',
  'settings.ai.GeneralSettings.how_a_long_conversation_is.fb14c886':
    'Wie ein langes Gespräch zusammengefasst wird, damit es weitergehen kann; {value0} ist, wohin es geht.',
  'settings.ai.InterceptorList.interceptors.803987ac': 'Abfangjäger',
  'settings.ai.InterceptorList.off.ca7981b4': 'Aus',
  'settings.ai.InterceptorList.close_its_settings.de0fd0fb': 'Schließen Sie die Einstellungen',
  'settings.ai.InterceptorList.edit_what_it_reads_and.86412c66':
    'Bearbeiten Sie, was es liest und wie',
  'settings.ai.InterceptorList.on_runs_in_its_turn.baf521d9': 'Ein: läuft abwechselnd',
  'settings.ai.InterceptorList.off_skipped_keeps_its_place.28162216':
    'Aus: übersprungen, behält seinen Platz',
  'settings.ai.InterceptorList.move_or_remove.ca447e47': 'Verschieben oder entfernen',
  'settings.ai.InterceptorList.who_reads_an_agent_says.0ff03e5e':
    'Wer liest: Ein Agent sagt, was er denkt, ein Drehbuch entscheidet.',
  'settings.ai.InterceptorList.add_interceptor.36b0eb2d': 'Abfangjäger hinzufügen',
  'settings.ai.InterceptorList.add_one_at_the_end.98a5c813':
    'Fügen Sie am Ende eins hinzu; es läuft zuletzt',
  'settings.ai.InterceptorList.an_agent_or_a_script.92a06c1a':
    'Ein Agent oder ein Skript, das zuerst liest',
  'settings.ai.InterceptorList.everything.75304cf7': 'Alles',
  'settings.ai.InterceptorList.they_run_in_this_order.7b624feb':
    'Sie laufen in dieser Reihenfolge ab, wobei jedem gegeben wird, was der vorherige zurückgegeben hat. Der Agent liest den Text des letzten.',
  'settings.ai.InterceptorList.script_value_missing.31a4f5d0': 'Skript: {value0} · fehlt',
  'settings.ai.InterceptorList.missing_agent.4eeff6c3': 'Fehlender Agent',
  'settings.ai.InterceptorList.nobody.3fad99b5': 'Niemand',
  'settings.ai.InterceptorList.move_up.c66feb5e': 'Bewegen Sie sich nach oben',
  'settings.ai.InterceptorList.move_down.40bb50da': 'Bewegen Sie sich nach unten',
  'settings.ai.InterceptorList.remove.c3812fc4': 'Entfernen',
  'settings.ai.InterceptorSettings.interceptor.e7123168': 'Abfangjäger',
  'settings.ai.InterceptorSettings.checks.de07d072': 'Schecks',
  'settings.ai.InterceptorSettings.only_messages_matching.a6b95968':
    'Nur übereinstimmende Nachrichten',
  'settings.ai.InterceptorSettings.a_regular_expression_bare_or.23b7cedb':
    'Ein regulärer Ausdruck, nackt oder als /pattern/flags, ausprobiert für alles, was überprüft wird. Der Rest passiert ungeprüft. Leer bedeutet alles.',

  'settings.ai.InterceptorSettings.reply_only.df23f4c5': 'Nur antworten',
  'settings.ai.InterceptorSettings.send_your_messages_unchanged_straight.58a7f839':
    'Senden Sie Ihre Nachrichten unverändert direkt an den Hauptagenten. Der Abfangjäger kann neben jeder Nachricht antworten, ohne sie festzuhalten, umzuschreiben oder über Werkzeuggenehmigungen zu entscheiden.',
  'settings.ai.InterceptorSettings.interceptor_context.4b7f6f53': 'Interceptor-Kontext',
  'settings.ai.InterceptorSettings.how_much_of_the_conversation.5cbc2856':
    'Wie viel von der Konversation der Abfangjäger sieht.',
  'settings.ai.InterceptorSettings.everything.75304cf7': 'Alles',
  'settings.ai.InterceptorSettings.your_messages_before_the_agent.4c538aec':
    'Ihre Nachrichten, bevor der Agent sie liest.',
  'settings.ai.InterceptorSettings.the_agent_s_answers_once.69a4059d':
    'Die Antworten des Agenten, sobald der Vorgang abgeschlossen ist. An die Stelle der Antwort tritt ein neuer Text des Abfangjägers; Das Original bleibt nur einen Tastendruck entfernt.',
  'settings.ai.InterceptorSettings.your_messages_before_the_agent.1b910706':
    'Ihre Nachrichten, bevor der Agent sie liest, und seine Antworten, sobald er fertig ist. An die Stelle der Antwort tritt ein neuer Text des Abfangjägers.',
  'settings.ai.McpServerModal.add_mcp_server.0e3e58f9': 'MCP-Server hinzufügen',
  'settings.ai.McpServerModal.edit_mcp_server.35d90caa': 'Bearbeiten Sie den MCP-Server',
  'settings.ai.McpServerModal.name.dcd1d522': 'Name',
  'settings.ai.McpServerModal.e_g_context.e900fc3c': 'z.B. {literal0}',
  'settings.ai.McpServerModal.another_server_already_has_this.8e96ea34':
    'Ein anderer Server hat bereits diesen Namen. Davon leiten sich die Werkzeugnamen ab, daher müssen sie unterschiedlich sein.',
  'settings.ai.McpServerModal.the_server_s_mcp_endpoint.d96fdd59':
    'Der MCP-Endpunkt des Servers, der über HTTP erreicht wird.',
  'settings.ai.McpServerModal.on.13001175': 'An',
  'settings.ai.McpServerModal.off_keeps_it_here_and.3cab2a37':
    'Off behält es hier und gibt seine Werkzeuge keinem Agenten weiter.',
  'settings.ai.McpServerModal.token.d2089be6': 'Token',
  'settings.ai.McpServerModal.sent_as_authorization_bearer_stored.954f00f3':
    'Wird als Authorization: Bearer gesendet. Im Schlüsselbund gespeichert, niemals in der Einstellungsdatei.',
  'settings.ai.McpServerModal.optional.59be7133': 'Optional',
  'settings.ai.McpServerModal.forget_the_stored_token_when.4af3d436':
    'Vergessen Sie beim Speichern den gespeicherten Token',
  'settings.ai.McpServerModal.headers.194e9fe6': 'Überschriften',
  'settings.ai.McpServerModal.tools.ea93d6a2': 'Werkzeuge',
  'settings.ai.McpServerModal.what_agents_are_told_is.7591a661':
    'Den Agenten wird diese Liste so mitgeteilt, wie sie abgerufen wurde. Es ändert sich nur, wenn Sie es abrufen\n          hier noch einmal klicken und speichern.',
  'settings.ai.McpServerModal.fetch_tools.4788d40d': 'Werkzeuge holen',
  'settings.ai.McpServerModal.connect_to_the_server_and.db04f00f':
    'Stellen Sie eine Verbindung zum Server her und lesen Sie die angebotenen Tools',
  'settings.ai.McpServerModal.needs_the_server_url_first.9616ba6f':
    'Benötigt zuerst die Server-URL',
  'settings.ai.McpServerModal.save.1509f561': 'Speichern',
  'settings.ai.McpServerModal.keep_this_server_and_close.f4798cef':
    'Behalten Sie diesen Server und schließen Sie ihn',
  'settings.ai.McpServerModal.needs_a_name_of_its.7be3e1cc':
    'Benötigt einen eigenen Namen und eine URL',
  'settings.ai.McpServerModal.delete.e2d0a549': 'Löschen',
  'settings.ai.McpServerModal.remove_this_server_agents_lose.6709241c':
    'Entfernen Sie diesen Server. Agenten verlieren ihre Werkzeuge',
  'settings.ai.McpServerModal.delete_mcp_server.1a969bef': 'MCP-Server löschen',
  'settings.ai.McpServerModal.delete_value_every_agent_loses.cf787f8d':
    '{value0} löschen? Jeder Agent verliert seine Werkzeuge.',

  'settings.ai.McpServerModal.also_the_start_of_its.6f23c597':
    'Auch der Anfang der Namen seiner Tools: mcp_{value0}_<tool>.',
  'settings.ai.McpServerModal.fetching.8d0738c8': 'Abrufen…',
  'settings.ai.McpServerModal.not_fetched_yet.d17fdec2': 'Noch nicht abgerufen',
  'settings.ai.McpSettings.servers_that_give_agents_more.67631550':
    'Server, die Agenten mehr Tools zur Verfügung stellen, sind über HTTP erreichbar – auch auf einem Telefon. Nichts ist\n      auf diesem Gerät gestartet. Die Tools eines Servers erreichen einen Agenten erst, wenn sie eingeschaltet sind\n      Sie werden auf der Registerkarte „Zugriff“ dieses Agenten angezeigt und fragen vor jedem Anruf nach, sofern nicht anders festgelegt.',
  'settings.ai.McpSettings.delete_this_server.e42cb344': 'Löschen Sie diesen Server',
  'settings.ai.McpSettings.no_mcp_servers_yet.cf5e91ef': 'Noch keine MCP-Server.',
  'settings.ai.McpSettings.add_server.1099b2a9': 'Server hinzufügen',
  'settings.ai.McpSettings.connect_an_mcp_server_by.60c5ad42':
    'Verbinden Sie einen MCP-Server über seine Adresse',
  'settings.ai.McpSettings.delete_mcp_server.1a969bef': 'MCP-Server löschen',
  'settings.ai.McpSettings.delete_value_every_agent_loses.cf787f8d':
    '{value0} löschen? Jeder Agent verliert seine Werkzeuge.',
  'settings.ai.McpSettings.off.ca7981b4': 'Aus',
  'settings.ai.McpSettings.on.13001175': 'An',
  'settings.ai.McpSettings.on_tools_not_fetched_yet.28d5069f':
    'Ein, Werkzeuge wurden noch nicht abgerufen',
  'settings.ai.ProviderSettings.unnamed_provider.1b003656': 'Unbenannter Anbieter',
  'settings.ai.ProviderSettings.change_this_provider_and_its.6b743289':
    'Wechseln Sie diesen Anbieter und seine Modelle',
  'settings.ai.ProviderSettings.new_provider.38a96a6a': 'Neuer Anbieter',
  'settings.ai.ProviderSettings.name.dcd1d522': 'Name',
  'settings.ai.ProviderSettings.client_name.b6626cd7': 'Kundenname',
  'settings.ai.ProviderSettings.default.21b111cb': 'Standard',
  'settings.ai.ProviderSettings.api_key.16f0ee47': 'API-Schlüssel',
  'settings.ai.ProviderSettings.kept_in_the_keychain_of.27a8c578':
    'Wird im Schlüsselbund dieses Geräts aufbewahrt.',
  'settings.ai.ProviderSettings.models.d17d2d78': 'Modelle',
  'settings.ai.ProviderSettings.delete.e2d0a549': 'Löschen',
  'settings.ai.ProviderSettings.remove_this_provider_and_its.e1aeea6b':
    'Entfernen Sie diesen Anbieter und seine Modelle',
  'settings.ai.ProviderSettings.done.11a6767d': 'Fertig',
  'settings.ai.ProviderSettings.close_this_window_changes_are.91342d87':
    'Schließen Sie dieses Fenster. Änderungen bleiben erhalten, sobald Sie sie vornehmen',
  'settings.ai.ToolDescriptions.value_of_value.ca6c5e5f': '{value0} oder {value1}',
  'settings.ai.ToolDescriptions.changed_from_the_plugin_s.5eaba5ab':
    'Aus den eigenen Worten des Plugins geändert',
  'settings.ai.ToolDescriptions.change_what_value_tells_the.fafe989d':
    'Ändern Sie, was {value0} dem Modell mitteilt',
  'settings.ai.ToolDescriptions.what_this_tool_tells_the.28c8e7d7':
    'Was dieses Tool dem Modell über sich selbst sagt.',
  'settings.ai.ToolDescriptions.what_value_tells_the_model.1e2b22a7':
    'Was {value0} dem Modell sagt',
  'settings.ai.ToolDescriptions.use_the_default.76f7faf5': 'Verwenden Sie die Standardeinstellung',
  'settings.ai.ToolDescriptions.go_back_to_the_plugin.03eb09fb':
    'Gehen Sie zurück zu den eigenen Worten des Plugins',
  'settings.ai.ToolDescriptions.cancel.19766ed6': 'Abbrechen',
  'settings.ai.ToolDescriptions.close_this_and_change_nothing.80f7e492':
    'Ohne Änderungen schließen',
  'settings.ai.ToolDescriptions.save.1509f561': 'Speichern',
  'settings.ai.ToolDescriptions.use_these_words_from_now.0d2b4a3d':
    'Benutzen Sie von nun an diese Wörter',
  'settings.ai.interceptorList.reply_only.37786db8': 'nur antworten',
  'settings.ai.options.ask_before_every_change.f5fb08f2': 'Fragen Sie vor jeder Änderung nach',
  'settings.ai.options.edit_files_without_asking.08674c9f': 'Bearbeiten Sie Dateien ohne zu fragen',
  'settings.ai.options.everything_without_asking.d14adf38': 'Alles ohne zu fragen',
  'settings.ai.options.value_utility.6fb6bae8': '{value0} · Dienstprogramm',
  'settings.ai.options.script_value_value.97c5d924': 'Skript: {value0}{value1}',
  'settings.scripts.AutomationsEditor.automations.ad1fb9ec': 'Automatisierungen',

  'settings.scripts.AutomationsEditor.no_automations_yet.4c27eb15': 'Noch keine Automatisierungen.',
  'settings.scripts.AutomationsEditor.off.ca7981b4': 'Aus',
  'settings.scripts.AutomationsEditor.delete_this_automation.76539f9f':
    'Löschen Sie diese Automatisierung',
  'settings.scripts.AutomationsEditor.run_this_automation.25a70adc':
    'Führen Sie diese Automatisierung aus',
  'settings.scripts.AutomationsEditor.off_keeps_it_set_up.c8be185f':
    'Bei „Aus“ bleibt es hier eingerichtet, ohne es auszuführen.',
  'settings.scripts.AutomationsEditor.name.dcd1d522': 'Name',
  'settings.scripts.AutomationsEditor.what_it_is_called_here.9bc212fc':
    'Wie es hier und in der Liste der Skriptausführungen heißt.',
  'settings.scripts.AutomationsEditor.e_g_log_completed_tasks.4209ebe8': 'z.B. {literal0}',
  'settings.scripts.AutomationsEditor.when.cf9c7aa2': 'Wann',
  'settings.scripts.AutomationsEditor.what_has_to_happen_for.b243f2cf':
    'Was muss passieren, damit das Skript ausgeführt werden kann?',
  'settings.scripts.AutomationsEditor.note_types.52d728fb': 'Notiztypen',
  'settings.scripts.AutomationsEditor.comma_separated_only_notes_whose.e9a69ad4':
    'Durch Kommas getrennt. Nur Notizen, deren Typ frontmatter einer dieser ist. Leer ist jede Notiz.',
  'settings.scripts.AutomationsEditor.e_g_movie_book.f621e5b4': 'z.B. {literal0}',
  'settings.scripts.AutomationsEditor.folders.c4d6bb20': 'Ordner',
  'settings.scripts.AutomationsEditor.comma_separated_only_notes_anywhere.bc2a8774':
    'Durch Kommas getrennt. Nur Notizen irgendwo unter einer davon. Leer ist überall.',
  'settings.scripts.AutomationsEditor.e_g_tasks_work.3001dc3d': 'z.B. {literal0}',
  'settings.scripts.AutomationsEditor.property.40040cb1': 'Eigenschaft',
  'settings.scripts.AutomationsEditor.only_notes_with_this_frontmatter.dd3e2c04':
    'Nur Notizen mit dieser Frontmatter-Eigenschaft. Optional.',
  'settings.scripts.AutomationsEditor.e_g_area.95b1c988': 'z.B. {literal0}',
  'settings.scripts.AutomationsEditor.equals.f939ae3d': 'Gleich',
  'settings.scripts.AutomationsEditor.holding_this_value_or_one.1f11ec5f':
    '…diesen Wert oder einen seiner Werte halten. Leer ist jeder Wert.',
  'settings.scripts.AutomationsEditor.e_g_home.a9f31279': 'z.B. {literal0}',
  'settings.scripts.AutomationsEditor.script.102acc10': 'Skript',
  'settings.scripts.AutomationsEditor.script_the_automation_runs.3c0b9704':
    'Erstellen Sie ein Skript für die Automatisierungsausführungen.',
  'settings.scripts.AutomationsEditor.choose_script.e582e7b2': 'Skript auswählen...',
  'settings.scripts.AutomationsEditor.search_the_scripts_for_the.ea85d26d':
    'Durchsuchen Sie die Skripts nach dem Skript, das diese Automatisierung ausführt',
  'settings.scripts.AutomationsEditor.this_script_takes_no_parameters.c613d6f9':
    'Dieses Skript benötigt keine Parameter.',
  'settings.scripts.AutomationsEditor.at_most_every_seconds.5cdb8590': 'Höchstens alle (Sekunden)',
  'settings.scripts.AutomationsEditor.for_one_note_changes_in.6ad4faaf':
    'Für eine Anmerkung. Änderungen dazwischen werden am Ende in einem Durchlauf zusammengefasst. 0 läuft bei jeder Änderung.',
  'settings.scripts.AutomationsEditor.also_for_changes_from_other.40be4225':
    'Auch für Änderungen von anderen Geräten',
  'settings.scripts.AutomationsEditor.off_a_change_that_arrives.ab733ca2':
    'Aus: Eine per Synchronisierung eintreffende Änderung führt hier nichts aus: Sie wurde bereits auf dem Gerät ausgeführt, auf dem sie vorgenommen wurde.',
  'settings.scripts.AutomationsEditor.add_automation.537c3ee4': 'Fügen Sie Automatisierung hinzu',
  'settings.scripts.AutomationsEditor.add_another_automation.78aa262d':
    'Fügen Sie eine weitere Automatisierung hinzu',
  'settings.scripts.AutomationsEditor.delete_automation.f71084e7': 'Automatisierung löschen',
  'settings.scripts.AutomationsEditor.delete_value_its_script_stops.dc5e80a0':
    '{value0} löschen? Sein Skript stoppt\n        läuft von alleine. Dies kann nicht rückgängig gemacht werden.',
  'settings.scripts.AutomationsEditor.no_script_chosen_yet.1662385a':
    'Noch kein Drehbuch ausgewählt',
  'settings.scripts.AutomationsEditor.no_description.06a69482': 'Keine Beschreibung.',
  'settings.scripts.AutomationsEditor.value_defaults_to_value.e824e925':
    '{value0} · Standardmäßig ist {value1}',
  'settings.scripts.HeaderButtonsEditor.header_buttons.1d80ae78': 'Kopfzeilen-Schaltflächen',

  'settings.scripts.HeaderButtonsEditor.unnamed_button.06e343d4': 'Unbenannte Schaltfläche',

  'settings.scripts.HeaderButtonsEditor.move_earlier_already_the_first.eafd3275':
    'Früher umziehen – schon der Erste',
  'settings.scripts.HeaderButtonsEditor.move_earlier_in_the_header.8dc04f10':
    'In der Kopfzeile nach vorne verschieben',
  'settings.scripts.HeaderButtonsEditor.move_later_already_the_last.a265fd45':
    'Später umziehen – schon der letzte',
  'settings.scripts.HeaderButtonsEditor.move_later_in_the_header.ab6bf94d':
    'Später in der Kopfzeile verschieben',
  'settings.scripts.HeaderButtonsEditor.change_this_button.8467d30e':
    'Ändern Sie diese Schaltfläche',
  'settings.scripts.HeaderButtonsEditor.add_another_button.1a22c516':
    'Fügen Sie eine weitere Schaltfläche hinzu',
  'settings.scripts.HeaderButtonsEditor.no_header_buttons_yet.429fc6f3':
    'Noch keine Header-Buttons',
  'settings.scripts.HeaderButtonsEditor.a_command_or_a_script.e4b5be3f':
    'Ein Befehl oder ein Skript für die Notizen, die Sie auswählen.',
  'settings.scripts.HeaderButtonsEditor.add_button.c0f290f3': 'Schaltfläche „Hinzufügen“.',
  'settings.scripts.HeaderButtonsEditor.add_a_header_button_and.959ddec8':
    'Fügen Sie eine Header-Schaltfläche hinzu und richten Sie sie ein',
  'settings.scripts.HeaderButtonsEditor.new_button.c499cbe3': 'Neuer Knopf',
  'settings.scripts.HeaderButtonsEditor.what_it_runs.ba619d80': 'Was es läuft',
  'settings.scripts.HeaderButtonsEditor.runs.848f54e8': 'Läuft',
  'settings.scripts.HeaderButtonsEditor.a_command_from_anywhere_in.2b8a7412':
    'Ein Befehl von irgendwo in Obsidian oder einem Ihrer Skripte.',
  'settings.scripts.HeaderButtonsEditor.name.dcd1d522': 'Name',
  'settings.scripts.HeaderButtonsEditor.shown_as_the_button_s.a52b2eef':
    'Wird als Tooltip der Schaltfläche und im Menü angezeigt, wo es nicht passt.',
  'settings.scripts.HeaderButtonsEditor.shown_on_the_button_or.18bb181b':
    'Wird auf der Schaltfläche oder als Tooltip angezeigt, wenn es sich nur um ein Symbol handelt.',
  'settings.scripts.HeaderButtonsEditor.e_g_fetch_details.9c250ebd': 'z.B. {literal0}',
  'settings.scripts.HeaderButtonsEditor.icon.a35abcd6': 'Symbol',
  'settings.scripts.HeaderButtonsEditor.shown_on_the_button_in.bf9242b8':
    'Wird auf der Schaltfläche in der Kopfzeile angezeigt.',
  'settings.scripts.HeaderButtonsEditor.choose_the_icon_from_the.9fd0ec06':
    'Wählen Sie das Symbol aus dem gesamten Set, nach Bild oder nach Namen',
  'settings.scripts.HeaderButtonsEditor.command.71316697': 'Befehl',
  'settings.scripts.HeaderButtonsEditor.command_the_button_runs.e980230f':
    'Befehl, den die Schaltfläche ausführt.',
  'settings.scripts.HeaderButtonsEditor.choose_command.ea49d680': 'Befehl auswählen...',
  'settings.scripts.HeaderButtonsEditor.search_every_command_obsidian_has.4ef0ca77':
    'Durchsuchen Sie jeden Befehl, den Obsidian hat, nach dem, den diese Schaltfläche ausführt',
  'settings.scripts.HeaderButtonsEditor.icon_only.7a047008': 'Nur Symbol',
  'settings.scripts.HeaderButtonsEditor.leave_the_name_off_the.b9311fa5':
    'Lassen Sie den Namen in der Kopfzeile weg, da die Kopfzeile bereits voll ist.',
  'settings.scripts.HeaderButtonsEditor.script.102acc10': 'Skript',
  'settings.scripts.HeaderButtonsEditor.script_the_button_runs.bd6df80c':
    'Skript, über das die Schaltfläche ausgeführt wird.',
  'settings.scripts.HeaderButtonsEditor.choose_script.e582e7b2': 'Skript auswählen...',
  'settings.scripts.HeaderButtonsEditor.search_the_scripts_for_the.dcae2ff4':
    'Durchsuchen Sie die Skripte nach dem Skript, das über diese Schaltfläche ausgeführt wird',
  'settings.scripts.HeaderButtonsEditor.this_script_takes_no_parameters.c613d6f9':
    'Dieses Skript benötigt keine Parameter.',
  'settings.scripts.HeaderButtonsEditor.where_it_shows.3397c2f1': 'Wo es sich zeigt',
  'settings.scripts.HeaderButtonsEditor.on_every_note.d761c688': 'Auf jede Note',
  'settings.scripts.HeaderButtonsEditor.whatever_its_type_tags_or.ed398572':
    'Unabhängig von Typ, Tags oder Ordner.',
  'settings.scripts.HeaderButtonsEditor.note_types.52d728fb': 'Notiztypen',
  'settings.scripts.HeaderButtonsEditor.e_g_movie_book.f621e5b4': 'z.B. {literal0}',
  'settings.scripts.HeaderButtonsEditor.folders.c4d6bb20': 'Ordner',
  'settings.scripts.HeaderButtonsEditor.e_g_films_library_books.2cdb7bb5': 'z.B. {literal0}',
  'settings.scripts.HeaderButtonsEditor.tags.1331275b': 'Schlagworte',
  'settings.scripts.HeaderButtonsEditor.comma_separated_with_or_without.3c0cedc4':
    'Durch Kommas getrennt, mit oder ohne #. Bei Notizen mit einem dieser Elemente oder einem darunter verschachtelten Tag wird die Schaltfläche ebenfalls angezeigt.',
  'settings.scripts.HeaderButtonsEditor.e_g_work_project_site.e87aea15': 'z.B. {literal0}',
  'settings.scripts.HeaderButtonsEditor.also_on_other_files.9f988318': 'Auch auf anderen Dateien',
  'settings.scripts.HeaderButtonsEditor.pdfs_canvases_books_and_other.b562d03c':
    'PDFs, Leinwände, Bücher und andere Dateien werden in einem Tab geöffnet, soweit die Ordner und Tags reichen. Sie haben weder Typ noch Eigenschaften.',
  'settings.scripts.HeaderButtonsEditor.only_when_its_properties.488c8e87':
    'Nur wenn seine Eigenschaften',
  'settings.scripts.HeaderButtonsEditor.the_note_must_also_have.6119d754':
    'Die Note muss diese auch in der Titelseite enthalten.',
  'settings.scripts.HeaderButtonsEditor.show_it_only_on_notes.d5cbb9eb':
    'Zeigen Sie es nur auf Notizen an, deren Hauptthema passt, beispielsweise ein Status oder ein ausgefülltes Datum.',
  'settings.scripts.HeaderButtonsEditor.add_condition.60a0d835': 'Bedingung hinzufügen',
  'settings.scripts.HeaderButtonsEditor.ask_for_one_more_property.20378dfa':
    'Fragen Sie nach einer weiteren Eigenschaft der Notiz',
  'settings.scripts.HeaderButtonsEditor.conditions_needed.9e17c43b': 'Bedingungen erforderlich',
  'settings.scripts.HeaderButtonsEditor.whether_the_note_has_to.997bc0f1':
    'Ob die Notiz alle unten aufgeführten Bedingungen oder eine davon erfüllen muss.',
  'settings.scripts.HeaderButtonsEditor.property.40040cb1': 'Eigenschaft',
  'settings.scripts.HeaderButtonsEditor.e_g_status.be5a95ab': 'z.B. {literal0}',
  'settings.scripts.HeaderButtonsEditor.e_g_todo.f74eec56': 'z.B. {literal0}',
  'settings.scripts.HeaderButtonsEditor.remove_this_condition.3b23e189':
    'Entfernen Sie diese Bedingung',
  'settings.scripts.HeaderButtonsEditor.delete.e2d0a549': 'Löschen',
  'settings.scripts.HeaderButtonsEditor.delete_this_button.3a238ae9': 'Diese Schaltfläche löschen',
  'settings.scripts.HeaderButtonsEditor.done.11a6767d': 'Fertig',
  'settings.scripts.HeaderButtonsEditor.close_this_window_changes_are.91342d87':
    'Schließen Sie dieses Fenster. Änderungen bleiben erhalten, sobald Sie sie vornehmen',
  'settings.scripts.HeaderButtonsEditor.delete_header_button.bf829880':
    'Schaltfläche „Kopfzeile löschen“.',
  'settings.scripts.HeaderButtonsEditor.delete_value_it_disappears_from.c2d5da26':
    '{value0} löschen? Es verschwindet von jedem\n        Notizkopfzeile, auf der es war. Dies kann nicht rückgängig gemacht werden.',
  'settings.scripts.HeaderButtonsEditor.a_command.18e6a3ee': 'Ein Befehl',
  'settings.scripts.HeaderButtonsEditor.a_script.1ccd820b': 'Ein Drehbuch',
  'settings.scripts.HeaderButtonsEditor.no_command_chosen_yet.114ca4e7':
    'Noch kein Befehl ausgewählt',
  'settings.scripts.HeaderButtonsEditor.no_script_chosen_yet.1662385a':
    'Noch kein Drehbuch ausgewählt',
  'settings.scripts.HeaderButtonsEditor.comma_separated_notes_whose_type.15826848':
    'Durch Kommas getrennt. Notizen, deren Typ frontmatter einer dieser ist, zeigen die Schaltfläche an.',
  'settings.scripts.HeaderButtonsEditor.no_note_in_this_vault.c4ccaca3':
    'Keine Notiz in diesem Vault hat den Typ {value0}.',
  'settings.scripts.HeaderButtonsEditor.no_note_in_this_vault.0477bd78':
    'Keine Notiz in diesem Vault hat den Typ {value0}.',
  'settings.scripts.HeaderButtonsEditor.value_types_in_use_value.165f7815':
    '{value0} Verwendete Typen: {value1}.',
  'settings.scripts.HeaderButtonsEditor.comma_separated_notes_anywhere_under.e213df44':
    'Durch Kommas getrennt. Bei Notizen irgendwo unter einer davon wird die Schaltfläche ebenfalls angezeigt. Ein * steht für ',
  'settings.scripts.HeaderButtonsEditor.any_one_folder_for_any.d06e9c0a':
    'ein beliebiger Ordner, ** für jede Tiefe: {literal0}.',
  'settings.scripts.HeaderButtonsEditor.no_folder_value_in_this.046d41b9':
    'Kein Ordner {value0} in diesem Vault.',
  'settings.scripts.HeaderButtonsEditor.no_folders_value_in_this.c62c6ef1':
    'Keine Ordner {value0} in diesem Vault.',
  'settings.scripts.HeaderButtonsEditor.is.fa51fd49': 'Ist',
  'settings.scripts.HeaderButtonsEditor.is_not.e1bf1560': 'ist nicht',
  'settings.scripts.HeaderButtonsEditor.is_filled_in.855a94e1': 'ist ausgefüllt',
  'settings.scripts.HeaderButtonsEditor.is_empty.86aaa00d': 'ist leer',
  'settings.scripts.HeaderButtonsEditor.all_of_them.29c88933': 'Alle von ihnen',
  'settings.scripts.HeaderButtonsEditor.any_one.4013adf2': 'Irgendjemand',
  'settings.scripts.HeaderButtonsEditor.no_description.06a69482': 'Keine Beschreibung.',
  'settings.scripts.HeaderButtonsEditor.value_defaults_to_value.e824e925':
    '{value0} · Standardmäßig ist {value1}',
  'settings.scripts.HeaderButtonsEditor.name_a_frontmatter_property_until.b0812819':
    'Benennen Sie eine Frontmatter-Eigenschaft; Bis dahin wird diese Bedingung ignoriert.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_filled.031bfe7b':
    'Notizen, deren {value0} ausgefüllt ist.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_empty.18f1876a':
    'Notizen, deren {value0} leer ist oder fehlt.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_anything.292370b0':
    'Notizen, deren {value0} alles andere als „{value1}“ ist, fehlen inklusive.',
  'settings.scripts.HeaderButtonsEditor.notes_whose_value_is_value.20728e9f':
    'Notizen, deren {value0} „{value1}“ ist, oder sie in einer Liste enthalten.',
  'settings.scripts.HeaderButtonsEditor.type_the_value_value_must.eb364908':
    'Geben Sie den Wert ein, den {value0} haben muss.',
  'settings.scripts.ScriptLibrary.library.dc20b3d5': 'Bibliothek',

  'settings.scripts.ScriptLibrary.scripts_are_switched_off_turn.13205644':
    'Skripte sind ausgeschaltet. Aktivieren Sie sie unter „Allgemein“, um zu sehen, was der Ordner enthält.',
  'settings.scripts.ScriptLibrary.filter.638e249f': 'Filter',
  'settings.scripts.ScriptLibrary.by_name_or_description.95a3575e': 'Nach Name oder Beschreibung.',
  'settings.scripts.ScriptLibrary.e_g_archive.a525e8b2': 'z.B. {literal0}',
  'settings.scripts.ScriptLibrary.no_script_matches_that.547f44e0': 'Kein Skript passt dazu.',
  'settings.scripts.ScriptLibrary.no_scripts_in_the_folder.361e62fa':
    'Es sind noch keine Skripte im Ordner vorhanden.',
  'settings.scripts.ScriptLibrary.refused.66b87354': 'Abgelehnt',
  'settings.scripts.ScriptLibrary.waiting_to_be_confirmed.8d2c8168': 'Warte auf Bestätigung',
  'settings.scripts.ScriptLibrary.off.ca7981b4': 'Aus',
  'settings.scripts.ScriptLibrary.toolbar.451aa51a': 'Symbolleiste',
  'settings.scripts.ScriptLibrary.startup.65d48235': 'Start-up',
  'settings.scripts.ScriptLibrary.it_changed_without_being_written.9f37bd87':
    'Es hat sich geändert, ohne dass es auf diesem Gerät geschrieben wurde: Schauen Sie es sich an und bestätigen Sie es',
  'settings.scripts.ScriptLibrary.review_execution_trust_on_this.1dc6af3c':
    'Überprüfen Sie die Ausführungsvertrauenswürdigkeit auf diesem Gerät, ohne das Skript auszuführen',
  'settings.scripts.ScriptLibrary.run_this_script_now.ef501cea':
    'Führen Sie dieses Skript jetzt aus',
  'settings.scripts.ScriptLibrary.add_a_header_button_that.00d00d3b':
    'Fügen Sie eine Header-Schaltfläche hinzu, die dieses Skript ausführt',
  'settings.scripts.ScriptLibrary.no_description_yet_add_a.df1a932d':
    'Noch keine Beschreibung – fügen Sie oben in der Datei eine Zeile {literal0} hinzu.',
  'settings.scripts.ScriptLibrary.no_parameters.3a7003b7': 'Keine Parameter',
  'settings.scripts.ScriptLibrary.on_the_toolbar_by_its.523a3a4d':
    'In der Symbolleiste in der Kopfzeile {literal0}',
  'settings.scripts.ScriptLibrary.take_it_off_the_toolbar.aeab7aed':
    'Entfernen Sie es aus der Symbolleiste',
  'settings.scripts.ScriptLibrary.put_it_on_the_toolbar.00b0cd91':
    'Platzieren Sie es in der Symbolleiste: im linken Menüband und über der Tastatur eines Telefons',
  'settings.scripts.ScriptLibrary.runs_at_startup_by_its.a6064a2b':
    'Wird beim Start über die Headerzeile {literal0} ausgeführt',
  'settings.scripts.ScriptLibrary.stop_running_it_when_obsidian.82244aa9':
    'Hören Sie auf, es auszuführen, wenn Obsidian startet',
  'settings.scripts.ScriptLibrary.run_it_each_time_obsidian.2c1778ac':
    'Führen Sie es jedes Mal aus, wenn Obsidian startet',
  'settings.scripts.ScriptsGeneral.enable_scripts.4fe25ff6': 'Skripte aktivieren',
  'settings.scripts.ScriptsGeneral.allow_javascript_scripts_stored_in.1e5b4bf9':
    'Ermöglichen Sie die Registrierung von in einem Vaultordner gespeicherten JavaScript-Skripten als Befehle und KI-Tools.',
  'settings.scripts.ScriptsGeneral.synced_script_policy.a4d283f1':
    'Richtlinie für synchronisierte Skripte',
  'settings.scripts.ScriptsGeneral.personal_sync_until_confirmed_on.6340833f':
    'Persönliche Synchronisierung: bis zur Bestätigung auf diesem Gerät. Gemeinsame und Agentenverbindungen: ablehnen. Führen Sie ein Skript manuell aus, um seine genauen Bytes zu überprüfen. Fehlende Provenienz erfordert Wiederherstellung; Genehmigungen werden nie synchronisiert.',
  'settings.scripts.ScriptsGeneral.scripts_folder.fd88dd8d': 'Ordner „Skripte“.',
  'settings.scripts.ScriptsGeneral.vault_folder_containing_js_script.d5c97d89':
    'Vault-Ordner mit .js-Skriptdateien.',
  'settings.scripts.ScriptsGeneral.e_g_system_scripts.f729b48b': 'z.B. {literal0}',
  'settings.scripts.ScriptsGeneral.confirm_scripts_from_other_devices.ba3bb6ea':
    'Bestätigen Sie Skripte von anderen Geräten',
  'settings.scripts.ScriptsGeneral.script_waits_to_be_confirmed.97d74aac':
    '1 Skript wartet auf diesem Gerät auf Bestätigung.',
  'settings.scripts.ScriptsGeneral.value_scripts_wait_to_be.7d9d81b9':
    '{value0} Skripte warten auf die Bestätigung auf diesem Gerät.',
  'settings.scripts.ScriptsGeneral.review.aff0766a': 'Rezension',

  'settings.scripts.ScriptsGeneral.ai_agent_default_tool_modes.18eb6e27':
    'AI Agent → Standard-Tool-Modi',

  'settings.scripts.ScriptsGeneral.a_script_that_appears_or.cef15a6e':
    'Ein Skript, das auf diesem Gerät erscheint oder sich ändert, ohne dass es geschrieben wurde – über Obsidian Sync, iCloud, Syncthing, Git – wartet, bis Sie es sich ansehen und es hier bestätigen. Bis dahin wird es nicht über Schaltflächen, Automatisierungen, Startups und Agenten ausgeführt. Skripte, die Sie auf diesem Gerät, im Editor oder über Abele schreiben, gelten als bestätigt. Wenn Sie diese Option aktivieren, wird jedes Skript im Ordner so akzeptiert, wie es jetzt ist. Bestätigungen werden nur auf diesem Gerät gespeichert; Wenn Sie es hier ausschalten, werden sie vergessen, und zwar nur für dieses Gerät.',
  'settings.scripts.SelectionScriptsSettings.scripts_on_selected_words.1698fbec':
    'Skripte zu ausgewählten Wörtern',
  'settings.scripts.SelectionScriptsSettings.scripts_pinned_to_the_book.f58bed5f':
    'An das Buchauswahlmenü angeheftete Skripte, in dieser Reihenfolge. Bis zu drei davon sind je eine Taste; mehr in ein Menü falten. Andere Skripte verbleiben unter „Andere Skripte…“.',
  'settings.scripts.SelectionScriptsSettings.scripts_chosen_for_the_chat.db9d7d44':
    'Für das Chat-Auswahlmenü ausgewählte Skripte, unabhängig von Büchern. Die Unterstützung für den Chat-Start ist noch nicht aktiviert.',
  'settings.scripts.SelectionScriptsSettings.there_are_no_scripts_yet.3ac66fc7':
    'Es sind noch keine Skripte vorhanden: Fügen Sie zunächst eines zum Skriptordner hinzu.',
  'settings.scripts.SelectionScriptsSettings.nothing_on_the_menu_yet.e30d6c11':
    'Noch nichts auf der Speisekarte.',
  'settings.scripts.SelectionScriptsSettings.script_value.804f5354': 'Skript: {value0}',
  'settings.scripts.SelectionScriptsSettings.script_value_not_found.48b085e0':
    'Skript: {value0} – nicht gefunden',
  'settings.scripts.SelectionScriptsSettings.name_on_the_bar.6c09f682': 'Name auf der Leiste',
  'settings.scripts.SelectionScriptsSettings.choose_the_icon_it_has.ebff10d4':
    'Wählen Sie das Symbol in der Leiste aus',
  'settings.scripts.SelectionScriptsSettings.already_the_first.eab62d41': 'Schon der Erste',
  'settings.scripts.SelectionScriptsSettings.move_it_up_the_menu.20938d10':
    'Verschieben Sie es im Menü nach oben',
  'settings.scripts.SelectionScriptsSettings.already_the_last.a6ec4b12': 'Schon der Letzte',
  'settings.scripts.SelectionScriptsSettings.move_it_down_the_menu.dc508335':
    'Verschieben Sie es im Menü nach unten',
  'settings.scripts.SelectionScriptsSettings.take_it_off_the_menu.c979b889':
    'Streichen Sie es von der Speisekarte',
  'settings.scripts.SelectionScriptsSettings.on_the_menu_by_its.9695bd79':
    'Im Menü durch einen eigenen Header ({value0}), nach den oben genannten. Fügen Sie es zur Liste hinzu, um es umzubenennen oder ihm einen Platz zuzuweisen.',
  'settings.scripts.SelectionScriptsSettings.add_to_the_list.6b62dd0b': 'Zur Liste hinzufügen',
  'settings.scripts.SelectionScriptsSettings.put_value_in_the_list.ab3d4711':
    'Fügen Sie {value0} in die obige Liste ein, um es umzubenennen oder zu verschieben',
  'settings.scripts.SelectionScriptsSettings.add_a_script.c4526bc4': 'Fügen Sie ein Skript hinzu',
  'settings.scripts.SelectionScriptsSettings.search_your_scripts_for_one.702cfb4f':
    'Durchsuchen Sie Ihre Skripte nach einem, das Sie in das Menü einfügen können',
  'settings.scripts.SelectionScriptsSettings.take_off_the_menu.c4b604ec':
    'Nehmen Sie die Speisekarte ab',
  'settings.scripts.SelectionScriptsSettings.take_value_off_the_menu.66090b83':
    'Für Wörter in einem {value1} {value0} aus der Speisekarte nehmen? Das Skript selbst bleibt.{value2}',
  'settings.scripts.StartupScriptsEditor.startup.65d48235': 'Start-up',
  'settings.scripts.StartupScriptsEditor.scripts_run_each_time_obsidian.149c2450':
    'Skripte werden bei jedem Start von Obsidian nacheinander in dieser Reihenfolge ausgeführt, sobald der Vault geöffnet ist. Ein Skript, das Parameter annimmt, erhält seine Standardwerte; einer, der einen Wert ohne Standard benötigt, wird übersprungen. Platzieren Sie hier ein Skript mit dem Netzschalter auf seiner Karte in der Bibliothek.',
  'settings.scripts.StartupScriptsEditor.don_t_run_startup_scripts.a287f1aa':
    'Führen Sie keine Startskripte aus',
  'settings.scripts.StartupScriptsEditor.skips_all_of_them_until.bf97689c':
    'Überspringt alle, bis wieder zurückgeschaltet wird. Wenn ein Startskript Obsidian einfriert, wird es beim nächsten Start von Obsidian ebenfalls von selbst übersprungen.',
  'settings.scripts.StartupScriptsEditor.there_are_no_scripts_yet.3ac66fc7':
    'Es sind noch keine Skripte vorhanden: Fügen Sie zunächst eines zum Skriptordner hinzu.',
  'settings.scripts.StartupScriptsEditor.no_startup_scripts_yet.30a2445c':
    'Noch keine Startskripte.',
  'settings.scripts.StartupScriptsEditor.not_found_in_the_scripts.e5cfdc39':
    'Nicht im Skriptordner gefunden',
  'settings.scripts.StartupScriptsEditor.already_the_first.eab62d41': 'Schon der Erste',
  'settings.scripts.StartupScriptsEditor.run_it_earlier.01c77f4e': 'Führen Sie es früher aus',
  'settings.scripts.StartupScriptsEditor.already_the_last.a6ec4b12': 'Schon der Letzte',
  'settings.scripts.StartupScriptsEditor.run_it_later.f2761f7f': 'Führen Sie es später aus',
  'settings.scripts.StartupScriptsEditor.stop_running_it_at_startup.7b061cf3':
    'Stoppen Sie die Ausführung beim Start',
  'settings.scripts.StartupScriptsEditor.runs_at_startup_by_its.2407579f':
    'Wird beim Start durch seinen eigenen Header (@startup) nach den oben genannten auf {value0} ausgeführt. Fügen Sie es zur Liste hinzu, um ihm einen Platz zu geben.',
  'settings.scripts.StartupScriptsEditor.add_to_the_list.6b62dd0b': 'Zur Liste hinzufügen',
  'settings.scripts.StartupScriptsEditor.put_value_in_the_list.f0c37c74':
    'Tragen Sie {value0} in die Liste oben ein, um es zu verschieben oder seine Geräte auszuwählen',
  'settings.scripts.StartupScriptsEditor.add_a_script.c4526bc4': 'Fügen Sie ein Skript hinzu',
  'settings.scripts.StartupScriptsEditor.search_your_scripts_for_one.d53e42be':
    'Durchsuchen Sie Ihre Skripte nach einem, das beim Start ausgeführt werden soll',
  'settings.scripts.StartupScriptsEditor.every_device.9b626893': 'Jedes Gerät',
  'settings.scripts.StartupScriptsEditor.computers.680cb3c6': 'Computer',
  'settings.scripts.StartupScriptsEditor.phones_and_tablets.578553d2': 'Telefone und Tablets',
  'settings.scripts.StartupScriptsEditor.every_device.17779e2b': 'jedes Gerät',
  'settings.scripts.StartupScriptsEditor.phones_and_tablets.a522653d': 'Telefone und Tablets',
  'settings.sync.ExternalFileRules.keep_only_on_the_server.21caa8b7': 'Nur auf dem Server behalten',
  'settings.sync.ExternalFileRules.device_local_rule_it_runs.cc40b724':
    'Gerätelokale Regel. Es wird nur ausgeführt, wenn Sie eine Vorschau anzeigen und bestätigen. Angeheftete, geänderte und geöffnete Dateien bleiben hier.',
  'settings.sync.ExternalFileRules.offload_folder.6566fece': 'Ordner auslagern',
  'settings.sync.ExternalFileRules.empty_means_all_folders.c907d956': 'Leer bedeutet alle Ordner.',
  'settings.sync.ExternalFileRules.all_folders.226fd0e5': 'Alle Ordner',
  'settings.sync.ExternalFileRules.file_types.696bc9a7': 'Dateitypen',
  'settings.sync.ExternalFileRules.comma_separated_extensions_empty_means.6af4a62a':
    'Durch Kommas getrennte Erweiterungen. Leer bedeutet alle Anhangstypen.',
  'settings.sync.ExternalFileRules.pdf_epub_jpg.aef4166d': 'pdf, epub, jpg',
  'settings.sync.ExternalFileRules.minimum_size_mib.f9c796bb': 'Mindestgröße (MiB)',
  'settings.sync.ExternalFileRules.not_opened_for_days.42eb5259': 'Seit Tagen nicht geöffnet',
  'settings.sync.ExternalFileRules.ignores_age_files_without_a.a2dd1ff0':
    '0 ignoriert das Alter. Dateien ohne aufgezeichnete Eröffnung werden bei der Alterseinstellung ausgeschlossen.',
  'settings.sync.ExternalFileRules.review_matching_files.f7400143':
    'Überprüfen Sie übereinstimmende Dateien',
  'settings.sync.ExternalFileRules.see_every_file_and_the.b398409d':
    'Sehen Sie sich jede Datei und den geschätzten Speicherplatz an, bevor Sie Änderungen vornehmen.',
  'settings.sync.ExternalFileRules.preview.324b134f': 'Vorschau',
  'settings.sync.ExternalFileRules.list_matching_files_and_review.df3d52b2':
    'Listen Sie übereinstimmende Dateien auf und überprüfen Sie den Speicherplatz, bevor Sie sie auslagern',
  'settings.sync.SelectiveSync.what_this_device_syncs.979d00ce': 'Was dieses Gerät synchronisiert',
  'settings.sync.SelectiveSync.notes_and_canvases_always_travel.395d3522':
    'Notizen und Leinwände reisen immer. Alles andere bleibt dem Gerät selbst überlassen – ein Telefon kann das Video überspringen und trotzdem jede Notiz speichern.',
  'settings.sync.SelectiveSync.largest_file.5cd59717': 'Größte Datei',
  'settings.sync.SelectiveSync.files_bigger_than_this_are.ce27e6e7':
    'Größere Dateien werden übersprungen, angegeben in Megabyte. Lassen Sie es leer, um alles mitzunehmen.',
  'settings.sync.SelectiveSync.no_limit.f7fcff0d': 'Keine Begrenzung',
  'settings.sync.SelectiveSync.obsidian_settings.b1370814': 'Obsidian-Einstellungen',
  'settings.sync.SelectiveSync.folders_this_device_skips.f47a9f56':
    'Ordner, die dieses Gerät überspringt',
  'settings.sync.SelectiveSync.nothing_under_a_folder_listed.6abc4f89':
    'Nichts in einem der hier aufgeführten Ordner wird von diesem Gerät hochgeladen oder heruntergeladen. Die anderen Geräte halten es noch.',
  'settings.sync.SelectiveSync.skipped_by_this_device.a7679073': 'Von diesem Gerät übersprungen.',
  'settings.sync.SelectiveSync.sync_this_folder_on_this.b41e686c':
    'Synchronisieren Sie diesen Ordner erneut auf diesem Gerät',
  'settings.sync.SelectiveSync.this_device_syncs_every_folder.5c1a44be':
    'Dieses Gerät synchronisiert jeden Ordner.',
  'settings.sync.SelectiveSync.skip_a_folder.1f3e8658': 'Überspringen Sie einen Ordner',
  'settings.sync.SelectiveSync.pick_a_folder_this_device.dab71c43':
    'Wählen Sie einen Ordner aus, den dieses Gerät in Ruhe lassen soll.',
  'settings.sync.SelectiveSync.e_g_archive_video.b35fc660': 'z.B. {literal0}',
  'settings.sync.SelectiveSync.skip.28d03596': 'Überspringen',
  'settings.sync.SelectiveSync.stop_syncing_this_folder_on.a245d063':
    'Stoppen Sie die Synchronisierung dieses Ordners auf diesem Gerät',
  'settings.sync.SelectiveSync.name_a_folder_to_skip.987a0698':
    'Benennen Sie einen Ordner, der zuerst übersprungen werden soll',
  'settings.sync.SelectiveSync.images.be7e2f20': 'Bilder',
  'settings.sync.SelectiveSync.screenshots_photos_drawings_and_diagrams.34494a0e':
    'Screenshots, Fotos, Zeichnungen und Diagramme.',
  'settings.sync.SelectiveSync.audio.bc1b8890': 'Audio',
  'settings.sync.SelectiveSync.recordings_and_voice_notes.2bf25181': 'Aufnahmen und Sprachnotizen.',
  'settings.sync.SelectiveSync.video.d534be82': 'Video',
  'settings.sync.SelectiveSync.the_heaviest_thing_a_vault.c54886fb':
    'Das Schwerste, was normalerweise in einem Vault aufbewahrt wird.',
  'settings.sync.SelectiveSync.pdfs.211eae3f': 'PDFs',
  'settings.sync.SelectiveSync.papers_manuals_and_scans.55635c99': 'Papiere, Handbücher und Scans.',
  'settings.sync.SelectiveSync.everything_else.cd6c5f59': 'Alles andere',
  'settings.sync.SelectiveSync.attachments_of_no_listed_type.d6b34625':
    'Anhänge, deren Typ nicht aufgeführt ist, und der Skriptordner.',
  'settings.sync.SelectiveSync.app_settings.d43fb8a9': 'App-Einstellungen',
  'settings.sync.SelectiveSync.editor_and_file_behaviour_from.0132e8bd':
    'Editor- und Dateiverhalten, von app.json.',
  'settings.sync.SelectiveSync.appearance.3907fa7f': 'Aussehen',
  'settings.sync.SelectiveSync.the_theme_its_snippets_and.584f5304':
    'Das Thema, seine Ausschnitte und die Schriftartenauswahl.',
  'settings.sync.SelectiveSync.hotkeys.c15f1530': 'Hotkeys',
  'settings.sync.SelectiveSync.the_shortcuts_you_have_bound.3f1903d8':
    'Die Verknüpfungen, die Sie gebunden haben.',
  'settings.sync.SelectiveSync.core_plugins.f2e957b0': 'Kern-Plugins',
  'settings.sync.SelectiveSync.which_of_obsidian_s_own.99bc1676':
    'Welche der Obsidian-eigenen Plugins sind aktiviert?',
  'settings.sync.SelectiveSync.community_plugins.ab574402': 'Community-Plugins',
  'settings.sync.SelectiveSync.the_plugins_themselves_so_a.9c0fb58f':
    'Die Plugins selbst, also ein neues Gerät, installiert das, was auf diesem läuft.',
  'settings.sync.SelectiveSync.plugin_settings.95d7fb37': 'Plugin-Einstellungen',
  'settings.sync.SelectiveSync.what_each_community_plugin_holds.3087ad5b':
    'Was jedes Community-Plugin in seiner eigenen data.json enthält.',
  'settings.sync.SelectiveSync.this_device_keeps_its_settings.6f44f3ee':
    'Dieses Gerät behält seine Einstellungen in einem umbenannten Konfigurationsordner, {value0}, und die Synchronisierung trägt noch keinen: Obsidian-Einstellungen bleiben auf diesem Gerät und diejenigen auf dem Server bleiben unverändert.',
  'settings.sync.SelectiveSync.how_much_of_the_configuration.426f0882':
    'Wie viel vom Konfigurationsordner übertragen wird. Der Arbeitsbereich, das Diagramm und jeder Plugin-Cache bleiben auf jedem Gerät dort, wo sie sind.',
  'settings.sync.SelectiveSync.nothing_was_changed_value.d24494c2':
    'Es wurde nichts geändert: {value0}',
  'settings.transfer.TransferPreviewModal.what_will_be_sent.86f3f00c': 'Was wird verschickt?',
  'settings.transfer.TransferPreviewModal.carries_a_key.0d090cb4': 'Trägt einen Schlüssel',
  'settings.transfer.TransferPreviewModal.keys.f0d66a79': 'Schlüssel',
  'settings.transfer.TransferPreviewModal.shown_masked_here_they_travel.6de2d018':
    'Hier maskiert dargestellt; sie reisen vollständig, weshalb die Übertragung gesperrt ist.',
  'settings.transfer.TransferScanModal.read_a_transfer.da2dcc0f': 'Übertragung einlesen',
  'settings.transfer.TransferScanModal.use_the_camera.429bb22e': 'Benutze die Kamera',
  'settings.transfer.TransferScanModal.point_the_camera_at_the.81f345ce':
    'Richten Sie die Kamera auf die Codes auf dem anderen Gerät',
  'settings.transfer.TransferScanModal.take_a_photo.996e6a73': 'Machen Sie ein Foto',
  'settings.transfer.TransferScanModal.photograph_the_code_or_pick.31bb8c87':
    'Fotografieren Sie den Code oder wählen Sie ein Bild davon aus',
  'settings.transfer.TransferScanModal.open_a_file.3b31f677': 'Öffnen Sie eine Datei',
  'settings.transfer.TransferScanModal.read_a_transfer_saved_as.0d55f3e7':
    'Lesen Sie eine als Datei auf dem anderen Gerät gespeicherte Übertragung',
  'settings.transfer.TransferScanModal.paste_the_text.d98782e3': 'Fügen Sie den Text ein',
  'settings.transfer.TransferScanModal.paste_the_transfer_as_text.5455e7aa':
    'Fügen Sie die Übertragung als Text ein, anstatt einen Code zu lesen',
  'settings.transfer.TransferScanModal.abl.c834a09f': 'ABL1:…',
  'settings.transfer.TransferScanModal.codes_read.99b98121': 'Codes gelesen',

  'settings.transfer.TransferScanModal.nothing_read_yet_the_other.eab29908':
    'Noch nichts gelesen. Das andere Gerät zeigt die Codes an; Dieser sammelt sie in beliebiger Reihenfolge.',
  'settings.transfer.TransferScanModal.this_transfer_carries_a_key.fd9c3a91':
    'Diese Übertragung ist mit einem Schlüssel versehen und somit gesperrt. Geben Sie den auf dem anderen Gerät angezeigten Code ein.',
  'settings.transfer.TransferScanModal.characters.2ad81da8': '8 Zeichen',

  'settings.transfer.TransferScanModal.what_to_do_with_what.99215800':
    'Was tun mit dem, was bereits da ist?',
  'settings.transfer.TransferScanModal.keep_value.c1cdcb02': '{value0} behalten',
  'settings.transfer.TransferScanModal.not_on_this_device_yet.591f425a':
    'Noch nicht auf diesem Gerät',
  'settings.transfer.TransferScanModal.replaces_the_one_already_on.a7c76324':
    'Ersetzt das bereits auf diesem Gerät vorhandene',
  'settings.transfer.TransferScanModal.already_here_the_same.1f75ca0c': 'Schon hier, das Gleiche',
  'settings.transfer.TransferScanModal.unlock.4ac709aa': 'Entsperren',
  'settings.transfer.TransferScanModal.open_the_transfer_with_this.2ad88253':
    'Öffnen Sie die Überweisung mit diesem Code',
  'settings.transfer.TransferScanModal.apply.31e392d1': 'Anwenden',
  'settings.transfer.TransferScanModal.that_transfer_did_not_arrive.1b9bb186':
    'Diese Überweisung kam nicht vollständig an. Lesen Sie die Codes erneut.',
  'settings.transfer.TransferScanModal.that_code_does_not_open.de6ab3a4':
    'Dieser Code öffnet diese Übertragung nicht.',
  'settings.transfer.TransferScanModal.anything_here_that_the_transfer.589d08a0':
    'Alles, was in der Übertragung nicht erwähnt wird, wird hier unterlassen.',
  'settings.transfer.TransferScanModal.nothing_here_would_be_removed.319450b4':
    'Hier würde nichts entfernt werden: Die Übertragung deckt alles ab.',
  'settings.transfer.TransferScanModal.value_value_scripts_skills_and.11b87876':
    '{value0}: {value1}. Skripte, Fähigkeiten und Eingabeaufforderungen werden niemals gelöscht.',

  'settings.transfer.TransferScanModal.value_to_store_for_the.22f67128':
    '{value0} zum Speichern für die ausgewählten Elemente.',
  'settings.transfer.TransferScanModal.no_keys_to_store_for.40b27ff7':
    'Für die ausgewählten Elemente müssen keine Schlüssel gespeichert werden.',
  'settings.transfer.TransferScanModal.just_now.7ddb44d8': 'soeben',
  'settings.transfer.TransferScanModal.today_at_value.c0d04ee3': 'heute um {value0}',
  'settings.transfer.TransferScanModal.already_applied.ca602d60': 'Bereits angewendet',
  'settings.transfer.TransferScanModal.applying.3329a9bb': 'Bewerben…',
  'settings.transfer.TransferScanModal.write_these_into_this_vault.1d9ecead':
    'Schreiben Sie diese in die Einstellungen dieses Vaults',
  'settings.transfer.TransferScanModal.tick_something_to_apply_first.c9effb7d':
    'Kreuzen Sie zuerst etwas an, das angewendet werden soll',
  'settings.transfer.TransferScanModal.these_settings_could_not_be.77e9b53e':
    'Diese Einstellungen konnten nicht angewendet werden.',
  'settings.transfer.TransferScanModal.no_camera_here_take_a.1f89f870':
    'Keine Kamera hier. Machen Sie ein Foto des Codes oder fügen Sie die Übertragung als Text ein.',
  'settings.transfer.TransferScanModal.no_transfer_in_that_file.f0c76a1f':
    'Keine Übertragung in dieser Datei.',
  'settings.transfer.TransferScanModal.no_code_in_that_picture.34801264':
    'Auf diesem Bild ist kein Code zu sehen.',
  'settings.transfer.TransferSendModal.send_to_another_device.71ef2876':
    'An ein anderes Gerät senden',
  'settings.transfer.TransferSendModal.name_for_the_other_device.33a35391':
    'Name für das andere Gerät',
  'settings.transfer.TransferSendModal.the_server_makes_a_device.e8785846':
    'Der Server erstellt dafür ein eigenes Gerät, und in der Geräteliste des Vaults wird es unter diesem Namen angezeigt.',
  'settings.transfer.TransferSendModal.other_device.76d065a6': 'Anderes Gerät',
  'settings.transfer.TransferSendModal.asking_the_server_for_a.efc54b48':
    'Den Server um ein eigenes Gerät für die Gegenseite bitten…',
  'settings.transfer.TransferSendModal.type_this_on_the_other.ebbcbff7':
    'Geben Sie dies auf dem anderen Gerät ein',
  'settings.transfer.TransferSendModal.transfer_code_value_of_value.62240606':
    'Übertragungscode {value0} von {value1}',
  'settings.transfer.TransferSendModal.previous_code.9073b55e': 'Vorheriger Code',
  'settings.transfer.TransferSendModal.next_code.2924d04c': 'Nächster Code',
  'settings.transfer.TransferSendModal.stop_moving_through_the_codes.333446f8':
    'Hören Sie auf, sich durch die Codes zu bewegen',
  'settings.transfer.TransferSendModal.move_through_the_codes_on.e5a80219':
    'Gehen Sie die Codes selbstständig durch',
  'settings.transfer.TransferSendModal.make_the_codes.05fce439': 'Machen Sie die Codes',
  'settings.transfer.TransferSendModal.have_the_server_make_the.26277032':
    'Lassen Sie den Server das andere Gerät herstellen und die Codes anzeigen',
  'settings.transfer.TransferSendModal.give_the_other_device_a.62f36130':
    'Geben Sie dem anderen Gerät zunächst einen Namen',
  'settings.transfer.TransferSendModal.save_a_file.637ed29a': 'Speichern Sie eine Datei',
  'settings.transfer.TransferSendModal.save_the_transfer_as_a.5b9056e0':
    'Speichern Sie die Übertragung als Datei außerhalb der Synchronisierung, um sie nach Belieben weiterzuleiten',
  'settings.transfer.TransferSendModal.show_the_codes.1eb16a33': 'Zeigen Sie die Codes an',

  'settings.transfer.TransferSendModal.copy_the_text.a9c0e598': 'Kopieren Sie den Text',
  'settings.transfer.TransferSendModal.copy_the_whole_transfer_to.c3ca218d':
    'Kopieren Sie die gesamte Übertragung, um sie auf dem anderen Gerät einzufügen',
  'settings.transfer.TransferSendModal.the_code_above_unlocks_it.868154f8':
    ' Der obige Code entsperrt es auf der anderen Seite.',
  'settings.transfer.TransferSendModal.read_the_code_or_copy.1530b601':
    'Lesen Sie den Code oder kopieren Sie den Text.{value0}',
  'settings.transfer.TransferSendModal.value_codes_shown_one_after.2e23aff2': {
    one: '{count}-Codes, die nacheinander angezeigt werden – oder kopieren Sie den Text und überspringen Sie die Kamera.{value1}',
    other:
      '{count}-Codes, die nacheinander angezeigt werden – oder kopieren Sie den Text und überspringen Sie die Kamera.{value1}',
  },
  'settings.transfer.TransferSendModal.this_one_takes_value_codes.0c640e1f': {
    one: 'Dieser benötigt {count}-Codes, was mehr ist, als irgendjemand fotografieren möchte. Kopieren Sie den Text in eine Nachricht oder speichern Sie ihn als Datei und senden Sie diese.{value1}',
    other:
      'Dieser benötigt {count}-Codes, was mehr ist, als irgendjemand fotografieren möchte. Kopieren Sie den Text in eine Nachricht oder speichern Sie ihn als Datei und senden Sie diese.{value1}',
  },
  'settings.transfer.TransferSendModal.could_not_copy_the_text.0545a659':
    'Der Text konnte nicht kopiert werden. Wählen Sie es unten aus und kopieren Sie es oder speichern Sie es als Datei.',
  'settings.transfer.TransferSendModal.transfer_copied_paste_it_on.e525bf9c':
    'Übertragung kopiert. Fügen Sie es auf dem anderen Gerät ein.',
  'settings.transfer.TransferSendModal.open_it_under_read_a.eb80ca07':
    'Öffnen Sie es unter „Eine Übertragung lesen“ auf dem anderen Gerät',
  'settings.transfer.TransferSendModal.saved_to_value_value.fdb8f6e2':
    'Gespeichert unter {value0}. {value1}.',
  'settings.transfer.TransferSendModal.saved_as_value_in_a.6994b91d':
    'Gespeichert als {value0}, in einem versteckten Ordner dieses Vaults, den Abele Sync nicht führt. ',
  'settings.transfer.TransferSendModal.value_and_delete_it_once.ed61f2ef':
    '{value0} und löschen Sie es, sobald es gelesen wurde.',
  'settings.transfer.TransferSendModal.could_not_save_it_value.14315a58':
    'Konnte nicht gespeichert werden: {value0}',
  'settings.rich.bc6ba5473fff4aa8':
    'Ein Skript, dessen erste Zeilen {slot0} lauten, ist eine Regel: Es gibt {slot1} zurück, eine Liste der Fehler, und möglicherweise {slot2}, den neuen Text der Notiz. Es ist oben zusammen mit den anderen aufgeführt. Auf der Seite „Skripte“ der Dokumentation wird eines angezeigt.',
  'settings.rich.ae545f75ff9437be':
    'Keine Fertigkeiten in diesem Vault. Fertigkeiten sind Notizen mit {slot0}.',
  'settings.rich.3cf5061d7d4aaae2':
    'Schlüssel und Token für API-Anfragen. Der KI-Agent verwendet in Abrufaufrufen {slot0}, das durch den tatsächlichen Wert ersetzt wird. Sicher im Schlüsselbund aufbewahrt.',
  'settings.rich.59db234df027f515':
    'Skripte, die von selbst ausgeführt werden, wenn etwas mit einer Notiz passiert: eine Aufgabe abgeschlossen, eine Notiz eines bestimmten Typs geändert. Das Skript liest, was passiert ist, als {slot0}. Die Parameter akzeptieren {slot1} und jedes Titelfeld der Notiz. Sie laufen auf dem Gerät, auf dem die Änderung vorgenommen wurde; Die eigenen Schreibvorgänge eines Skripts lösen nie wieder dieselbe Automatisierung aus.',
  'settings.rich.5c124ccc61dc59ea':
    'Schaltflächen über dem Text einer Notiz, die einen Befehl oder ein Skript für die von Ihnen ausgewählten Notizen in dieser Reihenfolge ausführen. Einem Skript können die Werte der Notiz übergeben werden: {slot0} oder eine beliebige Eigenschaft, {slot1}.',
  'settings.rich.225479f70a17e374':
    'Jedes Skript im Skriptordner. Ein Skript beschreibt sich selbst im Kommentarblock am Anfang seiner Datei: {slot0}, {slot1}, {slot2} und eine {slot3}-Zeile pro Wert, den es annimmt. Der Pin fügt ein Skript in die Symbolleiste ein: ein Symbol im linken Menüband eines Computers und eine Stelle in der Symbolleiste über der Tastatur eines Telefons – {slot4} in der Kopfzeile – bewirkt dasselbe. Der Netzschalter führt bei jedem Start von Obsidian ein Skript aus; {slot5} in seiner Kopfzeile macht dasselbe und die Registerkarte „Startup“ bringt sie in die richtige Reihenfolge.',
  'settings.rich.82dd523dc663e313':
    '{slot0}-Skripte entdeckt. Konfigurieren Sie Werkzeugmodi in {slot1} oder pro Chat im Berechtigungsmodal.',
  'settings.terms.keySaved': 'Schlüssel gespeichert',
  'settings.terms.noKeyYet': 'Noch kein Schlüssel',
  'settings.terms.thisKey': 'diesen Schlüssel',
  'settings.terms.none': 'keiner',
  'settings.terms.theSecret': 'das Geheimnis',
  'settings.terms.unnamedAutomation': 'diese unbenannte Automatisierung',
  'settings.terms.unnamedButton': 'diese unbenannte Schaltfläche',
  'settings.terms.password': 'Passwort',
  'settings.terms.link': 'Link',
  'settings.terms.book': 'Buch',
  'settings.terms.chat': 'chatten',
  'settings.terms.missingSuffix': ' · fehlen',
  'settings.terms.resetsSuffix': ' · wird zurückgesetzt ',
  'settings.metadata.c99cb7557b2bd7cb': 'Daten lesen',
  'settings.metadata.ba35eb1f0c41c920': 'Daten analysieren',
  'settings.metadata.93b5e95f0841a6c1': 'Buch-Highlights',
  'settings.metadata.9b9ab66d2dc6d4e6': 'In einem Buch hervorheben',
  'settings.metadata.836cba1ac2f246a0': 'Eine Hervorhebung ändern',
  'settings.metadata.6bbd1e58f841181f': 'Entfernen Sie eine Hervorhebung',
  'settings.metadata.1d5729de03eb270a': 'Lesezeichen in einem Buch',
  'settings.metadata.d9e8263863cd7c1a': 'Buchregisterkarten',
  'settings.metadata.c8e5758cffa93be0': 'Buchinhalte',
  'settings.metadata.3e6c3299627e72e5': 'Buch lesen',
  'settings.metadata.efb806b8e248de86': 'Buch durchsuchen',
  'settings.metadata.973b70df8c6835ab': 'In einem Buch zeigen',
  'settings.metadata.e1b19c0fcc092bb5': 'Bücher auflisten',
  'settings.metadata.3824a9f4dafe92c6': 'Leinwand',
  'settings.metadata.ca58ee75a82eb866': 'Diagrammdokumente',
  'settings.metadata.1f104d4e483afe57': 'Datei kopieren',
  'settings.metadata.f1eb5a8241e4bf26': 'Datei erstellen',
  'settings.metadata.016fc69b8f33e22e': 'Skript-API-Dokumente',
  'settings.metadata.e3de1e15d36b9e54': 'Skript erstellen',
  'settings.metadata.cf8c8078d8db9550': 'Aktueller Standort',
  'settings.metadata.1e814554ca1b586f': 'Deck lesen',
  'settings.metadata.cf31f39501ec79cc': 'Präsentationen',
  'settings.metadata.07bcab5dd6c2b3ac': 'Deck erstellen',
  'settings.metadata.a34f02e3fb7f55ab': 'Folie bearbeiten',
  'settings.metadata.ee9a26182331bd59': 'Überprüfen Sie den Sitz des Decks',
  'settings.metadata.4c3cd91f9873a96b': 'Offene Präsentation',
  'settings.metadata.3ecb6f7da6cd8b57': 'An Agent delegieren',
  'settings.metadata.e1e5fe2043bd3003': 'Datei löschen',
  'settings.metadata.072bcdf480cf935b': 'Word-Dokument bearbeiten',
  'settings.metadata.3a2860ece5a4ee0b': 'Wort',
  'settings.metadata.d62c5e04e2041963': 'Word-Registerkarten',
  'settings.metadata.fdbd5cb0402f63f0': 'Word-Dokument lesen',
  'settings.metadata.abcfc9b08f141d57': 'Word-Dokument durchsuchen',
  'settings.metadata.8fc231e28ab03931': 'Bild herunterladen',
  'settings.metadata.d5501e84dd2baf5a': 'Datei herunterladen',
  'settings.metadata.c3df84ddf2927d7f': 'Schauen Sie sich die Zeichnung an',
  'settings.metadata.c769c50ec11b66ce': 'Datei bearbeiten',
  'settings.metadata.5597753f9c2ffeb8': 'Bild bearbeiten',
  'settings.metadata.b9aca9af90312aa4': 'Auswahl bearbeiten',
  'settings.metadata.529285444d7e58bf': 'Bewerten Sie JavaScript',
  'settings.metadata.e663529b7a08617b': 'Excalidraw-Zeichnungen migrieren',
  'settings.metadata.014b08ed6d8976df': 'URL abrufen',
  'settings.metadata.d20890b1e4db1fa1': 'Dateien suchen',
  'settings.metadata.a6bd489d95504499': 'Vergessen',
  'settings.metadata.0f44b5601ade4f85': 'Bild generieren',
  'settings.metadata.1606207c55304e06': 'Geokodieren',
  'settings.metadata.bf4c6dda970987a0': 'Orte finden',
  'settings.metadata.06cc7177f48987cc': 'Route bauen',
  'settings.metadata.abce462b78197fc5': 'Ansicht prüfen',
  'settings.metadata.1f728b52096a2eb0': 'Fusselnotizen',
  'settings.metadata.f0c84f13ed58b1d6': 'Beheben Sie Flusenprobleme',
  'settings.metadata.ede087fd8f5ce83a': 'Arbeitsbereich auflisten',
  'settings.metadata.535843b2c2fee0eb': 'Listenverzeichnis',
  'settings.metadata.002cc66337cf3764': 'Datei verschieben/umbenennen',
  'settings.metadata.7ac362063b9f2046': 'Knoten',
  'settings.metadata.1e8d18f62f2d2a2f': 'Datei öffnen',
  'settings.metadata.c0d019c19251efca': 'Dokumente abfragen',
  'settings.metadata.9a72221a27476f3e': 'Fragen',
  'settings.metadata.fb9b615c6b482637': 'Datei lesen',
  'settings.metadata.6562fb21e7fbb468': 'Bild lesen',
  'settings.metadata.7b4a3b51f8248d49': 'Protokolle lesen',
  'settings.metadata.75ce2bbc2da8977a': 'Lesen Sie Backlinks',
  'settings.metadata.a50358c35c21caf0': 'Transaktionen lesen',
  'settings.metadata.6f987478bf258d46': 'Aufgaben lesen',
  'settings.metadata.8096a7bd9a09e11f': 'Erinnern',
  'settings.metadata.95e154398a4bc009': 'Ersetzen',
  'settings.metadata.ddf641f9a5ee4177': 'Schlagen Sie eine Überarbeitung der Antwort vor',
  'settings.metadata.029320ad166c1807': 'Screenshot',
  'settings.metadata.40945d7914b5838d': 'Antwortformular',
  'settings.metadata.17434a9251409137': 'Einstellungen lesen',
  'settings.metadata.7fe866d491ae7890': 'Einstellungen schreiben',
  'settings.metadata.6df1bb18a59ab97d': 'Fähigkeit',
  'settings.metadata.118469284c824130': 'Vorlagendokumente',
  'settings.metadata.f7b314c3f5d5dcea': 'Listenvorlagen',
  'settings.metadata.23febe05ea52c943': 'Vorlage anwenden',
  'settings.metadata.d04fc7d7e19702f8': 'Websuche',
  'settings.metadata.d78cd87c20261047': 'Datei schreiben',
  'settings.metadata.ff4e3889f363a511': 'Schreiben Sie Arbeitsmappenzellen',
  'settings.metadata.48d53635551c8fd4': 'Excel',
  'settings.metadata.9a8eb492fd32afbe': 'Arbeitsheftblätter',
  'settings.metadata.51feedc6468c9521': 'Arbeitsmappenbereich lesen',
  'settings.metadata.6b11523da566fd08': 'Arbeitsmappe durchsuchen',
  'settings.metadata.8463eb4799ceda94': 'ZIP erstellen',
  'settings.metadata.ee52497854a67e54': 'GitHub-Datei lesen',
  'settings.metadata.7ba6f2c8e75022bd': 'GitHub-Commits',
  'settings.metadata.c97212ae47ab4694': 'Grep-Code in einer Version',
  'settings.metadata.eff04b0872a1b825': 'GitHub-Element lesen',
  'settings.metadata.9632f6701a8ca357': 'Pull-Request-Dateien',
  'settings.metadata.ff48a92c96b73fa8': 'Durchsuchen Sie GitHub',
  'settings.metadata.f5db8240ba9c07c2': 'GitHub-Registerkarten',
  'settings.metadata.0a876c393a858219': 'Auf der Registerkarte GitHub anzeigen',
  'settings.metadata.47659c3dccc86dc6': 'Datei lesen',
  'settings.metadata.abc7e9892806b047': 'Dateien',
  'settings.metadata.9608dd142d9b10d7': 'Datei bearbeiten',
  'settings.metadata.997357233881bfb9': 'Datei schreiben',
  'settings.metadata.6990d3217b7749c8': 'Datei erstellen',
  'settings.metadata.28e18dc9db382d81': 'Datei löschen',
  'settings.metadata.f83e6d79cd9c3e10': 'Datei verschieben',
  'settings.metadata.b60f1c7ad15c2b04': 'Datei kopieren',
  'settings.metadata.930a81591b83ad25': 'Listenverzeichnis',
  'settings.metadata.15d12bc10296dc2d': 'Dateien finden',
  'settings.metadata.87bb59ba2f92f2a5': 'Arbeitsplatz',
  'settings.metadata.d515d2ee195fa943': 'Bild lesen',
  'settings.metadata.4190c0c7ec727064': 'Datei öffnen',
  'settings.metadata.693ba7f5f3d9f77d': 'App-Ansicht',
  'settings.metadata.dc37f2f4529c4136': 'Ansicht prüfen',
  'settings.metadata.7711faa74a10416c': 'Websuche',
  'settings.metadata.2975104784a401e3': 'Web',
  'settings.metadata.3ac575dcce244f93': 'Bild herunterladen',
  'settings.metadata.9de4149fb9716cfc': 'Datei herunterladen',
  'settings.metadata.f911e414cf6bdfc5': 'GitHub',
  'settings.metadata.f7f0f6218e3ab3ce': 'Ausgabe oder PR lesen',
  'settings.metadata.046ceaf4f065a500': 'PR-Dateien',
  'settings.metadata.d09648c6058a4c84': 'Commits',
  'settings.metadata.49c266baaaa70981': 'Suchen',
  'settings.metadata.b2cfbf5af10d5b5d': 'In einer Registerkarte anzeigen',
  'settings.metadata.9da7f76bc81d2f4e': 'Bücher',
  'settings.metadata.119e66d117ae8f0c': 'Karten',
  'settings.metadata.1c9c87eec07e453b': 'Bild generieren',
  'settings.metadata.be7e2f20129365c2': 'Bilder',
  'settings.metadata.d9d12b04b3831c32': 'Bild bearbeiten',
  'settings.metadata.6bea010c8fb418a4': 'Eval JS',
  'settings.metadata.8fdd2ee8475e29bc': 'Grundlagen',
  'settings.metadata.760ed96061ace03e': 'Delegieren',
  'settings.metadata.a6d910ba93b7f894': 'Delegation',
  'settings.metadata.c3963aedaac6c83c': 'Erinnerung',
  'settings.metadata.2e19427030d9d43c': 'Diagrammdokumente',
  'settings.metadata.7af023c43013b9a5': 'Dokumente',
  'settings.metadata.5afdd3f5b60d4d59': 'Vorlagendokumente',
  'settings.metadata.9d45317393ff2163': 'Protokolle lesen',
  'settings.metadata.19b88504fa831ce1': 'Notizendaten',
  'settings.metadata.8c87f5ea162d2e65': 'Lesen Sie Backlinks',
  'settings.metadata.692a437039f64732': 'Transaktionen lesen',
  'settings.metadata.b696d75511dc16f2': 'Finanzen',
  'settings.metadata.d340a6c01b6f5fee': 'Aufgaben lesen',
  'settings.metadata.b3a60e61a5233d05': 'Aufgaben',
  'settings.metadata.a249b2df7cba7a38': 'Listenvorlagen',
  'settings.metadata.56b564b75c7fdb48': 'Vorlagen',
  'settings.metadata.a0859ef85c0a0934': 'Vorlage anwenden',
  'settings.metadata.6dc2a1098225593e': 'Skript-API-Dokumente',
  'settings.metadata.74a883a037bc227f': 'Einstellungen',
  'settings.metadata.ea59135c1811dd4d': 'Skript erstellen',
  'settings.metadata.8d0e6b4ab60543cf': 'Skripte',
  'settings.metadata.7000d0dc57ecf4be': 'Ergebnis lesen',
  'settings.metadata.d9e66d2ce531344c': 'Knotendateien',
  'settings.metadata.e93372533f323b2f': 'Knoten',
  'settings.metadata.6ded9685b4a797e6': 'Dateien lesen und suchen',
  'settings.metadata.562123f8976fe819': 'Dateien bearbeiten',
  'settings.metadata.aec2f93d67b7c4c5': 'Arbeitsbäume',
  'settings.metadata.e90a0f8d49e203ea': 'Arbeit an einen Knoten-Agenten übergeben',
  'settings.metadata.b907a91b588b818c': 'Der Debugger wird ausgeführt',
  'settings.metadata.befc6e918047c85b': 'Ihre Nachrichten',
  'settings.metadata.f39b199601422405': 'Die Antworten des Agenten',
  'settings.metadata.b6c1d862f9f75ec3': 'Beide',
  'settings.metadata.0ca9f9fe82be9456': 'Nur Entwurf',
  'settings.metadata.65c3ce1551b7fdc4': 'Letzte 4 Nachrichten',
  'settings.metadata.87e460223959d06f': 'Letzte 10 Nachrichten',
  'settings.metadata.27ba0224f1937dcd': 'Ganzes Gespräch',
  'settings.metadata.abc9eb2fc4a07abf':
    'An diese Verbindung gesendeter Benutzeragent. Empty behält die Standardeinstellung bei. Beim mobilen Streaming wird dies möglicherweise ignoriert.',
  'settings.metadata.fcc01b1454819dec': 'Folgt dem Thema',
  'settings.metadata.17ed08435ee39aec': 'Freiheit',
  'settings.metadata.e4378e9c551f7f9c': 'Hell',
  'settings.metadata.437b56da751ee02a': 'Positron, ruhig',
  'settings.metadata.60acc53f13a5d1bf': 'Dunkel',
  'settings.metadata.2620b9ac0d72c634': 'Fjord, dunkelblau',
  'settings.metadata.3d5b0ed33cbfc204': 'Eigener Stil nach URL',
  'settings.metadata.a57b3a3a34957437': 'Hat Eigenschaften',
  'settings.metadata.fdd539aca215e393':
    'Die Notiz beginnt mit einem Eigenschaftenblock (--- in der ersten Zeile).',
  'settings.metadata.a9aeaf057d72407f': 'Eigenschaften können gelesen werden',
  'settings.metadata.048c4415ef41ad0a': 'Erforderliche Eigenschaften',
  'settings.metadata.ae43692b2a310b8e': 'Eigenschaften',
  'settings.metadata.079647a8b86e4378':
    'Durch Kommas getrennt. „name: default“, damit der Fix ihn ausfüllt.',
  'settings.metadata.3c0c64e0fd626bca': 'Hat einen Notiztyp',
  'settings.metadata.a628c83f6a069d90':
    'Die Notiz gibt in ihrer Typeigenschaft an, um was es sich handelt: Aufgabe, Person, Besprechung. Bei einer Liste von Typen muss der Wert einer davon sein.',
  'settings.metadata.40040cb181f7f0ee': 'Eigenschaft',
  'settings.metadata.853362b96c0c33a4': 'Wo der Typ geschrieben wird.',
  'settings.metadata.2b04790e11e9360e': 'Zulässige Typen',
  'settings.metadata.fc2ba0dd4e23cdd0': 'Durch Kommas getrennt. Leer lässt jeden Wert durch.',
  'settings.metadata.21b111cbfe6e8fca': 'Standard',
  'settings.metadata.0482acc3c6913a87':
    'Vom Fix in eine Notiz ohne Typ geschrieben. Leer: Nichts ist fixiert.',
  'settings.metadata.147e6bba43829675': 'Keine Tags',
  'settings.metadata.c03ca2fe828c431e':
    'Für einen Vault, der keine Tags verwendet: Die Tags-Eigenschaft wird durch den Fix entfernt; Ein #Tag im Text wird als manuell behandelt angezeigt.',
  'settings.metadata.d4743e63e45dde22': 'Tags im Text',
  'settings.metadata.587ccd181c91d2a8': 'Finden Sie auch im Text geschriebene #Tags.',
  'settings.metadata.fdca3c91c0898bd4': 'Unerwünschte Eigenschaften',
  'settings.metadata.a4ef39b33278f6ef':
    'Keine der aufgeführten Eigenschaften ist vorhanden. Der Fix entfernt sie.',
  'settings.metadata.0a26d2a3c07531d9': 'Durch Kommas getrennt.',
  'settings.metadata.29a015b0a78abcc6': 'Leerzeile nach den Eigenschaften',
  'settings.metadata.56bae77505677e3c':
    'Zwischen den Eigenschaften und dem Text steht genau eine Leerzeile.',
  'settings.metadata.6ca1bd19ad8e5df4': 'Keine Überschrift der ersten Ebene',
  'settings.metadata.a5b697a0a2aa9674':
    'Der Dateiname ist der Titel, daher hat der Text keine #-Überschrift. Der Fix entfernt eine, die den Namen wiederholt, und macht alle anderen zu einer ##-Überschrift.',
  'settings.metadata.93df69cc2eaf6ff1': 'Daten als Datumsangaben geschrieben',
  'settings.metadata.7ef1f2a6ca083e8a':
    'Die aufgelisteten Eigenschaften enthalten ein Datum im Format YYYY-MM-DD. Der Fix schreibt 2026-9-5, 05.09.2026 und [[2026-09-05]] neu.',
  'settings.metadata.9024c197d84940e4': 'Links',
  'settings.metadata.1d80ae7836ce9902': 'Kopfzeilen-Schaltflächen',
  'settings.metadata.ad1fb9ec0cb3c7a4': 'Automatisierungen',
  'settings.metadata.c20c37564e3f3409': 'Tagebücher',
  'settings.metadata.e95944e1c3c81e4c': 'GitHub-Verbindungen',
  'settings.CalendarsSettings.value_h_ago.d5aa4bb8': 'Vor {value0} h',
  'settings.CalendarsSettings.value_d_ago.0f70078c': '{value0} vor d',
  'settings.CalendarsSettings.value_from_value_kept.419ae64a': '{value0} von {value1}, behalten',
  'settings.CalendarsSettings.value_read_value.6e58c8af': '{value0}, abgerufen {value1}',
  'settings.GithubSettings.account_not_checked.d2a6562d': 'Konto nicht überprüft',
  'settings.GithubSettings.token_expires_within_seven_days.1b81c28c':
    'Der Token läuft innerhalb von sieben Tagen ab',
  'settings.LinterSettings.in_value.b63d3a91': 'in {value0}',
  'settings.LinterSettings.where_value_value.e534e0d0': 'wobei {value0}{value1}',
  'settings.LinterSettings.script_value.c5efe1d1': ' Skript: {value0}.',
  'settings.LinterSettings.only_value.e2625151': ' Nur {value0}.',

  'settings.SecretsListModal.value_set.f4c8f3b4': '{value0}-Satz',
  'settings.SecretsListModal.value_synced.1785a4d0': '{value0} synchronisiert',
  'settings.TransferSettings.value_of_value.ca6c5e5f': '{value0} oder {value1}',
  'settings.TransferSettings.value_selected.975acbfe': '{value0} ausgewählt',

  'settings.ai.interceptorList.matching_value.b4ca1a61': 'passend zu {value0}',

  'settings.transfer.TransferPreviewModal.value_value_value_characters.3394d986':
    '{value0}…{value1} ({value2}-Zeichen)',
  'settings.transfer.TransferScanModal.value_at_value.92c9c89a': '{value0} bis {value1}',
  'settings.count.item': { one: '{count} Eintrag', other: '{count} Einträge' },
  'settings.count.key': { one: '{count} Schlüssel', other: '{count} Schlüssel' },
  'settings.count.file': { one: '{count} Datei', other: '{count} Dateien' },
  'settings.count.code': { one: '{count} Code', other: '{count} Codes' },
  'settings.count.prompt': { one: '{count} Prompt', other: '{count} Prompts' },
  'settings.count.scopeEntry': {
    one: '{count} Bereichseintrag',
    other: '{count} Bereichseinträge',
  },
  'settings.count.event': { one: '{count} Ereignis', other: '{count} Ereignisse' },
  'settings.count.model': { one: '{count} Modell', other: '{count} Modelle' },
  'settings.count.button': { one: '{count} Schaltfläche', other: '{count} Schaltflächen' },
  'settings.count.tool': { one: '{count} Werkzeug', other: '{count} Werkzeuge' },

  'settings.parts.fa11c9afc868fc1e': ' · setzt {value0} zurück',

  'settings.parts.520a5d3ab1d92888': ' ist {value0}',
  'settings.parts.9edb143e79ddd491': '(unbenannt)',

  'settings.parts.951aaf14e2b23dff':
    ' Sein {value0}-Header fügt es immer noch in dieses Menü ein; Entfernen Sie diese Zeile aus dem Skript, um sie auszublenden.',
  'settings.parts.195dc73d2db93bf8': 'Dies wird entfernt',
  'settings.parts.778541341fcda9aa': 'Diese werden entfernt',

  'settings.metadata.86ed522daec49399': 'KI-General',
  'settings.metadata.8748f23993a86245': 'Spracheingabe',
  'settings.metadata.2c4aed90f68a9826': 'KI-Anbieter',
  'settings.metadata.d110fe793fa72de1': 'Bildanbieter',
  'settings.metadata.279b44d2ab4b40c0': 'Agenten',
  'settings.metadata.22a7559f09bf8f82': 'MCP-Server',
  'settings.metadata.e5f4cb8707719fbd': 'Gespeicherte Schlüssel',
  'settings.metadata.5f2e66e6539797d0': 'Aufforderungen',
  'settings.metadata.f46ee86a068c4c22': 'Skripteinstellungen',
  'settings.metadata.66d0f523a379b2de': 'Fähigkeiten',
  'settings.metadata.f6a1fdbcca54b2f8': 'Schnelle Notizen',
  'settings.metadata.71fea45d263e0906': 'Aufgabe abgeschlossen',
  'settings.metadata.968a994a15bd991a': 'Aufgabe erneut geöffnet',
  'settings.metadata.a3e3e968c40e5951': 'Aufgabe erstellt',
  'settings.metadata.ba3078bec8c60a69': 'Aufgabe geändert',
  'settings.metadata.98acf0d427bd63b5': 'Aufgabendatum geändert',
  'settings.metadata.d41c129fb8fdf353': 'Notiz erstellt',
  'settings.metadata.e6a78804e128667f': 'Hinweis geändert',
  'settings.metadata.4a33279d562ffb24': 'Notiz umbenannt',
  'settings.metadata.81f7d1888d5a03be': 'Notiz gelöscht',
  'commands.external-file-evict': 'Nur auf dem Server speichern',
  'commands.external-file-pin': 'Auf diesem Gerät behalten',
  'commands.external-file-hydrate': 'Auf dieses Gerät herunterladen',
  'settings.ordinal.first': 'zuerst',
  'settings.ordinal.second': 'als Zweites',
  'settings.ordinal.third': 'als Drittes',
  'settings.ordinal.number': '{count}.',
  'settings.terms.script': 'Skript',
  'settings.CalendarsSettings.new_link.f9e84245': 'Neuer Link...',
  'settings.CalendarsSettings.save_the_link.7b19a248': 'Speichern Sie den Link',
  'settings.CalendarsSettings.the_link.f0fb533a': 'Der Link',
  'settings.CalendarsSettings.new_password.1abebe85': 'Neues Passwort...',
  'settings.CalendarsSettings.save_the_password.acd9c185': 'Speichern Sie das Passwort',
  'settings.CalendarsSettings.the_password.3f4e5252': 'Das Passwort',
  'settings.FinanceSettings.new_token.564f08bc': 'Neuer Token...',
  'settings.FinanceSettings.save_the_token.8326f085': 'Speichern Sie den Token',
  'settings.FinanceSettings.the_token.d22bffce': 'Der Token',
  'settings.GithubConnectionEditor.new_token.564f08bc': 'Neuer Token...',
  'settings.GithubConnectionEditor.use_this_token_when_saving.7cc96882':
    'Verwenden Sie dieses Token beim Speichern der Verbindung',
  'settings.GithubConnectionEditor.the_token.d22bffce': 'Der Token',
  'settings.GithubSettings.new_token.564f08bc': 'Neuer Token...',
  'settings.GithubSettings.save_the_notifications_token.d4a25b6f':
    'Speichern Sie das Benachrichtigungstoken',
  'settings.GithubSettings.the_notifications_token.266dfc35': 'Das Benachrichtigungstoken',
  'settings.ai.InterceptorList.runs_value.fe51da79': 'Läuft {value0}',
  'settings.ai.McpServerModal.new_token.564f08bc': 'Neuer Token...',
  'settings.ai.McpServerModal.save_the_token.8326f085': 'Speichern Sie den Token',
  'settings.ai.McpServerModal.the_token.d22bffce': 'Der Token',
  'settings.transfer.TransferPreviewModal.what_goes.39dde11f': 'was geht',
  'settings.GithubSettings.delete_this_connection_and_forget.1a526c31':
    'Löschen Sie diese Verbindung und vergessen Sie ihr lokales Token',
  'settings.GithubSettings.forget.a6bd489d': 'Vergessen',
  'settings.GithubSettings.remove_the_notifications_token_from.d1453607':
    'Entfernen Sie das Benachrichtigungstoken aus dem Schlüsselbund',
  'settings.ImageModelEditModal.delete_value.8782b778': 'Löschen Sie {value0}',
  'settings.ModelEditModal.delete_value.8782b778': 'Löschen Sie {value0}',
  'settings.QuickButtonSettings.take_out.a7fc33e3': 'Mitnahme',
  'settings.QuickButtonSettings.take_value_out_of_the.8b01b719': 'Nehmen Sie {value0} aus dem Menü',
  'settings.SecretsListModal.put_every_key_on_the.8118968c':
    'Legen Sie jeden Schlüssel als Klartext in die Zwischenablage',
  'settings.ai.AgentsSettings.delete_value.8782b778': 'Löschen Sie {value0}',
  'settings.ai.McpServerModal.delete_value.8782b778': 'Löschen Sie {value0}',
  'settings.ai.McpSettings.delete_value.8782b778': 'Löschen Sie {value0}',
  'settings.scripts.AutomationsEditor.delete_value.8782b778': 'Löschen Sie {value0}',
  'settings.scripts.HeaderButtonsEditor.delete_value.8782b778': 'Löschen Sie {value0}',
  'settings.scripts.SelectionScriptsSettings.take_off.c2ed15e8': 'Abheben',
  'settings.scripts.SelectionScriptsSettings.take_value_off_the_menu.83b6400c':
    'Entfernen Sie {value0} aus dem Menü',
  'settings.startup.computers': 'Computern',
  'settings.transfer.itemsToApply': {
    one: '{count} Eintrag zum Anwenden',
    other: '{count} Einträge zum Anwenden',
  },
  'settings.calendar.found': {
    one: '{count} Kalender gefunden.',
    other: '{count} Kalender gefunden.',
  },
  'settings.mcp.fetched': '{tools}, abgerufen {when}',
  'settings.sentence.2de766f4c2331579':
    'Die gespeicherten Werte werden in die Anfrage eingesetzt und hier niemals angezeigt. Die Erlaubnis merkt sich diese Adresse für {value0} auf diesem Gerät, sodass hier nicht erneut gefragt wird. Andere Geräte fragen weiterhin.',
  'settings.sentence.c93c0ada01c57a48': 'Verfügbare Modelle: {value0}',
  'settings.sentence.cdb07f66a428a0ed': 'Nicht gespeichert: {value0}',
  'settings.sentence.4f7ec121b15ac5e4': 'Wird nirgends angezeigt · {value0}',
  'settings.sentence.7caf85c3282be170': 'noch zu finden: {value0}',
  'settings.sentence.2d2a1f1b3800ab01': 'Erstellt {value0}. Wähle aus, was du behalten möchtest.',
  'settings.secrets.removeNamed':
    '{name} entfernen? Alle fetch-Aufrufe, die diesen Namen verwenden, funktionieren dann nicht mehr, und der gespeicherte Wert wird aus dem Schlüsselbund entfernt.',
  'settings.mcp.headersDescription':
    'Ein Eintrag pro Zeile im Format Name: value. Verwende für ein Geheimnis {example}, einen Schlüssel unter KI → Allgemein → Gespeicherte Schlüssel, damit er nicht in der Einstellungsdatei steht.',
  'settings.sync.presentation.e159b06187d369a0': 'Angehalten',
  'settings.sync.presentation.857a66dd7a6dfe32': ' · {completed} von {total}',
  'settings.sync.presentation.265ec42c10960f4e': ' · Braucht Aufmerksamkeit',
  'settings.sync.presentation.a3e3205316b64477': 'Server nicht verfügbar, erneuter Versuch',
  'settings.sync.presentation.c70acece009d71d9': '{completed} von {total}-Dateien',
  'settings.sync.presentation.5c8b9e1ce0a2bc31': 'Synchronisierung',
  'settings.sync.presentation.0d60f3335d21fa2b': {
    one: '{count} Konfliktkopie',
    other: '{count} Konfliktkopien',
  },
  'settings.sync.presentation.96f22a9119067884': {
    one: '{count} Datei nicht gesendet',
    other: '{count} Dateien nicht gesendet',
  },
  'settings.sync.presentation.9e1b70e3f4abbe8e': 'Synchronisiert {when}',
  'settings.sync.presentation.c10529851ad89bd3': 'Noch nicht synchronisiert',
  'settings.sync.presentation.2512ef45cc838dc2':
    'Synchronisierungswiederherstellung erforderlich. Dateien und Verbindung wurden beibehalten.',
  'settings.sync.presentation.fbcbda4833c5c0b7':
    'Die Serverantwort wurde abgebrochen, bevor sie beendet war. Versuchen Sie erneut, die Synchronisierung durchzuführen.',
  'settings.sync.presentation.fd2175ceceb4c39f':
    'Dieses Token ist beschädigt oder unvollständig. Fügen Sie den gesamten Token erneut ein.',
  'settings.sync.presentation.93754bdbbee0e2c4':
    'Der Server ist nicht erreichbar. Überprüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
  'settings.sync.presentation.f58e7749a37e75de':
    'Der Zugang ist geschlossen. Fordern Sie einen neuen Token an.',
  'settings.sync.presentation.c3dbee340e1c8ed3':
    'Die Gruppe befindet sich noch in der Vorbereitung. Der Dateiaustausch wurde nicht gestartet.',
  'settings.sync.presentation.753e9b392eca8228':
    'Der Server ist voll. Ihre nicht gesendeten Dateien bleiben auf diesem Gerät.',
  'settings.sync.presentation.7584f523308d5d6d':
    'Diese Datei ist zu groß für den Server. Es bleibt auf diesem Gerät.',
  'settings.sync.presentation.9036c8e0dc30cc74':
    'Der Server ist voll. Die Datei bleibt hier und kann gesendet werden, sobald Platz verfügbar ist.',
  'settings.sync.presentation.bbb4cbf36ea63cbd': 'Diese Verbindung lässt diese Aktion nicht zu.',
  'settings.sync.presentation.110ec9023ae84ee7':
    'Der Serverantwort konnte nicht vertraut werden; Synchronisierung gestoppt. Lokale Dateien wurden aufbewahrt.',
  'settings.sync.presentation.9259b3f2e2f72c08':
    'Dieser Ordner oder diese Gruppe ist nicht mehr verfügbar.',
  'settings.sync.presentation.0303e18246708180': 'Nicht verbunden',
  'settings.sync.presentation.fe7c4c6f414c4083': 'Gruppe außerhalb dieser Verbindung',
  'settings.sync.presentation.97c769d2eaf4ca1c': 'Ordner außerhalb dieser Verbindung',
  'settings.sync.presentation.f56643958aeae61b': 'Gruppe: {name}',
  'settings.sync.presentation.7dd20272337b469c': 'Versionsverlauf öffnen · {name}',
  'settings.sync.presentation.cb44fe2561afccff': 'Ganzes Gewölbe',
  'settings.sync.presentation.5c802e6401aca4d2': 'Ordner: {path}',
  'settings.sync.presentation.5fa7aac5375c5815': 'Bereit',
  'settings.sync.presentation.b0f398a57ea3ca38': 'Server nicht verfügbar',
  'settings.sync.presentation.c1ebc7817870e5be': 'Braucht Aufmerksamkeit',
  'settings.sync.presentation.9b7e4ca97f057cbc': 'Benötigt einen Token',
  'settings.sync.presentation.d403c686f6a10480': 'Verbinden',
  'settings.sync.presentation.58b1510f8abae1f2': 'Zugriff nicht verfügbar',
  'settings.sync.presentation.5514efec066cba3e': 'Zugriff aktualisieren',
  'settings.sync.presentation.ae9cea791e9bc09c': 'Auf dem Server gelöscht',
  'settings.sync.presentation.013c681e65af3ea9':
    'Der Server wurde aus einem Backup wiederhergestellt – Dateien wurden überprüft',
  'settings.sync.presentation.43edbd9fcb4f94a4': 'Überprüfen wiederhergestellter Dateien',
  'settings.sync.presentation.ceb8c1fa2307911c':
    'Freigegebener Ordner auf dem Server umbenannt: {from} → {to}; Synchronisierung gestoppt',
  'settings.sync.presentation.d0be29aeb27cd431':
    'Ordner nach {path} verschoben; Synchronisierung gestoppt',
  'settings.sync.presentation.b1241ef8763e3062': 'Ordner ist weg; Synchronisierung gestoppt',
  'settings.sync.presentation.41920972f6474234':
    'Serverordner oder -gruppe nicht verfügbar; lokale Dateien bleiben erhalten',
  'settings.sync.presentation.54f2a3375e5dd52d':
    'Zugang geschlossen; lokale Dateien bleiben erhalten',
  'settings.sync.presentation.fc135b7008d458b4': '{stage}… {completed}/{total}{attention}',
  'settings.sync.presentation.a90a62a0bc219ded': 'Überprüfung des Vaults… {completed}/{total}',
  'settings.sync.presentation.ec5aa287907706b6': 'Vergleich der Dateien {completed}/{total}',
  'settings.sync.presentation.63ec9d9ac51fa025': 'Serverantwort unterbrochen',
  'settings.sync.presentation.27a38f81837d5e05': { one: '{count} Ordner', other: '{count} Ordner' },
  'settings.sync.presentation.63352fdc2cd6bbbf': { one: '{count} Datei', other: '{count} Dateien' },
  'settings.sync.presentation.7c907ab73773e102': {
    one: '{completed} von mindestens {count} Ordner',
    other: '{completed} von mindestens {count} Ordnern',
  },
  'settings.sync.presentation.7438a7b7fe1ef4bb': {
    one: '{completed} von mindestens {count} Datei',
    other: '{completed} von mindestens {count} Dateien',
  },
  'settings.sync.presentation.20a1cd5ccd38098a': {
    one: '{completed} von {count} Ordner',
    other: '{completed} von {count} Ordnern',
  },
  'settings.sync.presentation.9a139983ae1196bc': {
    one: '{completed} von {count} Datei',
    other: '{completed} von {count} Dateien',
  },
  'settings.sync.presentation.608ec17db8dff1ba': ' · {bytes} {unit} übertragen',
  'settings.sync.presentation.4336b4a9e578c6ce': ' · {bytes} oder {total} {unit}',
  'settings.sync.presentation.4a9aad432626cdc4': ' · Weniger als 1 Minute übrig',
  'settings.sync.presentation.c42b56810e72964d': ' · Ungefähr {minutes} Minuten übrig',
  'settings.sync.presentation.11a6767d5674c7e4': 'Fertig',
  'settings.sync.presentation.88fe20810f158d65':
    'Gespeichert; Die lokale Bereinigung steht noch aus',
  'settings.sync.presentation.2011abd185905fbc':
    'Auf diesem Gerät gespeichert. Lassen Sie zunächst die Entfernung zu',
  'settings.sync.presentation.cf6ecbdf93a4cbd4':
    'In einem Editor öffnen oder gerade verwendet. Schließen Sie es und versuchen Sie es erneut',
  'settings.sync.presentation.ba084f0f0f3f2d81':
    'Nicht gesendete Änderungen bleiben auf diesem Gerät. Zuerst synchronisieren',
  'settings.sync.presentation.1450568cbc3989de': 'Die Version hat sich geändert. Nochmals Vorschau',
  'settings.sync.presentation.bfad3113a6082ae4':
    'Die Datei entspricht nicht mehr dieser Regel. Nochmals Vorschau',
  'settings.sync.presentation.c257dbbbf04763fe': 'Offline nicht verfügbar',
  'settings.sync.presentation.8d4a166ba65e8cac': 'Diese Datei ist auf dem Server nicht verfügbar',
  'settings.sync.presentation.6d48d4d60ba51073':
    'Diese Version ist noch nicht auf dem Server. Zuerst synchronisieren; die Datei bleibt hier',
  'settings.sync.presentation.3b110b3b8a0affae':
    'Die Synchronisierung hat diese Datei abgelehnt. Lösen Sie zuerst den Synchronisierungsstatus auf. es bleibt hier',
  'settings.sync.presentation.3123f064bd232e76': 'Dieser Server unterstützt kein Offloading',
  'settings.sync.presentation.4b9c0b68c8009214':
    'Dieser Gerätespeicher unterstützt kein sicheres Auslagern',
  'settings.sync.presentation.67e22f73b49e31ce':
    'Nicht genügend Speicherplatz zum sicheren Herunterladen',
  'settings.sync.presentation.8925063fc75cd16d':
    'Eine andere Datei belegt das Ziel. Beide Akten wurden aufbewahrt',
  'settings.sync.presentation.e2f0da1e1e6f9fdb': 'Diese Datei kann nicht ausgelagert werden',
  'settings.sync.presentation.a88ffdf4720bfc95': 'Bereits nur auf dem Server gespeichert',
  'settings.sync.presentation.2cfe6717c6efa346': 'Ausführbare Dateien bleiben auf diesem Gerät',
  'settings.sync.presentation.f3912c33c1e7e094':
    'Für diese Verbindung ist vor dem Auslagern eine Zugriffsüberprüfung erforderlich',
  'settings.sync.presentation.4d77018e2e63b109':
    'Eine Synchronisierungswiederherstellung ist erforderlich. Die Datei bleibt hier',
  'settings.sync.presentation.54272d517782b52a': 'Überprüfung des Vaults',
  'settings.sync.presentation.6a534e2d9b68ac18': 'Dateien vergleichen',
  'settings.sync.presentation.committing': 'Änderungen bestätigen',
  'settings.sync.presentation.0b398fdee3be023a': 'Ordner vorbereiten',
  'settings.sync.presentation.f8cc26b4a73ec961': 'Empfangen von Dateien',
  'settings.sync.presentation.37b345555d7ea6c1': 'Herunterladen',
  'settings.sync.presentation.8b898ca34ce71371': 'Hochladen',
  'settings.sync.presentation.d9351cf978606788': 'Lesen des Tokens',
  'settings.sync.presentation.a11acbbb551a6ddc': 'Überprüfung des Servers',
  'settings.sync.presentation.dc4552a7de803f44': 'Öffnen des Ordners',
  'settings.sync.presentation.dfe7d0dd9f350fd8': 'Vorbereiten der Verbindung',
  'settings.sync.presentation.be0e89cc19c4cf38':
    'Auf dem Server gelöscht. Alle Dateien bleiben auf diesem Gerät.',
  'settings.sync.codeSource': 'Code von {host} · {when}',
  'settings.sync.privateQuestion': 'Private Datei · mit {scope} teilen?',
  'settings.components.AiScopeEditor.full_vault_access.e59147d6': 'Voller Zugriff auf den Vault',
  'settings.components.AiScopeEditor.the_agent_may_read_and.7215c412':
    'Der Agent kann jede Datei im Vault lesen und ändern.',
  'settings.components.AiScopeEditor.the_agent_sees_only_what.dd8d63d0':
    'Der Agent sieht nur das, was unten aufgeführt ist.',
  'settings.components.AiScopeEditor.counting_group_members.6cf29d46': 'Gruppenmitglieder zählen',
  'settings.components.AiScopeEditor.what_the_agent_can_reach.9e1cc9cb':
    'Was der Agent erreichen kann',
  'settings.components.AiScopeEditor.remove_value_from_scope.5306ceeb':
    'Entfernen Sie {value0} aus dem Bereich',
  'settings.components.AiScopeEditor.loading_group_members.64b5fef7':
    'Gruppenmitglieder werden geladen',
  'settings.components.AiScopeEditor.show_more.f5c9bd13': 'Mehr anzeigen',
  'settings.components.AiScopeEditor.nothing_yet_the_agent_sees.83352aaa':
    'Noch nichts: Der Agent sieht keine Dateien.',
  'settings.components.AiScopeEditor.add_to_what_the_agent.ba420695':
    'Fügen Sie hinzu, was der Agent erreichen kann',
  'settings.components.AiScopeEditor.add_a_note_folder_group.0a52ba05':
    'Fügen Sie eine Notiz, einen Ordner, eine Gruppe oder ein Muster hinzu …',
  'settings.components.AiScopeEditor.could_not_count_group_members.58d42889':
    'Gruppenmitglieder konnten nicht gezählt werden. Öffnen Sie Access erneut, um es erneut zu versuchen.',
  'settings.components.AiScopeEditor.could_not_load_group_members.9a565298':
    'Gruppenmitglieder konnten nicht geladen werden. Schließen Sie die Gruppe und öffnen Sie sie erneut, um es erneut zu versuchen.',
  'settings.components.ToolModesEditor.show_core_tools.bea400e8': 'Kernwerkzeuge anzeigen',
  'settings.components.ToolModesEditor.show_always_on_tools_that.841d8a03':
    'Zeigen Sie immer aktive Tools an, die nicht deaktiviert werden können.',
  'settings.components.ToolModesEditor.all_tools.81c151f9': 'Alle Werkzeuge',
  'settings.components.ToolModesEditor.sets_every_tool_below_at.54f57dce':
    'Legt alle unten aufgeführten Werkzeuge gleichzeitig fest. Jeder kann danach noch einzeln geändert werden.',
  'settings.components.ToolModesEditor.set_every_tool_to_value.5861bfee':
    'Stellen Sie jedes Werkzeug auf {value0} ein',
  'settings.components.ToolModesEditor.always_open.67b6ffc1': 'Immer geöffnet',
  'settings.components.ToolModesEditor.when_value_is_open.37a2f90a': 'Wenn {value0} geöffnet ist',
  'settings.components.ToolModesEditor.change_what_value_is_said.5508c12f':
    'Ändern Sie, wofür {value0} gedacht ist',
  'settings.components.ToolModesEditor.reset_to_default.bc5b45ae': 'Auf Standard zurücksetzen',
  'settings.components.ToolModesEditor.use_the_section_s_own.e02f836f':
    'Verwenden Sie erneut die eigene Beschreibung des Abschnitts',
  'settings.components.ToolModesEditor.done.11a6767d': 'Fertig',
  'settings.components.ToolModesEditor.value_tools.a2c9c9bb': 'Werkzeuge: {value0}',
  'settings.components.ToolModesEditor.hide_its_tools.52db5aef': 'Verstecke seine Werkzeuge',
  'settings.components.ToolModesEditor.show_its_tools_each_with.3c99bb30':
    'Zeigen Sie seine Werkzeuge, jedes mit seiner eigenen Auswahl',
  'settings.components.ToolModesEditor.all_in_this_section.3d4eba9d': 'Alles in diesem Abschnitt',
  'settings.components.ToolModesEditor.set_every_tool_in_value.82231b6a':
    'Stellen Sie jedes Werkzeug in {value0} auf {value1} ein',
  'settings.components.ToolModesEditor.use_this_server.8eb48b42': 'Benutzen Sie diesen Server',
  'settings.components.ToolModesEditor.gives_every_tool_of_this.daa3c48e':
    'Gibt jedem Tool dieses Servers eine Anfrage, bevor es ausgeführt wird.',
  'settings.components.ToolModesEditor.always_on.f017032a': 'immer an',
  'settings.components.ToolModesEditor.use_the_tool_s_own.520c244d':
    'Verwenden Sie erneut die eigene Beschreibung des Tools',
  'settings.components.ToolModesEditor.on_request.be820103': 'Auf Anfrage',
  'settings.components.ToolModesEditor.off.ca7981b4': 'Aus',
  'settings.components.ToolModesEditor.ask.b8c209cd': 'Nachfragen',
  'settings.components.ToolModesEditor.auto.02862497': 'Auto',

  'settings.metadata.354509b1c9ccade8':
    'Dateien, Suche und Git-Verlauf für Ordner, die dieser Chat auf einem Knoten angegeben hat. Was erreicht werden kann, wird pro Chat im Knotenzugriff festgelegt.',
  'settings.metadata.18a90996c684b6b3':
    'Dateien öffnen, auflisten und durchsuchen; Status, Unterschiede und Verlauf in Git.',
  'settings.metadata.e0b89715205e4ef5':
    'Dateien erstellen, ändern, verschieben, kopieren und löschen.',
  'settings.metadata.d442700773269772':
    'Listen Sie die Arbeitsbäume eines Ordners auf und wechseln Sie zwischen ihnen.',
  'settings.metadata.29a212809fa10bf3':
    'Geben Sie einem Codierungsagenten auf einem Knoten eine Aufgabe, folgen Sie ihr, senden Sie sie weiter und brechen Sie sie ab.',
  'settings.metadata.c7ad7ac4793fb440':
    'Lesen Sie die vom Debugger aufgezeichneten Läufe, markieren Sie ihre Schritte, fügen Sie Aufzeichnungspunkte hinzu und schreiben Sie sie auf; Lesen, Speichern, Importieren und Senden der gespeicherten Anfragen des Projekts.',
  'settings.metadata.1fd38d5cbd2a997b': 'Muster',
  'settings.metadata.f2892578274d2e49': 'geöffnete Notiz',
  'settings.metadata.034a0062488256f1': 'Ordner',
  'settings.scope.groupNotes': { one: 'Gruppe · {count} Notiz', other: 'Gruppe · {count} Notizen' },
  'settings.calendar.urlPlaceholder': 'https://… oder webcal://…',
  'settings.transfer.singleQr': 'Die Übertragung als QR-Code anzeigen',
  'settings.transfer.multipleQr': {
    one: 'Die Übertragung als {count} QR-Codes anzeigen',
    other: 'Die Übertragung als {count} QR-Codes anzeigen',
  },
  'settings.metadata.bf774e203130976f': 'Aufzeichnungspunkt hinzufügen',
  'settings.metadata.ed11479db97b1ec2': 'Aufgabe auf Knoten abbrechen',
  'settings.metadata.ce884b28082de708': 'Aufgabe an Knoten delegieren',
  'settings.metadata.47cbd67f4decc509': 'In Ausführung suchen',
  'settings.metadata.20c3a692f1425939': 'Wert verfolgen',
  'settings.metadata.a63e38b5ef9d8acc': 'Aufgabe auf Knoten fortsetzen',
  'settings.metadata.3dcb2cb134c18f1a': 'Anfragen importieren',
  'settings.metadata.a657f2eaf9177c2b': 'Arbeitsbäume des Knotens',
  'settings.metadata.3f577c263389d695': 'In Ausführung markieren',
  'settings.metadata.f40ad2a69f110e1a': 'Dateien auf Knoten kopieren',
  'settings.metadata.4c55f1221ca27657': 'Ziele für Knotenaufgaben',
  'settings.metadata.19d5a1e505698a8d': 'Dateien auf Knoten bearbeiten',
  'settings.metadata.58bab54373681382': 'Ordner des Knotens',
  'settings.metadata.0887cebecaa90ad8': 'Git-Zeilenautoren auf Knoten',
  'settings.metadata.7d99864f0651cf16': 'Git-Branches auf Knoten',
  'settings.metadata.c6d22695c2b49792': 'Git-Unterschiede auf Knoten',
  'settings.metadata.2e62cdbaa5ee98f0': 'Git-Verlauf auf Knoten',
  'settings.metadata.74cd294db7d3e719': 'Git-Status auf Knoten',
  'settings.metadata.0c7411b73901f6c2': 'Dateien des Knotens auflisten',
  'settings.metadata.e5b0c93478880755': 'Dateien auf Knoten verschieben',
  'settings.metadata.c5dfe7e400c6f227': 'Knoten auflisten',
  'settings.metadata.fe2b5c47256ac07e': 'Dateien auf Knoten lesen',
  'settings.metadata.b0dc611264fca372': 'Text auf Knoten ersetzen',
  'settings.metadata.d3d7043d61bb21c8': 'Zeilenautoren im Knoten-Repository',
  'settings.metadata.34feb0cfc058ccff': 'Änderungen im Knoten-Repository',
  'settings.metadata.dd2e41d38b7838e9': 'Commit im Knoten-Repository erstellen',
  'settings.metadata.074e769d80fde34e': 'Commits des Knoten-Repositorys',
  'settings.metadata.c4806722ba66e903': 'Versionen im Knoten-Repository vergleichen',
  'settings.metadata.ab004772e1b71ba8': 'Datei des Knoten-Repositorys',
  'settings.metadata.6544b43fdfe3320e': 'Im Knoten-Repository suchen',
  'settings.metadata.a9c6586ae9f11964': 'Knoten-Repository öffnen',
  'settings.metadata.81ac4cdc952990d9': 'Änderung im Knoten-Repository vorschlagen',
  'settings.metadata.44812fcb9883ac9d': 'Dateibaum des Knoten-Repositorys',
  'settings.metadata.b74af9f786625504': 'Tabs des Knoten-Repositorys',
  'settings.metadata.cc00c9b3261b6896': 'Dateien auf Knoten löschen',
  'settings.metadata.f864b17e206c9949': 'Dateien auf Knoten suchen',
  'settings.metadata.01bce5e752a4e282': 'Arbeitsbaum des Knotens wechseln',
  'settings.metadata.82a9c46ffa478994': 'Commit',
  'settings.metadata.ca8a5f3bee55b125': 'Arbeitsbaum löschen…',
  'settings.metadata.6c91d7b86793064a': 'Dateien auf Knoten schreiben',
  'settings.metadata.aa2463736b28728a': 'Notiz zur Ausführung',
  'settings.metadata.f659e2e6ad7c78ad': 'Gespeicherte Anfrage lesen',
  'settings.metadata.bac5871a628ca72b': 'Status der Knotenaufgabe lesen',
  'settings.metadata.7616d1f9f0eb2abe': 'Aufgezeichnete Ausführungen',
  'settings.metadata.62b2137489d32412': 'Ergebnis des Sendens',
  'settings.metadata.87c059b1fd800819': 'Zeitverlauf der Ausführung',
  'settings.metadata.93f46c6131a98750': 'Anfrage speichern',
  'settings.metadata.49813efc30da7138': 'Gespeicherte Anfragen',
  'settings.metadata.0d50b621a3f98f5d': 'Gespeicherte Anfrage senden',
  'settings.metadata.a4b757018683f41d': 'Wertänderungen',
  'settings.metadata.ae1b1551ec65814d': 'Wertstruktur',
  'settings.metadata.7a6f44b8094e0625': 'Wertausschnitt',
  'settings.metadata.da9b697a15683606': 'Leinwand erstellen',
  'settings.metadata.841ee7bd4aeb25a6': 'Leinwandrundgang festlegen',
  'settings.metadata.aab4922458b14785': 'Leinwand bearbeiten',
  'settings.metadata.97fd18d398003c79': 'Ganze Leinwand exportieren',
  'settings.metadata.1fe56b7b323305fc': 'Leinwandelemente anordnen',
  'settings.metadata.6f53a1ddd68b0c2b': 'Leinwand ansehen',
  'settings.metadata.2b046175f5077346': 'Leinwand lesen',
  'settings.tools.openSection': '«{section}» öffnen',
  'settings.ModelEditModal.default.21b111cb': 'Standard',
  'settings.ModelEditModal.low.f793de20': 'Niedrig',
  'settings.ModelEditModal.medium.8e588cd1': 'Medium',
  'settings.ModelEditModal.high.c4ebc6d4': 'Hoch',
  'settings.ai.AgentEditorModal.none.dc937b59': 'Keine',
  'settings.ai.AgentEditorModal.follow_the_setting.ead899ca': 'Wie eingestellt',
  'settings.ai.AgentEditorModal.by_section.2c8a0eb5': 'Nach Abschnitten',
  'settings.ai.AgentEditorModal.all_at_once.f9068371': 'Alle auf einmal',
  'settings.ai.GeneralSettings.same_as_the_chat.3e206eff': 'Wie im Chat',
  'settings.ai.GeneralSettings.off.ca7981b4': 'Aus',
  'settings.ai.GeneralSettings.once.d88f6d83': 'Einmal',
  'settings.ai.GeneralSettings.twice.cc1b4c8d': 'Zweimal',
  'settings.ai.GeneralSettings.three_times.13b6376c': 'Dreimal',
  'settings.ai.GeneralSettings.five_times.ee32f27e': 'Fünfmal',
  'settings.ai.GeneralSettings.not_configured.dd1841d2': 'Nicht konfiguriert',
  'settings.transfer.TransferScanModal.keep_it_and_add_these.b6bd0311':
    'Vorhandenes behalten und diese hinzufügen',
  'settings.transfer.TransferScanModal.replace_it_with_these.c489d0d8':
    'Vorhandenes durch diese ersetzen',
  'settings.components.ToolModesEditor.mixed.f340b6d6': 'Gemischt',
  'settings.metadata.6fd575b1876b0d59':
    'Der Eigenschaftenblock steht in der ersten Zeile, ist abgeschlossen, enthält gültiges YAML und keine doppelten Eigenschaftsnamen. Ein nach unten gerutschter Block wird an den Anfang verschoben; eine mit demselben Wert wiederholte Eigenschaft wird entfernt.',
  'settings.metadata.36317c6ed2cd7dbe':
    'Die aufgeführten Eigenschaften sind vorhanden und ausgefüllt. Nach einem Doppelpunkt kann ein Standardwert stehen: "created: {{ctime}}" setzt das Erstellungsdatum der Datei ein, {{today}} das heutige Datum. Nur diese Eigenschaften werden korrigiert.',
  'settings.components.reader.ReaderSettingsForm.this_book_s_pages_are.f094ff7e':
    'Die Seiten dieses Buches sind wie die eines Comics nach dem Buch angeordnet: Es gibt nichts, was man dafür festlegen könnte. Zoomen Sie mit Mod und Plus oder Minus, einer Prise oder dem Menü der Registerkarte.',
  'settings.components.reader.ReaderSettingsForm.layout.a5119091': 'Layout',
  'settings.components.reader.ReaderSettingsForm.turn_pages_one_at_a.8c26479f':
    'Blättern Sie eine Seite nach der anderen um oder scrollen Sie durch die einzelnen Kapitel. Der E-Ink-Modus speichert Seiten auf diesem Gerät.',
  'settings.components.reader.ReaderSettingsForm.turn_pages_one_at_a.c0f95f4f':
    'Blättern Sie eine Seite nach der anderen um oder scrollen Sie durch die einzelnen Kapitel.',
  'settings.components.reader.ReaderSettingsForm.font.64d0b3ad': 'Schriftart',
  'settings.components.reader.ReaderSettingsForm.fonts_folder.cb89bd22': 'Ordner „Schriftarten“.',
  'settings.components.reader.ReaderSettingsForm.a_folder_in_the_vault.92bd812c':
    'Ein Ordner im Vault mit Schriftartdateien: .ttf, .otf, .woff oder .woff2. Jede darin enthaltene Familie wird oben als Schriftart angeboten und wandert mit dem Vault auf Ihre anderen Geräte. Obsidian Sync überträgt sie zusammen mit allen anderen Typen. Leer: Keine Schriftarten aus dem Vault.',
  'settings.components.reader.ReaderSettingsForm.text_size.d68761cc': 'Textgröße',
  'settings.components.reader.ReaderSettingsForm.line_spacing.0db45da1': 'Zeilenabstand',
  'settings.components.reader.ReaderSettingsForm.margins.eea8d245': 'Ränder',
  'settings.components.reader.ReaderSettingsForm.the_space_around_the_text.0315d33b':
    'Der Raum um den Text und zwischen den Spalten.',
  'settings.components.reader.ReaderSettingsForm.column_width.86f4e582': 'Spaltenbreite',
  'settings.components.reader.ReaderSettingsForm.the_widest_a_column_of.f684dbab':
    'Die Breite, die eine Textspalte erreichen darf.',
  'settings.components.reader.ReaderSettingsForm.two_columns.ff4a0135': 'Zwei Spalten',
  'settings.components.reader.ReaderSettingsForm.two_pages_side_by_side.4fa3abc2':
    'Zwei Seiten nebeneinander, wenn die Registerkarte breit genug ist.',
  'settings.components.reader.ReaderSettingsForm.theme_colours.c75350b1': 'Themenfarben',
  'settings.components.reader.ReaderSettingsForm.draw_the_book_in_your.2f7ab7ee':
    'Zeichnen Sie das Buch in den Text- und Hintergrundfarben Ihres Themas, einschließlich des Dunkelmodus. Aus: die eigenen Farben des Buches, auf einer hellen Seite.',
  'settings.components.reader.ReaderSettingsForm.book_s_own_styles.67266f8d':
    'Eigene Stile des Buches',
  'settings.components.reader.ReaderSettingsForm.the_book_s_own_layout.a674d8a8':
    'Das eigene Layout des Buches: Tabellen, Einzüge, Ausrichtung, Initialen. Ihre Textgröße, Ihr Abstand, Ihre Schriftart und Ihre Farben gewinnen immer noch. Nichts außerhalb des Buches wird jemals geladen.',
  'settings.components.reader.ReaderSettingsForm.open_pdf_files_in_the.d806dd32':
    'Öffnen Sie PDF-Dateien im Abele-Reader',
  'settings.components.reader.ReaderSettingsForm.pdfs_open_here_instead_of.3f90cb9b':
    'PDFs werden hier statt in Obsidians eigenem Viewer geöffnet, mit Seiten zum Umblättern, dem Inhalt daneben und dem gespeicherten Ort. Aus: Sie werden im Obsidian-Viewer geöffnet, und beim Öffnen im Abele-Reader im Menü einer PDF-Datei wird hier immer noch eines geöffnet.',
  'settings.components.reader.ReaderSettingsForm.one_continuous_scroll_page_under.0ef1ee8f':
    'Ein fortlaufender Bildlauf, Seite für Seite oder Seiten, die einzeln umgeblättert werden.',
  'settings.components.reader.ReaderSettingsForm.page_size.bd69e66e': 'Seitengröße',
  'settings.components.reader.ReaderSettingsForm.automatic_is_the_page_s.b16d03bb':
    'Automatisch wird die Seitenbreite beim Scrollen und die ganze Seite mit Seiten angezeigt. Oder passen Sie die gesamte Seite an, passen Sie ihre Breite an oder stellen Sie einen festen Zoom ein.',
  'settings.components.reader.ReaderSettingsForm.two_pages_side_by_side.594104bc':
    'Zwei Seiten nebeneinander',
  'settings.components.reader.ReaderSettingsForm.when_the_tab_is_wide.f46590d6':
    'Wenn die Lasche breit genug ist, liegt ein aufgeschlagenes gedrucktes Buch vor.',
  'settings.components.reader.ReaderSettingsForm.dark_pages_in_a_dark.93ab09cd':
    'Dunkle Seiten in einem dunklen Thema',
  'settings.components.reader.ReaderSettingsForm.the_page_s_light_and.d827fce3':
    'Die hellen und dunklen Seiten sind vertauscht, während das Thema von Obsidian dunkel ist, sodass eine weiße Seite nicht blendet. Bilder kommen als Negative heraus.',
  'settings.components.reader.ReaderSettingsForm.pen_thickness.6cfc015f': 'Stiftdicke',
  'settings.components.reader.ReaderSettingsForm.how_thick_the_pen_and.ed066925':
    'Wie dick zeichnen Stift und Marker auf einem PDF? Die Schaltfläche neben den Farben unter der Seite ändert diese ebenfalls.',
  'settings.components.reader.ReaderSettingsForm.pen_thickness_on_drawings.cf146856':
    'Stiftstärke auf Zeichnungen',
  'settings.components.reader.ReaderSettingsForm.how_thick_the_pen_and.cb33f16a':
    'Wie dick zeichnen Stift und Marker auf einer Zeichnung oder einem Bild auf? Die Schaltfläche neben den Farben in der Leiste ändert diese ebenfalls.',
  'settings.components.reader.ReaderSettingsForm.e_ink_on_this_device.c30db2fc':
    'E-Ink, auf diesem Gerät',
  'settings.components.reader.ReaderSettingsForm.for_a_reader_with_an.85f96337':
    'Für ein Lesegerät mit einem E-Ink-Bildschirm, z. B. ein Boox. Nur auf diesem Gerät gespeichert: Ihr Telefon und Ihr Computer lesen wie zuvor.',
  'settings.components.reader.ReaderSettingsForm.e_ink_mode.42a01801': 'E-Ink-Modus',
  'settings.components.reader.ReaderSettingsForm.pages_turned_never_scrolled_or.98803e3d':
    'Seiten umgeblättert, nie gescrollt oder verschoben, auch ein PDF. Schwarzer Text auf Weiß, nichts Graues, dickere Linien, nichts, das sich bewegt oder verblasst. Hervorhebungen werden als Linien gezeichnet, deren Form die Farbe angibt. Durch Antippen im linken oder rechten Drittel wird die Seite umgeblättert. Die Seitentasten und -tasten drehen es auch.',
  'settings.components.reader.ReaderSettingsForm.full_refresh.9322071a':
    'Vollständige Aktualisierung',
  'settings.components.reader.ReaderSettingsForm.the_page_flashes_black_and.d072717f':
    'Die Seite blinkt alle paar Seiten schwarz und dann weiß, wodurch der schwache Geist früherer Seiten verschwindet, den ein E-Ink-Bildschirm hinterlässt.',
  'settings.components.reader.ReaderSettingsForm.show_the_keys_the_reader.ea82694e':
    'Zeigen Sie die Schlüssel, die der Leser hört',
  'settings.components.reader.ReaderSettingsForm.over_the_page_the_name.ff90557a':
    'Auf der Seite werden der Name und der Code der zuletzt gedrückten Taste oder Schaltfläche angezeigt und es wird angegeben, ob die Seite umgeblättert wurde. Die Konsole protokolliert jeden. Um herauszufinden, was die Seitenschaltflächen eines Lesers senden, wenn er die Seiten nicht umblättert.',
  'settings.components.reader.ReaderSettingsForm.reading_aloud.044c9986': 'Vorlesen',
  'settings.components.reader.ReaderSettingsForm.voice.87bf2bc0': 'Stimme',
  'settings.components.reader.ReaderSettingsForm.the_voices_this_device_has.fbb10a8e':
    'Die Stimmen dieses Geräts; auf einem iPhone die unter Einstellungen → Barrierefreiheit → Gesprochener Inhalt. Eine Stimme, die auf einem anderen Gerät ausgewählt wurde, das diesem fehlt, wird als Standard angezeigt.',
  'settings.components.reader.ReaderSettingsForm.speed.c372fee9': 'Geschwindigkeit',
  'settings.components.reader.ReaderSettingsForm.where_books_were_left.28aed7a8':
    'Wo Bücher zurückgelassen wurden',
  'settings.components.reader.ReaderSettingsForm.reading_places_file.e1c4bfc7': 'Ortsdatei lesen',
  'settings.components.reader.ReaderSettingsForm.a_json_file_in_the.601687c5':
    'Eine .json-Datei im Vault, die den Speicherort jedes Buchs speichert, sodass jedes Gerät es dort öffnen kann. Die Dateiliste von Obsidian zeigt es nicht. Obsidian Sync führt es mit der Synchronisierung aller anderen Typen durch, ebenso wie Chats. Durch Ändern des Pfads werden die Orte in die neue Datei verschoben. Leer: {value0}.',
  'settings.components.reader.ReaderSettingsForm.every_value_pages.95a857a4':
    'Alle {value0} Seiten',
  'settings.components.reader.ReaderSettingsForm.never.6300ef80': 'Niemals',
  'settings.components.reader.ReaderSettingsForm.pages.9046da16': 'Seiten',
  'settings.components.reader.ReaderSettingsForm.scrolling.9b976293': 'Scrollen',
  'settings.components.reader.ReaderSettingsForm.theme_s_text_font.60cc69f0':
    'Textschrift des Themes',
  'settings.components.reader.ReaderSettingsForm.serif.1b5e747e': 'Serife',
  'settings.components.reader.ReaderSettingsForm.sans_serif.07e77255': 'Ohne Serifen',
  'settings.components.reader.ReaderSettingsForm.the_book_s_own.e5eed055': 'Wie im Buch',
  'settings.components.reader.ReaderSettingsForm.value_not_in_the_fonts.a0bd3d6c':
    '{value0} (nicht im Schriftartenordner)',
  'settings.components.reader.ReaderSettingsForm.the_font_of_the_text.d4417807':
    'Die Schriftart des Textes. Das Thema ist dasjenige, das Ihre Notizen verwenden. Unterhalb der Bücher des Buches befinden sich die Schriftarten aus Ihrem Schriftartenordner.',
  'settings.components.reader.ReaderSettingsForm.the_font_of_the_text.b3dc0358':
    'Die Schriftart des Textes. Das Thema ist dasjenige, das Ihre Notizen verwenden. Legen Sie Schriftartendateien im Schriftartenordner ab, um sie selbst einzulesen.',
  'settings.components.reader.ReaderSettingsForm.narrow.ba227109': 'Schmal',
  'settings.components.reader.ReaderSettingsForm.normal.a7248eeb': 'Normal',
  'settings.components.reader.ReaderSettingsForm.wide.147170e7': 'Breit',
  'settings.components.reader.ReaderSettingsForm.continuous_scroll.39e14ae6':
    'Kontinuierliches Scrollen',
  'settings.components.reader.ReaderSettingsForm.automatic.d461a493': 'Automatisch',
  'settings.components.reader.ReaderSettingsForm.whole_page.d9799e4c': 'Ganze Seite',
  'settings.components.reader.ReaderSettingsForm.page_width.217fbef1': 'Seitenbreite',
  'settings.components.reader.ReaderSettingsForm.the_device_s_voice_for.7aa4eae4':
    'Die Stimme des Geräts für die Sprache des Buches',
  'settings.components.reader.ReaderSettingsForm.a_voice_from_another_device.f2965a24':
    'Eine Stimme von einem anderen Gerät',
  'settings.components.reader.BookNotesSettings.highlights_of_this_book.1202b037':
    'Highlights dieses Buches',
  'settings.components.reader.BookNotesSettings.highlights.6e517828': 'Höhepunkte',
  'settings.components.reader.BookNotesSettings.where_they_go.e7d3bea7': 'Wohin sie gehen',
  'settings.components.reader.BookNotesSettings.for_this_book_alone_as.cc47dd64':
    'Allein für dieses Buch. „Wie in den Einstellungen“ folgt Einstellungen → Bücher.',
  'settings.components.reader.BookNotesSettings.a_note_of_each_book.198e675e':
    'Eine eigene Notiz zu jedem Buch daneben oder eine Notiz zu jedem Buch. Ein Buch kann über seinen Aa-Button selbst ausgewählt werden.',
  'settings.components.reader.BookNotesSettings.note.d8da2c49': 'Notiz',
  'settings.components.reader.BookNotesSettings.note_for_all_books.105d496e':
    'Hinweis für alle Bücher',
  'settings.components.reader.BookNotesSettings.the_note_this_book_s.47b93fc6':
    'Die Highlights dieses Buches finden Sie hier. Leer: {value0}.',
  'settings.components.reader.BookNotesSettings.made_with_the_first_highlight.21e4557d':
    'Hergestellt mit dem ersten Highlight; Die einzelnen Bücher sind durch ihre Links voneinander zu unterscheiden. Leer: {value0}.',
  'settings.components.reader.BookNotesSettings.template.0575f29d': 'Vorlage',
  'settings.components.reader.BookNotesSettings.a_note_to_make_this.fe9815bd':
    'Eine Notiz, um die Highlights dieses Buches zu notieren. Leer: wie in den Einstellungen.',
  'settings.components.reader.BookNotesSettings.a_note_a_new_highlights.a56f13fc':
    'Eine Notiz, aus der eine neue Hervorhebungsnotiz erstellt wird. Zwischen {literal0} und {literal1} steht, was jedes Highlight hinzufügt, wobei {literal2} das Highlight ist; oder {literal3} und {literal4}, um das Zitat und Ihren Kommentar zu trennen; auch {literal5}, {literal6}, {literal7}, {literal8}, {literal9}. Leer: keine.',
  'settings.components.reader.BookNotesSettings.none.dc937b59': 'Keine',
  'settings.components.reader.BookNotesSettings.a_note_of_the_book.6c1f2ec2':
    'Eine eigene Notiz für das Buch',
  'settings.components.reader.BookNotesSettings.one_note_for_every_book.698e6f78':
    'Eine Notiz für alle Bücher',
  'settings.components.reader.BookNotesSettings.as_in_settings_value.7686ad0c':
    'Wie in den Einstellungen ({value0})',
  'settings.components.reader.BookNotesSettings.a_note_you_name.09402a6f':
    'Eine Notiz, die Sie nennen',
  'settings.reader.stroke.fine': 'Fein',
  'settings.reader.stroke.medium': 'Mittel',
  'settings.reader.stroke.bold': 'Dick',
  'settings.GithubAccessReport.an_access_token.14f95c33': 'ein Zugriffstoken',
  'settings.GithubConnectionEditor.add_git_connection.9e359dd8': 'Git-Verbindung hinzufügen',
  'settings.GithubConnectionEditor.edit_git_connection.1e73be5f': 'Git-Verbindung bearbeiten',
  'settings.GithubConnectionEditor.service.d677190e': 'Dienst',
  'settings.GithubConnectionEditor.choose_the_service_before_entering.1fbb0dd8':
    'Wählen Sie den Dienst, bevor Sie Serveradresse und Token eingeben.',
  'settings.GithubConnectionEditor.full_forgejo_address_including_any.4aacc3e1':
    'Vollständige Forgejo-Adresse einschließlich Port oder Installationspfad.',
  'settings.GithubConnectionEditor.access_token.9a911b08': 'Zugriffstoken',
  'settings.GithubConnectionEditor.sample_org_sample_org_project.51d1a47b':
    'sample-org\nsample-org/project',
  'settings.GithubConnectionEditor.owner_repo_or_a_forgejo.5bdaf9f1':
    'Eigentümer/Repo oder ein Forgejo-Link',
  'settings.GithubConnectionEditor.access_details.abe1adac': 'Zugriffsdetails',
  'settings.GithubConnectionEditor.forgejo.f4e62146': 'Forgejo',
  'settings.GithubConnectionEditor.signed_in_as_value.682769b2': 'Angemeldet als {value0}',
  'settings.GithubConnectionEditor.the_host_did_not_accept.71ef1e9a':
    'Der Server hat dieses Token nicht akzeptiert (401).',
  'settings.GithubConnectionEditor.the_account_could_not_be.71de8f27':
    'Das Konto konnte nicht überprüft werden. {value0}',
  'settings.GithubConnectionEditor.public_access_without_a_token.35b758c0':
    'Öffentlicher Zugang ohne Token',
  'settings.GithubConnectionEditor.choose_a_repository_to_check.0ea16edc':
    'Wählen Sie ein Repository aus, um den Lesezugriff zu prüfen.',
  'settings.GithubConnectionEditor.the_connection_token_changed_check.225dffc8':
    'Das Verbindungstoken wurde geändert. Überprüfen Sie den Zugriff erneut.',
  'settings.GithubConnectionEditor.the_stored_token_belongs_to.6fe37376':
    'Der gespeicherte Token gehört zum vorherigen Server. Geben Sie einen neuen Token für diese Adresse ein.',
  'settings.GithubConnectionEditor.give_owner_repo_or_a.08ecfbf3':
    'Geben Sie einen Besitzer/Repo oder einen Repository-Link auf dem Server dieser Verbindung an.',
  'settings.GithubConnectionEditor.asking_forgejo.f46aa9ff': 'Forgejo wird abgefragt…',
  'settings.GithubSettings.git_hosting.a3002011': 'Git-Hosting',
  'settings.GithubSettings.default.2ae2ecc2': 'Standard · ',
  'settings.GithubSettings.edit_connection.047f9f95': 'Verbindung bearbeiten',
  'settings.GithubSettings.connection_actions.9e1bbb65': 'Verbindungsaktionen',
  'settings.GithubSettings.public_access_without_a_token.35b758c0':
    'Öffentlicher Zugang ohne Token',
  'settings.GithubSettings.forgejo.f4e62146': 'Forgejo',
  'settings.GithubSettings.token_unavailable_on_this_device.0bd03b33':
    'Token ist auf diesem Gerät nicht verfügbar',
  'settings.GithubSettings.the_token_has_expired.0b52627f': 'Der Token ist abgelaufen',
  'settings.GithubSettings.the_server_did_not_accept.1d7560a4':
    'Der Server hat das Token bei der letzten Zugriffsprüfung nicht akzeptiert',
  'settings.GithubSettings.the_last_access_check_failed.72f4e393':
    'Die letzte Zugriffsprüfung ist fehlgeschlagen',
  'settings.GithubSettings.some_repository_access_checks_failed.1b573ceb':
    'Einige Repository-Zugriffsprüfungen sind fehlgeschlagen',
  'settings.GithubSettings.access_checked.d2518d23': 'Zugriff geprüft',
  'settings.GithubSettings.not_checked_yet.881d23f6': 'Noch nicht überprüft',
  'settings.GithubSettings.check_access.abb9a172': 'Zugriff prüfen',
  'settings.GithubSettings.make_default_for_value.ded3e105': 'Als Standard für {value0} festlegen',
  'settings.git.serverAddressError':
    'Nur die Adresse: ohne Benutzername, Abfrage oder Fragment nach #',
  'settings.git.noteLabel': 'Notiz',
  'settings.transfer.oneKeyToStore': 'Ein Schlüssel zum Speichern der ausgewählten Elemente.',
  'settings.git.nativeAddress':
    'Vollständige Adresse von {service}, einschließlich Port und Installationspfad.',
  'settings.git.useCodeberg': 'Codeberg verwenden',
  'settings.git.useCodebergTooltip': 'Codeberg als Forgejo-Server verwenden',
  'settings.git.nativeRepoLink': 'owner/repo oder ein Link zu {service}',
  'settings.git.gitea': 'Gitea',
  'settings.git.githubId': 'github',
  'settings.git.askingNative': '{service} wird abgefragt…',
  'settings.git.accessCheckCancelled': 'Diese Zugriffsprüfung wurde abgebrochen.',
  'settings.git.repositoryConnections': 'Git-Verbindungen',
  'settings.metadata.ca4a628311f7879a': 'Git-Repositories',
  'settings.metadata.b9227122bad532e6': 'Repository-Tabs',
  'debuggerAccess.title': 'Debuggerzugriff für den Agenten',
  'debuggerAccess.request': 'Dem Agenten die Nutzung des Debuggers in {folder} erlauben',
  'debuggerAccess.chatFolder': 'diesem Chatordner',
  'debuggerAccess.scope':
    'Nur für diesen Lauf und dieses Programm. Ausdrücke erfordern weiterhin eine gesonderte Freigabe.',
  'debuggerAccess.allowed': 'Debuggerzugriff erlaubt. Der Agent kann den Aufruf wiederholen.',
  'debuggerAccess.denied': 'Debuggerzugriff abgelehnt.',
  'debuggerAccess.expiredRequest':
    'Diese Anfrage ist abgelaufen. Bitte den Agenten, es erneut zu versuchen.',
  'debuggerAccess.allow': 'Erlauben',
  'debuggerAccess.deny': 'Ablehnen',
  'debuggerAccess.issued':
    'Von dir auf diesem Gerät erteilte Berechtigungen. Der Zugriff endet mit dem Lauf.',
  'debuggerAccess.issuerOnly':
    'Berechtigungen anderer Eigentümer sind ausgeblendet. Nur wer eine Berechtigung erteilt hat, kann sie widerrufen oder löschen.',
  'debuggerAccess.refresh': 'Aktualisieren',
  'debuggerAccess.updateNode':
    'Aktualisiere diesen Knoten, um den Debuggerzugriff des Agenten zu verwalten.',
  'debuggerAccess.empty': 'Du hast keine Debuggerberechtigungen erteilt.',
  'debuggerAccess.revoke': 'Debuggerzugriff widerrufen',
  'debuggerAccess.deleteTip':
    'Diese Berechtigung löschen. Nur selbst erteilte Berechtigungen können gelöscht werden. Der Vorgangsverlauf bleibt erhalten.',
  'debuggerAccess.grantsUnavailable': 'Debuggerberechtigungen sind nicht verfügbar',
  'debuggerAccess.changeFailed': 'Die Debuggerberechtigung konnte nicht geändert werden',
  'debuggerAccess.state.revoked': 'Widerrufen',
  'debuggerAccess.state.expired': 'Abgelaufen',
  'debuggerAccess.state.active': 'Aktiv',
  'debuggerAccess.grantDescription':
    '{state} · {actions} · {mode} · {conversation} · Gültig bis {expires}',
  'debuggerAccess.refreshRequests': 'Debuggeranfragen aktualisieren',
  'debuggerAccess.unavailable': 'Debuggerzugriff ist nicht verfügbar',
  'debuggerAccess.stale':
    'Diese Debuggeranfrage wartet nicht mehr auf eine Entscheidung. Die ausstehenden Anfragen wurden aktualisiert.',
  'debuggerAccess.action.read': 'Lesen',
  'debuggerAccess.action.step': 'Schritt',
  'debuggerAccess.action.continue': 'Fortsetzen',
  'debuggerAccess.action.pause': 'Pause',
  'debuggerAccess.action.breakpoints': 'Haltepunkte',
  'debuggerAccess.action.launch': 'Starten',
  'debuggerAccess.action.attach': 'Anhängen',
  'debuggerAccess.action.detach': 'Trennen',
  'debuggerAccess.action.terminate': 'Beenden',
  'debuggerAccess.action.expressions': 'Ausdrücke',
  'debuggerAccess.action.evaluate': 'Auswerten / Variable ändern',
  'debuggerAccess.mode.ask': 'Nachfragen',
  'debuggerAccess.mode.allowAll': 'Alles erlauben',
  'settings.git.reloadService': 'Erneut vom Git-Dienst laden',
  'settings.git.openBrowser': 'Im Browser öffnen',
  'settings.metadata.gitHosting': 'Git-Hosting',
  'maps.viewName': 'Abele-Karte',
  'maps.coordinates': 'Koordinateneigenschaft',
  'maps.markerIcon': 'Markersymbol',
  'maps.markerColor': 'Markerfarbe',
  'maps.center': 'Mittelpunktkoordinaten',
  'maps.defaultZoom': 'Anfangszoom',
  'maps.minZoom': 'Minimaler Zoom',
  'maps.maxZoom': 'Maximaler Zoom',
  'maps.mapHeight': 'Eingebettete Höhe',
  'maps.groupNearby': 'Nahe Orte gruppieren',
  'maps.mapTiles': 'Kartenkacheln',
  'maps.mapTilesDark': 'Kartenkacheln im Dunkelmodus',
  'maps.copied': 'Koordinaten kopiert',
  'maps.copyFailed': 'Koordinaten konnten nicht kopiert werden',
  'maps.delete': 'Notiz löschen',
  'maps.createFailed': 'Notiz konnte nicht erstellt werden',
  'maps.saveFailed': 'Hintergründe konnten nicht gespeichert werden',
  'maps.locationDenied': 'Standortberechtigung verweigert',
  'maps.locationTimeout': 'Standortanfrage abgelaufen',
  'maps.locationUnavailable': 'Standort nicht verfügbar',
  'maps.locating': 'Standort wird ermittelt…',
  'commands.copy-current-map-location': 'Aktuelle Standortkoordinaten kopieren',
  'maps.zoomIn': 'Vergrößern',
  'maps.zoomOut': 'Verkleinern',
  'maps.north': 'Nach Norden ausrichten',
  'maps.locationOff': 'Standort für Obsidian deaktiviert',
  'maps.following': 'Standort folgen. Zum Stoppen drücken',
  'maps.showLocation': 'Meinen Standort anzeigen',
  'maps.exitFull': 'Vollbild beenden',
  'maps.full': 'Vollbild',
  'maps.fitPlaces': 'Alle Orte anzeigen',
  'maps.defaultBackground': 'Standard',
  'maps.background': 'Hintergrund',
  'maps.tab': 'In neuem Tab öffnen',
  'maps.split': 'Rechts öffnen',
  'maps.window': 'In neuem Fenster öffnen',
  'maps.card': 'Ortskarte',
  'maps.copy': 'Koordinaten kopieren',
  'maps.newHere': 'Neue Notiz hier',
  'maps.setCenter': 'Als Mittelpunkt festlegen',
  'maps.manage': 'Hintergründe verwalten…',
  'maps.noCoordinates': 'Keine Koordinaten',
  'maps.unreadable': 'Koordinaten unlesbar',
  'maps.formulaError': 'Formelfehler',
  'maps.noProperty': 'Wo sind die Koordinaten?',
  'maps.pickProperty': 'Eigenschaft oder Formel mit Ortskoordinaten wählen.',
  'maps.configure': 'Ansicht konfigurieren',
  'maps.noRecords': 'Noch keine Notizen in dieser Base',
  'maps.hold': 'Karte gedrückt halten, um einen Ort hinzuzufügen.',
  'maps.rightClick': 'Rechtsklick auf die Karte fügt einen Ort hinzu.',
  'maps.filtered': 'Keine Orte passen zu den Filtern',
  'maps.filtersEmpty': 'Die Filter lassen keine Ergebnisse übrig.',
  'maps.filters': 'Filter',
  'maps.nothing': 'Nichts gefunden',
  'maps.addCoordinates': 'Koordinaten hinzufügen oder eine andere Eigenschaft wählen.',
  'maps.showNotes': 'Notizen anzeigen',
  'maps.loadFailed': 'Karte konnte nicht geladen werden',
  'maps.offline': 'Keine Verbindung zum Kartenserver. Die Orte bleiben verfügbar.',
  'maps.retry': 'Erneut versuchen',
  'maps.noWebgl': 'Dieses Gerät kann keine Karten darstellen',
  'maps.graphics': 'Grafikbeschleunigung ist deaktiviert oder nicht verfügbar.',
  'maps.stopped': 'Karte wird nicht mehr dargestellt',
  'maps.lostContext': 'Grafikkontext verloren, etwa nach dem Ruhezustand.',
  'maps.drawAgain': 'Neu zeichnen',
  'maps.backgrounds': 'Hintergründe',
  'maps.up': 'Nach oben',
  'maps.down': 'Nach unten',
  'maps.edit': 'Bearbeiten',
  'maps.remove': 'Löschen',
  'maps.add': 'Hinzufügen',
  'maps.addBackground': 'Hintergrund hinzufügen',
  'maps.newBackground': 'Neuer Hintergrund',
  'maps.editBackground': 'Hintergrund bearbeiten',
  'maps.name': 'Name',
  'maps.light': 'Hell',
  'maps.dark': 'Dunkel',
  'maps.cancel': 'Abbrechen',
  'maps.save': 'Speichern',
  'maps.giveName': 'Namen angeben',
  'maps.needAddress': 'Mindestens eine Adresse erforderlich',
  'maps.createNote': 'Notiz erstellen',
  'maps.formulaWhy':
    'In Formeln kann nicht geschrieben werden. Vor dem Erstellen eine Koordinateneigenschaft wählen.',
  'maps.skipped': 'Notizen außerhalb der Karte: {count}',
  'maps.noneCoordinates': 'Notizen ohne Koordinaten: {count}',
  'maps.copyValue': '{value} kopieren',
  'maps.saveZoom': 'Mit Zoom {value} öffnen',
  'maps.placesHere': 'Orte hier: {count}',
  'maps.searchEmpty': 'Keine Orte für „{query}“.',
  'maps.backgroundHint': 'Benannte Hintergründe für Bases-Karten.',
  'maps.noBackgrounds': 'Keine eigenen Hintergründe',
  'maps.addressHint': 'Stiladresse oder Kachelvorlagen als Ebenen.',
  'maps.darkHint': 'Optional. Sonst wird auch im Dunkelmodus der helle Hintergrund verwendet.',
  'maps.fromMaps': 'Hintergründe von Obsidian Maps',
  'maps.copyBackgrounds': 'Hintergründe kopieren',
  'maps.importHint': 'Kopieren, ohne Einstellungen von Obsidian Maps zu ändern.',
  'maps.tileLayers': 'Kachelebenen: {count}',
  'maps.style': 'Stil',
  'maps.lightOnly': 'Nur hell; für beide Designs',
  'maps.bothThemes': 'Hell und dunkel',
  'maps.deleteFailed': 'Notiz konnte nicht gelöscht werden',
  'maps.fullUnavailable': 'Vollbild ist auf diesem Gerät nicht verfügbar',
  'maps.showList': 'Als Liste anzeigen',
  'maps.listBeside': 'Liste neben der Karte',
  'maps.placeGone': 'Diese Notiz ist nicht mehr verfügbar',
  'maps.attribution': 'Kartenquellen anzeigen',
  'maps.feedback': 'Kartenfeedback',
  'maps.touchHelp': 'Karte mit zwei Fingern verschieben',
  'maps.scrollHelp': 'Mit {key} und Scrollen die Karte zoomen',
  'maps.currentLocation': 'Aktueller Standort',
  'maps.backList': 'Zurück zur Liste',
  'maps.cardGone': 'Diese Notiz ist nicht mehr vorhanden',
  'maps.cardGoneText': 'Sie wurde nach dem Laden der Karte gelöscht oder verschoben.',
  'maps.cardError': 'Die Notiz konnte nicht gelesen werden',
  'maps.cardErrorText': 'Der Ort bleibt auf der Karte. Öffne die Notiz, um sie zu prüfen.',
  'maps.imageMissing': '{path} konnte nicht geladen werden',
  'maps.openPicture': 'Bild öffnen: {caption}',
  'maps.open': 'Öffnen',
  'maps.openNote': 'Notiz öffnen',
  'maps.showMap': 'Auf der Karte zeigen',
  'maps.more': 'Mehr',
  'maps.straightLine': '{distance} Luftlinie',
  'maps.mapFace': 'Karte anzeigen',
  'maps.hideList': 'Liste ausblenden',
  'maps.sortLabel': 'Sortierung: {order}',
  'maps.resort': 'Die Karte wurde bewegt. Vom neuen Mittelpunkt sortieren',
  'maps.placeCount': 'Orte: {count}',
  'maps.listSearchEmpty': 'Keine Orte für diese Suche',
  'maps.listEmpty': 'Keine Orte mit Koordinaten',
  'maps.sortBase': 'Reihenfolge der Basis',
  'maps.sortMe': 'In meiner Nähe',
  'maps.sortCentre': 'Nahe dem Kartenmittelpunkt',
  'maps.metres': '{value} m',
  'maps.kilometres': '{value} km',
  'maps.distanceCentre': 'Luftlinie vom Kartenmittelpunkt',
  'maps.distanceMe': 'Luftlinie von deinem Standort',
  'debug.open': 'Debuggen',
  'debug.run': 'Programm starten',
  'debug.attach': 'Mit laufendem Programm verbinden',
  'debug.checking': 'Debugger-Unterstützung wird geprüft…',
  'debug.offline': 'Verbindung zum Knoten wiederherstellen',
  'debug.off': 'Der Debugger ist auf diesem Knoten ausgeschaltet',
  'debug.update': 'Knoten für das Debuggen von Ordnern aktualisieren',
  'debug.install': 'Der JavaScript-Debugger ist auf dem Knoten nicht installiert',
  'debug.noFolder': 'Zuerst einen Ordner auf dem Knoten auswählen',
  'debug.pathKind': 'Ein Pfad in diesem Ordner',
  'debug.programPlaceholder': 'JavaScript-Datei zum Debuggen: src/main.js',
  'debug.programEmpty': 'Pfad einer JavaScript-Datei in diesem Ordner eingeben',
  'debug.thisFolder': 'Dieser Ordner',
  'debug.insideFolder': 'Läuft in diesem Ordner',
  'debug.outsideFolder': 'Läuft außerhalb dieses Ordners: Verbindung erfordert Bestätigung',
  'debug.executionTitle': 'Codeausführung in diesem Ordner erlauben?',
  'debug.executionMessage':
    'Codeausführung in {path} erlauben? Das registrierte Projekt wird als vertrauenswürdig markiert. Debugger-Programme und Agenten dürfen in diesem Ordner oder Arbeitsbaum ausgeführt werden.',
  'debug.empty': 'Debug über das Menü eines Knotenordners oder Chats öffnen.',
  'debug.outsideTitle': 'Mit einem Programm außerhalb dieses Ordners verbinden?',
  'debug.outsideMessage':
    '{command} läuft in {path}, außerhalb des ausgewählten Ordners. Der Debugger kann es anhalten und seine Werte lesen. Nach dem Trennen läuft es weiter.',
  'debug.sourceUpdate': 'Aktualisiere den Knoten, um Haltepunkte in dieser Datei zu setzen',
  'debug.sourceMap':
    'Der Knoten hat diese Datei noch nicht mit dem laufenden Programm verknüpft. Haltepunkte bleiben ausstehend. Starte das Programm neu oder verbinde den Debugger erneut, um es noch einmal zu versuchen. Falls es weiterhin fehlschlägt, prüfe die Source Maps des Programms.',
  'debug.sourceChanged':
    'Diese Datei wurde seit dem Programmstart geändert. Stellen Sie den damaligen Inhalt wieder her oder erstellen und starten Sie das Programm neu.',
  'debug.sourceOutside': 'Die Datei liegt außerhalb des Debug-Ordners',
  'debug.filePending':
    'Klicke auf eine Zeilennummer, um einen ausstehenden Haltepunkt zu setzen. Starte eine Debugsitzung für diesen Ordner oder verbinde den Debugger mit einem laufenden Programm, um ihn anzuwenden.',
  'debug.sourceUnavailable':
    'Diese Datei konnte nicht zum Debugger hinzugefügt werden. Prüfe die Verbindung zum Knoten und öffne die Datei danach erneut, um es noch einmal zu versuchen.',
  'debug.entryPlaceholder':
    'Einstiegsdateien oder Paketskripte suchen; oder einen kompilierten JavaScript-Pfad eingeben',
  'debug.entryEmpty':
    'Kein Treffer. Sie können den Pfad einer kompilierten JavaScript-Datei eingeben.',
  'debug.sourceConflict':
    'Diese Datei steht im Konflikt mit einer bereits hinzugefügten Quelldatei',
  'debug.sourceLimit': 'Das Quelldateilimit der Sitzung wurde erreicht',
  'debug.sourceUnreadable': 'Diese Datei ist nicht verfügbar oder nicht lesbar',
  'debug.launchConfiguration': 'Laufzeit und Umgebung',
  'debug.launchRuntimeArgs': 'Laufzeitargumente',
  'debug.launchRuntimeArgsHint':
    'Werden vor der Einstiegsdatei an Node übergeben, zum Beispiel --import=tsx.',
  'debug.launchCwd': 'Arbeitsordner',
  'debug.launchCwdHint':
    'Relativ zum ausgewählten Ordner. Leer: der nächste Paketordner der Einstiegsdatei.',
  'debug.launchEnv': 'Umgebungsvariablen',
  'debug.launchEnvHint':
    'Ein KEY=value pro Zeile. Werte werden wörtlich auf diesem Gerät gespeichert.',
  'debug.launchEnvInvalid': 'Verwenden Sie für Umgebungsvariablen ein KEY=value pro Zeile.',
  'debug.launchExitCode': 'Exit-Code: {code}',
  'debug.launchTitle': 'Programm ausführen',
  'debug.launchProgram': 'Programm',
  'debug.launchProgramHint':
    'Pfad relativ zu diesem Ordner. Geben Sie bei kompiliertem TypeScript die JavaScript-Einstiegsdatei an (zum Beispiel dist/main.js).',
  'debug.launchArgs': 'Argumente',
  'debug.launchArgsHint':
    'Trennen Sie Argumente durch Leerzeichen; setzen Sie Werte mit Leerzeichen in Anführungszeichen. Shell-Ausdrücke werden nicht ausgewertet.',
  'debug.launchArgsInvalid':
    'Schließen Sie alle Anführungszeichen und vervollständigen Sie Escape-Sequenzen in den Argumenten.',
  'debug.launchFailed': 'Das Programm konnte nicht gestartet werden: {detail}',
  'debug.launchExitedEarly':
    'Das Programm wurde beendet, bevor der Debugger sich verbinden konnte.',
  'debug.launchFailedPlain':
    'Das Programm konnte nicht gestartet werden. Weitere Informationen finden Sie unter Details.',
  'debug.sourceDeclaration':
    'Diese Deklarationsdatei enthält keinen ausführbaren Code. Öffnen Sie die Implementierung, um einen Haltepunkt zu setzen.',
  'debug.sourceTest':
    'Das laufende Programm lädt diese Testdatei nicht. Starten Sie die Tests mit Debugger, um hier anzuhalten.',
  'debug.sourceGenerated':
    'Diese erstellte Datei ist hier nicht verfügbar. Öffnen Sie die ursprüngliche Quelldatei zum Debuggen.',
  'debug.breakpointDisabled': 'Haltepunkt deaktiviert',
  'debug.removeBreakpoints': 'Alle Haltepunkte entfernen',
  'debug.breakpointOptions': 'Haltepunktoptionen',
  'debug.caughtExceptions': 'Abgefangene Ausnahmen',
  'debug.uncaughtExceptions': 'Nicht abgefangene Ausnahmen',
  'debug.editCondition': 'Bedingung bearbeiten',
  'debug.editLogMessage': 'Protokollnachricht',
  'debug.editHitCount': 'Trefferzahl',
  'debug.hitCountUnavailable': 'Dieser Knoten unterstützt keinen Trefferzähler',
  'debug.disableBreakpoint': 'Haltepunkt deaktivieren',
  'debug.enableBreakpoint': 'Haltepunkt aktivieren',
  'debug.approvalPending': 'Wartet auf Genehmigung im Debugger',
  'debug.recordPointRefused':
    'Das Speichern des Aufzeichnungspunkts konnte nicht bestätigt werden: {reason}',
  'debug.breakpointUnbound':
    'Das Programm hat noch keinen Code für diese Zeile geladen. Prüfen Sie die Quellzuordnung oder warten Sie, bis dieser Code geladen wird.',
  'debug.watchLastValue': 'Letzter Wert: {value}',
  'debug.logPoint': 'Protokollpunkt: {message}',
  'node.delegation.ownerStopped': 'Von dir gestoppt. Starte ihn in seinem Chat neu.',
  'node.delegation.paused': 'Pausiert; kann fortgesetzt werden',
  'node.delegation.ownerAnswer':
    'Ihre Genehmigung wird erwartet. Antworten Sie auf dieser Karte oder öffnen Sie den untergeordneten Chat. Der Manager kann nicht für Sie antworten.',
  'node.delegation.pausedPrompt':
    'Zeitlimit beim Warten auf Ihre Antwort erreicht. Beantworten Sie die gespeicherte Anfrage und setzen Sie den Entwickler fort.',
  'node.delegation.pausedLimit':
    'Zeitlimit erreicht. Senden Sie eine Nachricht, um im selben Chat und Worktree fortzufahren.',
  'node.manager.session': 'Sitzung',
  'node.manager.sourceWorktree': 'Quellarbeitsbaum',
  'node.manager.command': 'Befehl',
  'node.manager.invalidCommand':
    'Geben Sie entweder argv oder command und ein Ziel an: project_id oder worktree_id. Prüfen Sie die Bereiche von timeout_ms und output_bytes.',
  'node.manager.invalidIntegration':
    'Die Integration benötigt Quell- und Ziel-Worktree, beide Branch-Namen und aktuelle vollständige Commit-Hashes.',
  'node.manager.invalidCancel': 'Geben Sie session_id und run_id des abzubrechenden Befehls an.',
  'node.manager.branches': 'Branches',
  'node.manager.folder': 'Ordner',
  'node.manager.sourceHead': 'Quell-Commit',
  'node.manager.targetHead': 'Ziel-Commit',
  'node.manager.evidence': 'Genaue Genehmigungsdetails',
  'node.manager.exitCode': 'Exit-Code: {code}',
  'node.manager.output': 'Ausgabe',
  'node.manager.truncated': 'Frühere Ausgabe wurde gekürzt.',
  'settings.metadata.nodeManagerRun': 'Befehl ausführen',
  'settings.metadata.nodeManagerStatus': 'Befehl prüfen',
  'settings.metadata.nodeManagerCancel': 'Befehl abbrechen',
  'settings.metadata.nodeManagerIntegrate': 'Branch integrieren',
  'node.manager.pending': 'Wartet auf Freigabe',
  'node.manager.exited': 'Beendet',
  'node.manager.timedOut': 'Zeitlimit erreicht',
  'node.manager.denied': 'Abgelehnt',
  'node.error.backpressure':
    'Die Verbindung konnte der Knotenausgabe nicht folgen. Verbinden Sie sich erneut, um aufzuholen.',
  'node.manager.folderMissing':
    'Dieser Ordner kann auf dem Knoten nicht für Befehle verwendet werden.',
  'node.manager.bypassDisabled':
    'Der Knoten benötigt eine Bestätigung, da sein Modus ohne Rückfrage deaktiviert ist.',
  'node.manager.integrateBypassUpdate':
    'Dieser Knoten kann nicht ohne Rückfrage integrieren. Ein Knoten-Update ist erforderlich; nichts wurde übermittelt.',
  'node.manager.resultExit': '{state} · Exit {code}',
  'node.manager.integrationLegacyApproval':
    'Diese Knotenversion fragt noch vor dem Integrieren. Aktualisiere den Knoten, um ohne Nachfrage zu integrieren.',
  'node.manager.integrationContextUpdate':
    'Aktualisiere den Knoten auf Version 0.4.49 oder neuer, um aus diesem Chat ohne Managersitzung zu integrieren.',
  'settings.metadata.checkDiagram': 'Diagramm prüfen',
} satisfies TranslationCatalog
