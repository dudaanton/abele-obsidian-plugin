export const streamBErrors = {
  'streamBError.diffLineBudget':
    'Dieser Vergleich überschreitet die Zeilenbegrenzung. Öffne jede Seite einzeln.',
  'streamBError.diffDistinctLines':
    'Zu viele unterschiedliche Zeilen für einen sicheren Vergleich. Öffne jede Seite einzeln.',
  'streamBError.2858c527cf': 'Kein Token gesendet: {v0}',
  'streamBError.6e74ee0eb3': 'GitHub hat das Token bei der Anfrage nach {v0} nicht akzeptiert.',
  'streamBError.69e3e92a4b': 'GitHub benötigt ein Token, um {v0} anzuzeigen.',
  'streamBError.d10c3511be':
    'Möglicherweise falsch eingegeben, abgelaufen oder widerrufen. Ein neues unter Abele-Einstellungen → GitHub hinterlegen.',
  'streamBError.1de332c345': 'Unter Abele-Einstellungen → GitHub ein Token hinzufügen.',
  'streamBError.bc5d838c06': 'Das GitHub-Anfragelimit für dieses Token ist ausgeschöpft.',
  'streamBError.27106edf75':
    'Das GitHub-Limit für Anfragen ohne Token (60 pro Stunde) ist ausgeschöpft.',
  'streamBError.3d90b66898': 'Es wird um {v0} zurückgesetzt.',
  'streamBError.0af4d24f00': '{v0}Ein Token erhöht es auf 5000.',
  'streamBError.9bbd87f900':
    'Diese Organisation verwendet Single Sign-on; das Token wurde dafür nicht autorisiert.',
  'streamBError.85596cf701': 'Hier autorisieren: {v0}',
  'streamBError.98f3a2fad0':
    'Auf GitHub autorisieren: Settings → Personal access tokens → Token → Configure SSO.',
  'streamBError.525a59abdd':
    '{v0} akzeptiert nur Anfragen von zugelassenen IP-Adressen; die Adresse dieses Geräts steht nicht auf der Liste. Das Token selbst ist gültig.',
  'streamBError.cc22835989':
    'Über das erlaubte Büronetz oder VPN verbinden oder einen Organisationsinhaber um Aufnahme dieser Adresse bitten. Dasselbe Token funktioniert weiterhin auf einem Gerät aus der Liste; deshalb kann es anderswo funktionieren und hier nicht.',
  'streamBError.8a4e28441e':
    '{v0} lehnt fein abgestufte Tokens ab, deren Gültigkeit die erlaubte Dauer überschreitet{v1}.',
  'streamBError.deabf54f35':
    'Gültigkeit des Tokens auf GitHub verkürzen — der Link steht unten in der GitHub-Meldung — oder ein neues mit kürzerer Gültigkeit erstellen.',
  'streamBError.23ae822430':
    '{v0} akzeptiert grundsätzlich keine fein abgestuften persönlichen Zugriffstokens.',
  'streamBError.867dbd63be':
    'Nur ein Organisationsinhaber kann das ändern (Organisationseinstellungen → Personal access tokens). Bis dahin können ihre Repositorys mit diesem Tokentyp nicht gelesen werden.',
  'streamBError.cb67a9c5e8': '{v0} akzeptiert keine klassischen persönlichen Zugriffstokens.',
  'streamBError.4d980c1a74':
    'Stattdessen ein fein abgestuftes Token erstellen und die Organisation als Resource owner wählen.',
  'streamBError.6c498d7d3c':
    '{v0} schränkt ein, welche Apps ihre Daten lesen dürfen; auch dieses Token ist davon betroffen.',
  'streamBError.c81e0c8baa':
    'Ein fein abgestuftes Token mit der Organisation als Resource owner verwenden oder einen Inhaber um Freigabe bitten.',
  'streamBError.9909829c59': 'GitHub hat diesem Token den Zugriff auf {v0} verweigert.',
  'streamBError.e6f3c80ade':
    'Ein fein abgestuftes Token wird so abgelehnt, wenn die Berechtigung fehlt, dieses Repository nicht freigegeben ist oder als Resource owner das eigene Konto statt der Organisation gewählt wurde: Es erreicht nur die Repositorys des bei der Erstellung gewählten Inhabers. Ein Token, das noch auf Organisationsfreigabe wartet, liest nur öffentliche Daten.',
  'streamBError.e048ee47d3': 'GitHub hat den Zugriff auf {v0} verweigert.',
  'streamBError.33dca72ade': 'Das Repository ist leer: Es enthält noch keine Dateien.',
  'streamBError.67711ed6a1': 'GitHub hat nichts für {v0} gefunden.',
  'streamBError.690d176ada':
    'Entweder existiert es nicht oder das Token kann es nicht sehen: Bei einem privaten Repository ohne Zugriff meldet GitHub „nicht gefunden“ statt „verboten“. Prüfen, ob das Repository im Token ausgewählt ist, dessen Resource owner die besitzende Organisation ist (ein Token des eigenen Kontos sieht deren private Repositorys nicht) und ob bei erforderlicher Freigabe ein Inhaber das Token genehmigt hat.',
  'streamBError.8dc365ec07':
    'Bei einem privaten Repository ein Token unter Abele-Einstellungen → GitHub hinzufügen.',
  'streamBError.6c1e1f640d': 'GitHub antwortete mit {v0} auf die Anfrage nach {v1}.',
  'streamBError.f6a1bafa2b': 'Die Organisation',
  'streamBError.679b703e6c': 'Die Organisation {v0}',
  'streamBError.d860f8f34f': ' ({v0} Tage)',
  'streamBError.65aab2aa1d': 'Benötigt: {v0}',
  'streamBError.5247198e11': 'GitHub meldete: „{v0}“',
  'streamBError.e3ee915a8e': ' und ',
  'streamBError.e1a3e78cb5': ' oder ',
  'streamBError.22b988efd0': 'Kein Anbieter mit Modellen eingerichtet',
  'streamBError.a07cc0a057': 'Kein Agent eingerichtet',
  'streamBError.f731db85bb': 'Commit, Branch oder Tag eingeben.',
  'streamBError.7b457d7047': 'GitHub konnte diese Referenz keinem Commit-SHA zuordnen.',
  'streamBError.dfd5e00f0d': 'Die Quelle konnte diese Referenz keinem Commit-SHA zuordnen.',
  'streamBError.fe0a3cb7dd': 'Vergleich abgebrochen',
  'streamBError.9171ce437b': 'GitHub konnte das Ziel keinem Commit-SHA zuordnen.',
  'streamBError.0929738b5b': 'Die Datei fehlt auf beiden Seiten des Vergleichs.',
  'streamBError.46fc41c9da': 'Datei oder Referenz nicht vorhanden.',
  'streamBError.082cf53674': 'GitHub hat keine Inhaltskennung gesendet.',
  'streamBError.dfd0b68e6f':
    'GitHub hat keine unterstützten Inhaltsdaten geliefert. Die API kann diese Datei begrenzen; öffne eine der Seiten auf GitHub.',
  'streamBError.b2ceed2130':
    'Diese Datei überschreitet das Speicherlimit für Vergleiche. Öffne jede Seite einzeln.',
  'streamBError.4f737e4ab7': 'Die Datei wurde im Vergleichsbaum nicht gefunden.',
  'streamBError.4e7bc5e16d':
    'Der Submodul-Commit hat sich geändert. Kein Repository wird automatisch geöffnet.',
  'streamBError.4d89c4f1ef':
    'Die Dateigröße ist unbekannt oder überschreitet das Speicherlimit für Vergleiche. Öffne jede Seite einzeln.',
  'streamBError.61af9130fa':
    'Große Datei: Lade den Text ausdrücklich oder öffne jede Seite einzeln.',
  'streamBError.02c437689c':
    'Binärdatei oder nicht unterstützte Kodierung. Textzählungen sind nicht verfügbar (—).',
  'streamBError.71722fe4dc':
    'Viele Zeilen: Lade den Diff ausdrücklich oder öffne jede Seite einzeln.',
  'streamBError.cb3497631d': 'Die Zeilenenden von Basis und Ziel unterscheiden sich (CRLF / LF).',
  'streamBError.f1497cb1f1':
    'Nur der Git-LFS-Zeigertext. Die Nutzdaten werden nicht heruntergeladen.',
  'streamBError.ed3d83967c': 'Nur der Symlink-Text. Dem Link wird nicht gefolgt.',
  'streamBError.a97a5c3772': 'Dieser Teil ist nicht für die Offline-Nutzung gespeichert. {v0}',
  'streamBError.0e5771af81': 'Wähle einen konkreten Repository-Speicherort.',
  'streamBError.74656128ba':
    'Nicht alle Commits des Pull Requests konnten aufgelistet werden. Öffne den Dienst, um den Rest zu lesen.',
  'streamBError.d4470c2927': 'Die Diskussion wurde nicht gefunden.',
  'streamBError.bcb47435bb':
    'GitHub hat das Repository nicht vollständig aufgelistet — es ist zu groß für einen Download zur Suche.',
  'streamBError.52ab21f79c':
    'Das Repository ist bei diesem Commit {v0} groß und überschreitet das Limit von {v1} unter Abele-Einstellungen → GitHub.',
  'streamBError.908ff82a4d': 'Die GitHub-Codesuche wurde zurückgesetzt',
  'streamBError.d353a99eb4': 'Abgebrochen',
  'streamBError.6151f41d37':
    'Die GitHub-Codesuche benötigt ein Token. Füge es in Abele-Einstellungen → GitHub hinzu.',
  'streamBError.fc0bde16c0': 'GitHub hat keinen Baum für {v0} angegeben.',
  'streamBError.cae3891ed5':
    'GitHub hat keinen vollständigen Baum für {v0} gesendet. Versuche es erneut, wenn er verfügbar ist.',
  'streamBError.6ab83b4090': 'GitHub hat keinen Repository-Baum gesendet.',
  'streamBError.61746dfc8f': 'GitHub hat keinen vollständigen Baum der obersten Ebene gesendet.',
  'streamBError.9ae33c33a2':
    'Die aktuellen Dateien haben sich während des Vergleichs geändert. Vergleiche sie erneut.',
  'streamBError.a890b77334':
    'Dieses Node-Repository ist nicht mehr verfügbar. Verbinde dich erneut oder wähle einen Arbeitsbereich.',
  'streamBError.1d3298ac1d':
    'Die Repository-Berechtigung hat sich während des Lesens geändert. Aktualisiere ausdrücklich.',
  'streamBError.b46591df0d':
    'Diese Arbeitsbaum-Ansicht ist abgelaufen. Aktualisiere, um die aktuellen Dateien zu prüfen.',
  'streamBError.1a2309dd33': 'Diese Repository-Revision ist abgelaufen. Aktualisiere ausdrücklich.',
  'streamBError.b930e16c73':
    'Diese Repository-Liste überschreitet das Anzeigelimit. Grenze den Pfad oder die Suche ein.',
  'streamBError.df8a5b2002': 'Der Node konnte keine vollständige Liste zurückgeben.',
  'streamBError.7de42eef4a':
    'Es ist kein Standard-Branch bekannt. Wähle einen Branch zum Vergleichen.',
  'streamBError.696ab2ea7b':
    'Dieser Arbeitsbereich fehlt oder ist nicht verfügbar. Wähle einen anderen.',
  'streamBError.888e010715': 'Diese aufbewahrte Datei ist zu groß für die automatische Anzeige.',
  'streamBError.6018e8db9e': 'Binärdatei · keine Textvorschau.',
  'streamBError.96018da9a1': 'Diese Datei ist zu groß für die automatische Anzeige.',
  'streamBError.88e5c20cd0':
    'Dieser erste Commit überschreitet das Anzeigelimit für geänderte Dateien. Durchsuche stattdessen seinen Baum.',
  'streamBError.b0f4afdb21': 'Diese Datei überschreitet das Zeilenlimit für Diffs.',
  'streamBError.d2999e7b21': 'Für diese Datei ist kein Text-Patch verfügbar.',
  'streamBError.b2d5677c39':
    'Dateien können sich während der Ansicht ändern. Aktualisiere die Daten.',
  'streamBError.f3d48d14b9': 'Änderungen seit dem gemeinsamen Vorfahren.',
  'streamBError.9da9b97d87': 'Binärdatei oder große Datei · öffne jede Seite einzeln.',
  'streamBError.cace6bbbbf':
    'das Token ist für {v0} eingestellt (Server-Einstellung), dies liegt aber auf {v1}.',
  'streamBError.ad2081e8e0':
    'ein Token ist eingestellt, aber im Schlüsselbund dieses Geräts fehlt es. Füge es erneut in Abele-Einstellungen → GitHub ein oder entsperre synchronisierte Schlüssel unter Abele-Einstellungen → Übertragen → Synchronisierte Schlüssel.',
  'streamBError.bb2a67e714':
    '„{v0}“ ist kein Repository. Gib Eigentümer/Name oder einen Link in das Repository an.',
  'streamBError.9cfa0264aa':
    '{v0} ist weder github.com noch der oben eingestellte Server und wird hier deshalb nicht gelesen.',
  'streamBError.a51346d01d': 'Auch über GraphQL angefragt und dort ebenfalls abgelehnt: „{v0}“',
  'streamBError.2eac8a11cd': 'Auch über GraphQL angefragt: {v0}',
  'streamBError.6b52eb9983':
    'Dasselbe Token hat das Element selbst gelesen. Es fehlt also keine Token-Berechtigung: Der Server lehnt diese eine Anfrage ab. Der Rest wird angezeigt; öffne diesen Teil auf GitHub.',
  'streamBError.2528c26585':
    'Dasselbe Token hat das Element selbst gelesen. Dafür ist {v0} (Lesen) nötig — eine der für diese Anfrage akzeptierten Berechtigungen. Es fehlt also keine Token-Berechtigung: Der Server lehnt diese eine Anfrage ab. Der Rest wird angezeigt; öffne diesen Teil auf GitHub.',
  'streamBError.1209bb12ff': 'In dieser Version für diesen Dienst nicht verfügbar.',
  'streamBError.d4d581aba2': 'Der Dienst hat keinen unveränderlichen Commit zurückgegeben.',
  'streamBError.f1fe763173': 'Dieser Pfad ist eine Datei.',
  'streamBError.b305654ab9': 'Dieser Pfad ist ein Ordner.',
  'streamBError.2f27e1a646': 'Der Dienst hat keinen vollständigen Wurzelbaum zurückgegeben.',
  'streamBError.dae9ef12db': 'Der Dienst hat keine Kennung des Ordnerbaums zurückgegeben.',
  'streamBError.f308135e99': 'Der Dienst hat keinen vollständigen Ordnerbaum zurückgegeben.',
  'streamBError.cd278c1617': 'Dieses Ziel gehört zu einem anderen Repository oder Server.',
  'streamBError.43d93bea97': 'Diese Referenz wurde beim Dienst nicht gefunden.',
  'streamBError.0495ef01d3': 'Ungültiger Forgejo-Server.',
  'streamBError.b51a173612': 'Ungültiger Forgejo-API-Pfad.',
  'streamBError.0f69117eda': 'Zugangsdaten dürfen nicht in einer API-URL stehen.',
  'streamBError.de772eddd4': 'Der Forgejo-Dienst ist nicht erreichbar.',
  'streamBError.9759c8d4b7':
    'Forgejo hat die Anfrage umgeleitet; prüfe die eingestellte Serveradresse.',
  'streamBError.8988c7148a': 'Forgejo hat eine unlesbare Antwort zurückgegeben.',
  'streamBError.5f32006dc8': 'Ungültiges Forgejo-Seitenlimit.',
  'streamBError.31f4a37ff9': 'Ungültige Forgejo-Seitenantwort.',
  'streamBError.1ea731dddc': 'Ungültige Basisadresse des Git-Dienstes.',
  'streamBError.5e61d71bfc': 'Ungültiger Pfad des Git-Dienstes.',
  'streamBError.8e9468f2f5': 'Das Repository gehört zu einem anderen Server.',
  'streamBError.ee5b3b4622': 'Ungültiger GitHub-Repository-Pfad.',
  'streamBError.3aef34f6c5': 'Für diese Anbieterversion gibt es keinen geprüften Schemavertrag.',
  'streamBError.48c142c51b': 'Die Forgejo-Verbindung wurde entfernt oder geändert.',
  'streamBError.7351aeb8ca':
    'Die Forgejo-Verbindung wurde entfernt oder geändert; lade diesen Tab neu.',
  'streamBError.233dcaa94f':
    'Das Verbindungstoken ist auf diesem Gerät nicht verfügbar; entsperre synchronisierte Schlüssel oder füge das Token hinzu.',
  'streamBError.b83e5c8317': 'Ungültiger Forgejo-Pfadabschnitt.',
  'streamBError.8016408637': 'Ungültiges Forgejo-Repository.',
  'streamBError.43ad51d8f0': 'Forgejo hat die Anfrage abgelehnt ({v0}).',
  'streamBError.399ef88060': 'Bei diesem Dienst sind weitere Ergebnisse verfügbar.',
  'streamBError.01fa8fb2a8': 'Dieser Eintrag ist ein Link, keine normale Datei.',
  'streamBError.af130c9cfc': 'Diese Datei ist zu groß für die Anzeige.',
  'streamBError.fe05b9bbe4': 'Der Dienst hat den Dateiinhalt nicht zurückgegeben.',
  'streamBError.9ff28c9fad': 'Binärdatei.',
  'streamBError.329a3b9f4a': 'Binärdatei oder Datei ohne UTF-8-Kodierung.',
  'streamBError.1e226ce2d8': 'Das Konto konnte nicht geprüft werden.',
  'streamBError.90fa9dca4e': 'Die Zugriffsprüfung ist fehlgeschlagen.',
  'streamBError.ec18ec18e8':
    'Verwende ein Token mit Lesezugriff für diesen Vorgang und dieses Repository.',
  'streamBError.596c52f1eb': 'Verbindung fehlgeschlagen',
  'streamBError.78b93810bf': 'Ordner konnte nicht gelesen werden',
  'streamBError.6097572d7b': 'Node konnte nicht geladen werden',
  'streamBError.2bf254e296': 'Datei konnte nicht gelesen werden',
  'streamBError.c4dfa2b119': 'Verlauf konnte nicht geladen werden',
  'streamBError.a11a2d3c13': 'Commit konnte nicht geladen werden',
  'streamBError.dd4481bfbe': 'Ungültiger regulärer Ausdruck: {v0}',
  'streamBError.921180cd63': 'Dieser Dienst liefert eine Dateiübersicht ohne Text-Patch.',
  'streamBError.3dd6c9269c': 'Der Dienst hat für diese Datei keinen Text-Patch bereitgestellt.',
  'streamBError.edafd9ed12':
    'GitHub hat diesem Token die Diffs verweigert. Die Dateiliste kam über die GraphQL-API, die keine Diffs liefert; öffne den Pull Request auf GitHub, um sie zu lesen.',
  'streamBError.591f69a90b':
    'GitHub hat diesem Token den Vergleich verweigert. Die Commits kamen über die GraphQL-API, die keine geänderten Dateien liefert; öffne den Vergleich auf GitHub, um sie zu lesen.',
  'streamBError.c169cf0a0c':
    'Die GitHub-API vergleicht nur ab der Verzweigung der Branches. Dies zeigt daher die Änderungen seitdem, nicht die beiden Versionen nebeneinander, wie die zwei Punkte im Link verlangen. Öffne dafür GitHub.',
  'streamBError.fa96a837ce': 'Der neue Chat-Tab wurde geschlossen.',
  'streamBError.93215f7df9': 'Das Kopieren des Chats wurde abgebrochen.',
  'streamBError.2f113794db':
    'Das delegierte Protokoll ist nicht verfügbar. Öffne den Quellchat erneut und versuche es noch einmal.',
  'streamBError.8f777786c2': 'Das delegierte Protokoll konnte nicht gespeichert werden.',
  'streamBError.f327a9464f': 'Der neue Chat konnte nicht gespeichert werden.',
  'streamBError.2e42fe1f95': 'Die kontextuelle Darstellung benötigt eine zugelassene Absicht.',
  'streamBError.d132590f46': 'Die Bestätigung konnte nicht gespeichert werden. Versuche es erneut.',
  'streamBError.e4184853d0': 'Der Eigentümer des ZIP-Aufrufs hat sich geändert',
  'streamBError.960fe81dfd': 'ZIP-Schreibvorgänge erfordern eine Genehmigung',
  'streamBError.cf2e4ddaac': 'Die Branch-Grenze hat sich vor der Fortsetzung geändert',
  'streamBError.55409a75b4':
    'Die Berechtigung konnte nicht gespeichert werden. Der Vorgang wurde nicht gestartet.',
  'streamBError.854a5410e5': 'Dieser Chat arbeitet. Warte, bis sein Durchgang beendet ist.',
  'streamBError.3865c0186d': 'Die Antwort ist nicht mehr verfügbar.',
  'streamBError.c85c1160fb':
    'Dieser Chat wurde andernorts geändert. Öffne ihn vor Änderungen erneut.',
  'streamBError.c5908dd3f8':
    'Diese Antwort wird gerade geändert. Versuche es nach Abschluss erneut.',
  'streamBError.8d825ed127': 'Nur gespeicherte Modellantworten können hervorgehoben werden.',
  'streamBError.e6d5371478':
    'Die erfasste Auswahlversion hat sich geändert. Wähle die Passage erneut aus.',
  'streamBError.9ed6e7f6a7': 'Die Ankerkennung muss im Chat eindeutig sein.',
  'streamBError.392bcbe1e7': 'Die erfasste Unterhaltung hat sich geändert.',
  'streamBError.a2091f71aa':
    'Diese Nachricht wird gerade geändert. Versuche es nach Abschluss erneut.',
  'streamBError.0d2f0c2bed': 'Nur gespeicherte Chat-Nachrichten können Auswahlanker haben.',
  'streamBError.36e8bead5c':
    'Nur gespeicherte Benutzer- oder Modellnachrichten können Auswahlanker haben.',
  'streamBError.eda0e6622d':
    'Die erfasste Unterhaltung hat sich geändert. Öffne sie vor dem Verknüpfen erneut.',
  'streamBError.c93dfca065':
    'Speichere den übergeordneten Chat, bevor du die Node-Delegation genehmigst',
  'streamBError.132388cd4d': 'Die übergeordnete Unterhaltung hat sich geändert',
  'streamBError.7d35f0db1e':
    'Das Ergebnis einer Link-Veröffentlichung ist unklar. Öffne den Chat erneut, um vor dem Schreiben die gespeicherte Quelle zu prüfen.',
  'streamBError.e0774494e5': 'Wähle zuerst Wörter in einer Modellantwort aus.',
  'streamBError.5d1f47524d': 'Wähle eine Hervorhebungsfarbe.',
  'streamBError.218b14f26c': 'Die Hervorhebung ist nicht mehr verfügbar.',
  'streamBError.9b77d73c1b': 'Warte, bis dieser Chat seinen Durchgang beendet hat.',
  'streamBError.9390b6928f':
    'Dieser Vorschlag wurde angenommen. Schließe die Anwendung ab und nutze dann Rückgängig bei der übergeordneten Antwort.',
  'streamBError.879f176aec': 'Dieser Vorschlag wartet nicht mehr auf eine Entscheidung.',
  'streamBError.dee0fd6565':
    'Dieser Chat enthält noch ungespeicherte Änderungen. Versuche vor dem Schließen erneut zu speichern.',
  'streamBError.80d27f4757':
    'Die Erweiterung kann nicht bestätigt werden, während die Unterhaltung geändert wird.',
  'streamBError.97188092c4':
    'Die gespeicherte Diskussion ist nicht verfügbar oder hat ihre Kennung geändert.',
  'streamBError.ab47750c92': 'Die Diskussion hat sich beim Bestätigen der Erweiterung geändert.',
  'streamBError.cfe8f23fc1':
    'Die lokale Arbeit hat sich geändert. Bestätige die gespeicherte Unterhaltung, bevor du die Erweiterung erneut versuchst.',
  'streamBError.92f4905c24': 'Die Quelle der Auswahl ist nicht mehr geöffnet.',
  'streamBError.0bda7be5eb':
    'Dieser Chat hat sich beim Zurückkehren geändert. Öffne den Link erneut.',
  'streamBError.4d4b0467c4':
    'Dieser Chat wurde andernorts geändert. Beende oder speichere die lokale Arbeit, bevor du zur Auswahl zurückkehrst.',
  'streamBError.963ca9ee5b': 'Die neue Diskussion konnte nicht geladen werden.',
  'streamBError.73cf5550f9':
    'Die Diskussionskennung für diese Datei konnte nicht ermittelt werden.',
  'streamBError.1fa876b018': 'Der Kommentar wurde geöffnet. Versuche das Umbenennen erneut.',
  'streamBError.774edb1289': 'Der übergeordnete Chat ist nicht verfügbar.',
  'streamBError.d7e135b1f7': 'Die übergeordnete Antwort ist nicht verfügbar.',
  'streamBError.7190d9a20e':
    'Die ausgewählte Passage ist nicht verfügbar. Beginne einen neuen Kommentar.',
  'streamBError.e5ad2cbf8c': 'Der übergeordnete Chat wurde geöffnet. Prüfe den Vorschlag erneut.',
  'streamBError.8d7c0dc93d':
    'Dieser Rückgängig-Plan gehört nicht mehr zu diesem Chat; öffne ihn erneut',
  'streamBError.81d9f5765b': 'Die authentifizierte Node-Verbindung wurde nicht abgeschlossen.',
  'streamBError.ce4159a6ef':
    'Für diese Datei ist kein Text-Patch verfügbar (binär, leer, umbenannt oder abgeschnitten).',
  'streamBError.cdc8d9cfa0':
    'Die GitHub-Verbindung wurde geändert; versuche es mit den aktuellen Zugangsdaten erneut.',
  'streamBError.2ea0bf550b': 'GitHub-Anfragen sind bis {v0} pausiert. Versuche es dann erneut.',
  'streamBError.0eb5b3ed5a': 'Das Ziel der GitHub-Anfrage ist nicht zulässig.',
  'streamBError.1c867e3040': '{v0} ist nicht erreichbar.',
  'streamBError.6a1efa8857': 'GitHub hat diese Anfrage umgeleitet; sie wurde nicht wiederholt.',
  'streamBError.c2ad5cd823': 'GitHub hat eine ungültige Umleitung zurückgegeben.',
  'streamBError.6523b94909': 'GitHub hat auf ein unsicheres Ziel umgeleitet.',
  'streamBError.dae8766b06': 'GitHub hat {v0} ohne Inhalt gesendet.',
  'streamBError.a0ebbf6573': 'Ungültige Bild-URL.',
  'streamBError.04b71aa0cc': 'GitHub hat {v0} gesendet, wo ein Bild erwartet wurde.',
  'streamBError.147dd984fc':
    'GitHub benötigt eine angemeldete Anfrage, um {v0} über GraphQL zu lesen. Füge ein Token in Abele-Einstellungen → GitHub hinzu.{v1}',
  'streamBError.c7437fbf46': 'GitHub hat eine leere Antwort zurückgegeben.',
  'streamBError.c2583399b1': 'Die GitHub-Verbindung wurde gelöscht oder ist unbekannt.',
  'streamBError.8e264bfe49': 'Dieser Anbieter ist im GitHub-Adapter nicht verfügbar.',
  'streamBError.74e2c88c85': 'Dieses Bild konnte nicht gelesen werden',
  'streamBError.fbba4c81db': 'Die Bilddekodierung ist auf diesem Gerät nicht verfügbar',
  'streamBError.35732e49c9': 'In diesem Bild wurde keine Node-Einladung gefunden',
  'streamBError.f5b8b2ba78': 'Die Unterhaltung konnte von diesem Dienst nicht gelesen werden.',
  'streamBError.9acce75256':
    'Die Pull-Request-Reviews konnten von diesem Dienst nicht gelesen werden.',
  'streamBError.545311af41': 'Unbekannter Streaming-Fehler',
  'streamBError.0f56130f3d': 'Ein unbekannter Fehler ist aufgetreten',
  'streamBError.338214ff83': 'Für den Agenten „{v0}“ ist kein verwendbares Modell eingestellt',
  'streamBError.cbbb077a00':
    'Dieses Ziel ist nicht mehr verfügbar. Aktualisieren Sie seinen Ordner.',
  'streamBError.d15771e911': 'Git-Aktionen erfordern einen aktualisierten Knoten.',
  'streamBError.54a4d809c8': 'Aktualisieren Sie zuerst den Ordner.',
  'streamBError.607e975b14': 'Eine andere Git-Aktion läuft noch.',
  'streamBError.97797a06f1': 'Hier gibt es keinen Commit als Ausgangspunkt für einen Branch.',
  'streamBError.890a0701f9': 'Pull Requests erfordern einen aktualisierten Knoten.',
  'streamBError.8a0e599716': 'Dieses Ziel gehört zu einer anderen Knotenregistrierung.',
  'streamBError.e1b43e1573':
    'Die Dateien dieses Ziels wurden nicht lokal aufbewahrt. Verbinden Sie sich erneut, um sie zu laden.',
  'streamBError.b4836687ce':
    'Verbinden Sie sich erneut, um nicht aufbewahrte Einträge dieses Ordners zu laden.',
  'streamBError.29f751894a':
    'Aktualisieren Sie den Ordner, bevor Sie seine abgelaufene Auflistung fortsetzen.',
  'streamBError.fd3e95b2aa': 'Die Seitennavigation des Knotens ist nicht vorangekommen',
  'streamBError.d6473017d0':
    'Diese Datei ist auf diesem Gerät nicht aufbewahrt. Verbinden Sie sich erneut, um sie zu öffnen.',
  'streamBError.cf3ad06448':
    'Offline · aufbewahrte Version. Verbinden Sie sich erneut, um den aktuellen Inhalt abzurufen.',
  'streamBError.4566a5a6f4': 'Die Dateiantwort gehört zu einem anderen Ziel.',
  'streamBError.91f21e6d95':
    'Der Knoten gibt nicht an, an welches Remote dieser Branch übertragen wird.',
  'streamBError.474dc449ab':
    'Ein Pull Request benötigt einen Branch statt eines losgelösten Commits.',
  'streamBError.9ca0d465a5':
    'Änderungszeiten und Branch-Abweichungen erfordern einen aktualisierten Knoten.',
  'streamBError.d4a2fc884b': 'Der Branch-Status erfordert einen aktualisierten Knoten.',
  'streamBError.6714d255c9':
    'Dieser Ordner überschreitet das Baumlimit von 10.000 Einträgen. Nutzen Sie den Repository-Browser mit Seitennavigation.',
  'streamBError.b98a7f8f5f': 'Die Bildvorschau ist auf 4 MiB begrenzt.',
  'streamBError.9bc23eb575': 'Ein Vergleich aktueller Dateien erfordert eine Beobachtung.',
  'streamBError.aecd43ae62':
    'Vergleiche von Arbeitsbäumen ohne Commits erfordern einen aktualisierten Knoten.',
  'streamBError.8647963b04': 'Für diese Datei ist kein Textvergleich verfügbar.',
  'streamBError.23d06ee9cc':
    'Diese Datei lässt sich nicht in der begrenzten Textvorschau anzeigen.',
  'streamBError.6e57d7786b':
    'Lösen Sie den Konflikt im Code-Editor oder Repository-Browser; ein einzelner Vergleich würde eine Seite auslassen.',
  'streamBError.a3b91e1549':
    'Die Vorschau eines vorgemerkten Bildes erfordert das Lesen eines Git-Indexobjekts, was diese Verbindung nicht unterstützt.',
  'streamBError.d822bad866': 'Ein normaler Ordner hat keinen Git-Verlauf.',
  'streamBError.aa6abd6309': 'Dieser Patch enthält keine Textblöcke innerhalb der Begrenzung.',
  'streamBError.0e5dd7f8f9':
    'Der aufbewahrte Patch passt nicht zu dieser Datei. Aktualisieren Sie für einen neuen Vergleich.',
  'streamBError.ac7deb53ca': 'Der Knoteninhalt ist ungültig oder zu groß',
  'streamBError.3e93167395': 'Unvollständiger Knoteninhalt',
  'streamBError.61353475a2': 'Diese Datei lässt sich nicht im begrenzten Texteditor bearbeiten',
  'streamBError.99ca5e24c2':
    'Der Editor akzeptiert bestehende UTF-8-Dateien bis 32768 Zeichen außerhalb der Git-Metadaten',
  'streamBError.83795aa299':
    'Der lokale Entwurf überschreitet das Inhaltslimit; kopieren Sie ihn vor dem Schließen',
  'streamBError.164ef4c4d9':
    'Dieser Speichervorgang ist ungeklärt; prüfen Sie sein ursprüngliches Ergebnis vor der Bearbeitung',
  'streamBError.bcc3e13a88':
    'Verbinden Sie sich vor dem Speichern erneut; Ihr lokaler Entwurf bleibt erhalten.',
  'streamBError.26e0c3b094':
    'Prüfen Sie die aktuelle Version und wählen Sie sie ausdrücklich als Grundlage, bevor Sie erneut speichern',
  'streamBError.a5f9367699':
    'Der Entwurf überschreitet das UTF-8-Speicherlimit von 32768 Zeichen oder enthält nicht unterstützten Text. Ihr lokaler Entwurf bleibt erhalten.',
  'streamBError.6077692b27': 'Ungültige Identität der Dateispeicherbestätigung',
  'streamBError.67ccffde77':
    'Dieser Speichervorgang ist ungeklärt; seine Vorbedingung kann nicht geändert werden',
  'streamBError.3d90fa2b83':
    'Dieser Speichervorgang ist ungeklärt; bewahren Sie seinen Entwurf und seine Nachweise auf',
  'streamBError.dfd2326f20': 'Diese Datei lässt sich nicht bearbeiten',
  'streamBError.04e25ee78d': 'Dieser Speichervorgang ist ungeklärt',
  'streamBError.94302699b3':
    'Der lokale Entwurf konnte nicht gespeichert werden. Lassen Sie dieses Fenster offen und kopieren Sie Ihren Text vor dem Schließen.',
  'streamBError.e61aa4bddc': 'Die Dateiansicht wurde vor der Zulassung des Speicherns geändert',
  'streamBError.3d0331c807': 'Die Dateiansicht wurde vor dem Abgleich des Entwurfs geändert',
  'streamBError.896b98b01e': 'Es gibt keinen lokalen Entwurf zum Beibehalten',
  'streamBError.17dd70d322': 'invalid_anchor: wählen Sie höchstens 200 Zeilen pro Kommentar',
  'streamBError.ad8aa99210': 'Warten auf die übermittelte Überprüfung',
  'streamBError.2d8481c0c6':
    'Die Überprüfung überschreitet die Knotenlimits: höchstens 32 Kommentare, 200 Zeilen und 2000 Zeichen pro Kommentar',
  'streamBError.7a17a125e6': 'Geben Sie einen Kommentar ein',
  'streamBError.3bf18401ad':
    'Öffnen Sie vor dem Senden einer Überprüfung eine Arbeitsbereichssitzung',
  'streamBError.535c73617c':
    'Das Chat-Ziel ist nicht bereit. Es wurde nichts gesendet. Öffnen Sie die Überprüfung vor dem Senden erneut.',
  'streamBError.d7e2b0292d':
    'Der aufbewahrte Ordnervorgang hat sich geändert. Prüfen Sie ihn vor einem erneuten Versuch.',
  'streamBError.a0a1c7d80c':
    'Das Löschresultat ist unbekannt. Verbinden Sie sich erneut und prüfen Sie den ursprünglichen Löschvorgang.',
  'streamBError.fcff0cdbbc':
    'Der ursprüngliche Löschvorgang wurde abgelehnt: {v0}. Seine Bestätigung bleibt erhalten.',
  'streamBError.96b7c749ee':
    'Dieser Client unterstützt das Entfernen verwalteter Arbeitsbäume nicht.',
  'streamBError.35eb88371d':
    'Das Löschresultat ist unbekannt. Behalten Sie das Ziel und prüfen Sie denselben Vorgang vor einem erneuten Versuch.',
  'streamBError.8d6b5aefb7':
    'Der Arbeitsbaum hat sich geändert. Aktualisieren und prüfen Sie ihn vor dem Löschen.',
  'streamBError.29f8c77828':
    'Die Knotenregistrierung fehlt. Verbinden Sie ihn erneut über das Knotenpanel.',
  'streamBError.eed78d87c1':
    'Der geschützte lokale Kanal muss eine exakte Loopback-Adresse verwenden.',
  'streamBError.5f035cba63': 'Ungültiger Port des lokalen Knotens',
  'streamBError.8f82f94ebf': 'Der Bildinhalt ist für die Vorschau nicht verfügbar.',
  'streamBError.576e97984e':
    'Der Knoten kennt den Status dieser Git-Aktion nicht mehr. Aktualisieren Sie vor einem erneuten Versuch, um das Ergebnis zu prüfen.',
  'streamBError.23563064bf': 'Aktualisieren Sie den Ordner vor dem Verwerfen.',
  'streamBError.1248b93aec': 'Es gibt noch nichts zu übertragen: Der Branch enthält keine Commits.',
  'streamBError.b2c46ecdf3': 'Aktualisieren Sie den Knoten, um Daten vom Remote abzurufen.',
  'streamBError.5e20368923': 'Aktualisieren Sie den Knoten, um hier einen Branch zu erstellen.',
  'streamBError.b43838f570': 'Es ist kein Tab in der linken Seitenleiste verfügbar.',
  'streamBError.4ec802bae5':
    'Verbinden Sie diesen Knoten erneut, bevor Sie sein Repository öffnen.',
  'streamBError.0702fbb835': 'Ein Knoten-Repository wurde erwartet',
  'streamBError.69096135bb':
    'Der Knoten ist offline; verbinden Sie ihn vor Repository-Lesezugriffen des Agenten erneut.',
  'streamBError.0e3c3b3571':
    'Die Repository-Navigation stimmt nicht mit der genehmigten Quelle überein.',
  'streamBError.4d299e3ab0':
    'Der lokale Entwurf wurde in einer anderen Ansicht geändert. Kopieren Sie den sichtbaren Text, bevor Sie den gemeinsamen Entwurf neu laden.',
  'streamBError.3cdea71657': 'Binärdatei: keine Textvorschau.',
  'streamBError.9ba095fdb1':
    'Diese Datei erfordert das ausdrückliche Laden eines größeren Umfangs im Repository-Browser.',
  'streamBError.e12006025a': 'Der Knoten hat eine unvollständige Auflistung zurückgegeben',
  'streamBError.7d3850fd71': 'Unvollständiger Verlauf',
  'streamBError.f87df21e8e':
    'Der Chat wurde verschoben. Es wurde nichts gesendet. Prüfen Sie das aktuelle Ziel vor dem erneuten Senden.',
  'streamBError.573c6d85e4': 'Der Chat ist geöffnet. Fassen Sie ihn über seine Sitzung zusammen.',
  'streamBError.79654b25ba': 'Ein delegierter Lauf lässt sich nicht als Chat speichern oder laden.',
  'streamBError.705ef1d387': 'Der Vault der Diskussion hat sich während der Suche geändert.',
  'streamBError.3fe6722d6b': 'Dieser Chat muss vor dem Speichern erneut geöffnet werden.',
  'streamBError.653067e964': 'Die Diskussion wurde während der Vorbereitung gelöscht.',
  'streamBError.f43a0fbfa4': 'Die Diskussionsversion hat sich geändert.',
  'streamBError.3fcb34cb40': 'Die Diskussionsversion wurde verschoben.',
  'streamBError.8bbaf67475':
    'Die Diskussion ändert sich weiter. Öffnen Sie sie nach Abschluss der Synchronisierung erneut.',
  'streamBError.33d4df464a':
    'Die Diskussionsidentität wurde andernorts geändert. Gleichen Sie die Änderungen vor dem Speichern ab.',
  'streamBError.0550ea75bd':
    'Diese Diskussion wurde andernorts geändert. Gleichen Sie die Änderungen vor dem Speichern ab.',
  'streamBError.bd60b807a8': 'Nur ein Chat lässt sich als Chatprotokoll speichern.',
  'streamBError.1117c0caf4':
    'Öffnen Sie diesen Chat erneut, bevor Sie seinen Aufmerksamkeitsstatus speichern.',
  'streamBError.8f516a3c74':
    'Die Diskussionsidentität hat sich beim Speichern geändert. Gleichen Sie die Änderungen vor erneutem Speichern ab.',
  'streamBError.1af2ceac85': 'Der Chat ist nicht verfügbar.',
  'streamBError.9c6ece335c':
    'Dieser Lauf wurde andernorts geändert. Öffnen Sie ihn vor Änderungen erneut.',
  'streamBError.d0994129e6':
    'Die Auswahlversion hat sich geändert. Öffnen Sie den Chat vor einer erneuten Auswahl erneut.',
  'streamBError.746178d21f': 'Versions- und Projektionsidentitäten dürfen nicht leer sein',
  'streamBError.ed46dd4b52':
    'Die Auswahlprojektion hat sich geändert. Verwenden Sie einen kompatiblen Renderer.',
  'streamBError.c65ee43131': 'Die Ankeridentität muss eindeutig sein',
  'streamBError.65a4ef0134':
    'Die Annotationsposition in dieser Quellversion lässt sich nicht nachweisen.',
  'streamBError.c40ccc6302':
    'Der umbenannte Kartenpfad lässt sich nicht sicher in einem Wikilink darstellen.',
  'streamBError.e894e2a984': 'Das Ziel des zugeordneten Links ist nicht verfügbar.',
  'streamBError.53e7279cb6': 'Der umbenannte Link würde den angezeigten Text ändern.',
  'streamBError.c6c2d4011f':
    'Dieser Kartenpfad lässt sich nicht sicher als Wikilink darstellen. Die Karte bleibt erhalten.',
  'streamBError.7cebc26215':
    'Wählen Sie Wörter innerhalb einer Zeile aus. Die Karte bleibt erhalten.',
  'streamBError.9d5338e70f':
    'Wörter in Code oder bestehenden Links lassen sich nicht sicher verknüpfen. Die Karte bleibt erhalten.',
  'streamBError.378c4d115b': 'Die Version der Linkzuordnung ist nicht verfügbar.',
  'streamBError.c6b341f583':
    'Die Verknüpfungsquelle hat sich beim Umbenennen der Karte geändert. Öffnen Sie sie vor Änderungen erneut.',
  'streamBError.ae22638387': 'Keine Karte unter {v0}. Es wurde nichts verknüpft.',
  'streamBError.c64a25b1e7': 'Diese Verknüpfungswiederherstellung ist nicht verfügbar.',
  'streamBError.b4c33a7187':
    'Dieser älteren Wiederherstellung fehlt eine erfasste Auswahl. Wählen Sie die Quelle erneut aus.',
  'streamBError.5294b23ea9':
    'Die Gesprächsidentität fehlt oder ist doppelt vorhanden. Wählen und öffnen Sie die Quelle vor dem Verknüpfen erneut.',
  'streamBError.937df32b6e': 'Die Karte unter {v0} ist nicht verfügbar. Es wurde nichts verknüpft.',
  'streamBError.1bf6bcdd28': 'Die gespeicherte Quellnachricht ist nicht verfügbar.',
  'streamBError.fbbba2cf78': 'Der dauerhaft gespeicherte Quellanker ist nicht verfügbar.',
  'streamBError.265ca86a61': 'Diese Auswahl hat bereits einen Kartenlink.',
  'streamBError.633d52e3cb':
    'Der Quellrenderer hat sich geändert. Wählen Sie die Quelle erneut aus.',
  'streamBError.b82437d2ea':
    'Dieser Link lässt sich mit dem aufgezeichneten inversen Vorgang nicht entfernen.',
  'streamBError.04fe344540': 'Die Branch-Grenze stimmt nicht mehr mit ihrer Fortsetzung überein',
  'streamBError.fa7d4d15ec': 'Die Branch-Grenze hat keine aufgezeichnete Fortsetzung',
  'streamBError.9fdbe22680':
    'Der ausgewählte Aufruf hat kein aufgezeichnetes Ergebnis für diese Branch-Grenze',
  'streamBError.c66ba4f778':
    'Das ausgewählte Ergebnis passt nicht zum Durchgang an der Branch-Grenze',
  'streamBError.c321617b3f': 'Das ausgewählte Ergebnis hat keinen Assistentendurchgang',
  'streamBError.aba841b1a9':
    'Die Branch-Grenze des Assistenten hat keinen aufgezeichneten Durchgang',
  'streamBError.2791c36446':
    'Eine Branch-Kontextgrenze muss auf eine Assistentennachricht oder einen abgeschlossenen Aufruf folgen',
  'streamBError.2a38171bba': 'Ein Aufruf vor der Branch-Grenze hat kein aufgezeichnetes Ergebnis',
  'streamBError.2b71f61299': 'Öffnen Sie diesen Chat vor Änderungen erneut.',
  'streamBError.065c492383':
    'Dieser Chat wurde andernorts geändert. Öffnen Sie ihn vor dem Speichern erneut.',
  'streamBError.40172d0726':
    'Der Chat ist geöffnet. Aktualisieren Sie seine Links über die Sitzung.',
  'streamBError.1a2dbbb5a6': 'Der Diskussionsort muss ein zum Vault relativer Pfad sein.',
  'streamBError.fa179ed984': 'Speichern Sie diesen Chat, bevor Sie seinen Knotenzugriff genehmigen',
  'streamBError.427b10788e':
    'Die Eigentümergenehmigung muss den genauen konfigurierten Zugriffseintrag und Berechtigten angeben',
  'streamBError.80385f9f65':
    'Die lokale Eigentümergenehmigung für den Knotenzugriff dieses Chats fehlt, wurde geändert oder widerrufen',
  'streamBError.f853b4f079':
    'Die Auswahl überschreitet Markdown-Formatierungen. Wählen Sie eine Passage innerhalb eines Textabschnitts aus.',
  'streamBError.bafdbeb11b':
    'Die ausgewählte Passage ist mehrdeutig. Wählen Sie mehr umgebende Wörter aus und beginnen Sie einen neuen Kommentar.',
  'streamBError.eb171d94e0': 'Die Modellantwort ist nicht verfügbar.',
  'streamBError.9647637c1d':
    'Die Antwort hat sich geändert. Fordern Sie einen neuen Vorschlag an; es wurde nichts geändert.',
  'streamBError.fa49b0d63c': 'Die ausgewählte Passage stimmt nicht mehr überein.',
  'streamBError.fcaee3188e': 'Diese Version lässt sich nicht mehr rückgängig machen.',
  'streamBError.b5535ff74d':
    'Es lässt sich nicht nachweisen, dass Kartenlinks beim Rückgängigmachen erhalten bleiben. Entfernen oder klären Sie diese zuerst; es wurde nichts geändert.',
  'streamBError.80abc63be7': 'Seit dem Rücknahme-Snapshot geändert: unangetastet belassen',
  'streamBError.4306093b59': 'Der Ordner enthält weitere Inhalte: unangetastet belassen',
  'streamBError.6afac342ef': 'Dieser Speicher unterstützt keine Rücknahme mit Versionsprüfung',
  'streamBError.5712d96570':
    'Seit dem Rücknahme-Snapshot unter {v0} geändert: dieser Wiederherstellungsschritt wurde abgelehnt',
  'streamBError.fe09e1fe71': 'Die aufbewahrte Kopie ist nicht mehr vorhanden',
  'streamBError.39ea7818db': 'Nicht leer: beibehalten',
  'streamBError.c151463743': 'Rücknahme mit Versionsprüfung ist nicht verfügbar',
  'streamBError.f23e7f24df': 'Keine aufbewahrte Kopie zum Wiederherstellen unter {v0}',
  'streamBError.a58f1e0c12':
    'Kein API-Schlüssel für die Transkription. Fügen Sie in den Spracheinstellungen einen OpenRouter-Schlüssel hinzu.',
  'streamBError.7fce93039c': 'Transkription fehlgeschlagen ({v0})',
  'streamBError.b1d3226846': 'Das Gespräch konnte nicht geprüft werden',
  'streamBError.b33ee5dc76': 'Ein Vergleich benötigt Ausgangs- und Endversion.',
  'streamBError.d9d8914a5e': 'Die Unterschiede konnten nicht berechnet werden.',
  'streamBError.c96140e89e':
    'Die Differenzberechnung konnte nicht gestartet werden. Öffnen Sie beide Seiten einzeln.',
  'streamBError.8bd81bdfdd': 'Die Dateien des Pull Requests konnten nicht geladen werden.',
  'streamBError.72bcafd83f': 'Ungültiger Speicherort des Knoten-Repositorys',
  'streamBError.19af983be6': 'Der Knoten konnte nicht verbunden werden',
  'streamBError.64d6fbbc80':
    'Ein gespeicherter Knotenstream ist nicht mehr autorisiert; aufbewahrte untergeordnete Gesprächsprotokolle lassen sich weiterhin öffnen.',
  'streamBError.5c9cd52ff0': 'Die Fernkopplung erfordert Web Locks auf diesem Gerät',
  'streamBError.6982c7def2': 'Ungültiger nicht exportierbarer Geräteschlüssel',
  'streamBError.d88eacf052':
    'Die erfasste Auswahl hat sich geändert. Wählen Sie die Passage erneut aus.',
  'streamBError.925bf88df9':
    'Die dargestellte Auswahl hat sich geändert. Wählen Sie die Passage erneut aus.',
  'streamBError.74479aa0dc': 'Die Diskussion hat einen Speicherort, aber keine Identität.',
  'streamBError.3603052616':
    'Die ältere Diskussion ist mehrdeutig. Klären Sie ihre Identität ausdrücklich vor dem Öffnen.',
  'streamBError.a32bd46d12':
    'Widersprüchliche Diskussionszuordnungen. Klären Sie die Dateien ausdrücklich.',
  'streamBError.7281f22f0a':
    'Diese alte Aufzeichnung hat keinen zugeordneten Chat. Ihr Inhalt kann einem anderen Verfasser gehören; die Datei bleibt unangetastet.',
} as const
