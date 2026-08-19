# BWEDL Stats Dashboard

Ein interaktives Dashboard für die Dart-Ligen des BWEDL e.V.
Die Web-Version ist hier verfügbar: **[BWEDL Stats öffnen](https://tobias-rohde-93.github.io/BWEDL-Stats/)**

## Funktionen
- **Aktuelle Tabellen & Ergebnisse** aller Ligen
- **Persönliche Statistiken**: Suche nach deinem Namen, um Durchschnitt, Trend und Saisonverlauf zu sehen.
- **Match-Preview**: Plane dein nächstes Spiel mit Team-Aufstellungen.
- **Teamkalender-Abo**: Abonniere den regulären Saisonspielplan deines Profilteams.
- **Vereinsfavoriten**: Gespeicherte Vereine stehen im globalen Bereich **FAVORITEN** und unter **VEREINE → Favoriten**.
- **Offline-Modus**: Installierbar als App (PWA) auf Android und iOS.

---

## Teamkalender und Favoriten

Das Kalender-Abo gilt ausschließlich für das im lokalen Profil gespeicherte **Profilteam**. Es enthält alle vergangenen und zukünftigen regulären Ligaspiele der gesamten aktuellen Saison; **Ligapokal** und **Einzelspiel-Download** sind ausgeschlossen. Jeder Termin nennt Gegner, **Heim/Auswärts**, Uhrzeit und die bestverfügbare Adresse des Heimvereins. Eine unvollständige Adresse wird markiert; ein nicht aufgelöster Spielort wird ebenfalls klar gekennzeichnet.

Im **Dashboard** und unter **Mein Profil** öffnet **In Kalender-App öffnen** den `webcal`-Link; **HTTPS-Link kopieren** kopiert die Abonnementadresse. Für das Kalender-Abo ist eine Internetverbindung erforderlich. Der Workflow prüft und validiert die Daten alle sechs Stunden. Nur ein erfolgreicher Lauf mit geänderten Daten veröffentlicht neue statische Kalenderdateien über GitHub Pages ohne API oder Server. Kalenderanbieter bestimmen selbst ihren Abrufrhythmus und können Änderungen später übernehmen als GitHub Pages.

Vereinsfavoriten erscheinen im globalen **FAVORITEN**-Bereich und zusätzlich unter **VEREINE → Favoriten**.

---

## Betrieb und Datenaktualisierung

GitHub Pages ist die einzige produktive Laufzeit der Anwendung. Sie läuft statisch ohne API oder Server. Der Button **Aktualisieren** prüft den neuesten dort veröffentlichten Datenstand und lädt die statischen Datendateien neu. Er startet weder lokal noch auf GitHub einen Scraper.

Die BWEDL-Daten werden ausschließlich durch den GitHub-Actions-Workflow `Update Data` aufbereitet. Der geplante Lauf prüft und validiert neue Kandidaten alle sechs Stunden, bevor geänderte öffentliche Datendateien nach `main` übernommen und über GitHub Pages bereitgestellt werden.

Python und Playwright werden nur für Entwicklung, Tests und die Datenpipeline benötigt. Die öffentliche PWA benötigt keine lokale Installation und keinen lokalen Programmserver.

---

## Zuverlässige Datenpipeline

Jeder Lauf schreibt neue Scraper-Ergebnisse zuerst als Kandidaten nach `.staging/`. Die Validierung entscheidet je Datenbereich:

- `publish`: Kandidat ist gültig und darf veröffentlicht werden.
- `retain`: Der letzte gültige Stand bleibt erhalten, etwa bei noch unvollständigen Ranglisten.
- `blocked`: Plausibilitäts- oder Vollständigkeitsregeln verhindern die Veröffentlichung.
- `failed`: Scraping, Parsing oder technische Verarbeitung ist fehlgeschlagen.

Nur wenn **alle** Bereiche `publish` oder `retain` erreichen, wird der gesamte Lauf als Transaktion veröffentlicht. Bei einem Fehler werden bereits begonnene Änderungen zurückgerollt. Ein Dry-Run erzeugt Bericht und Diagnoseartefakte, ändert aber keine öffentlichen Datendateien:

```powershell
python -m pip install -r requirements.txt
python -m pytest
python update_data.py --dry-run
```

Für einen getrennten Probelauf:

```powershell
python update_data.py --dry-run --staging-dir .staging/manual-check --artifacts-dir artifacts/manual-check
```

Das Staging-Verzeichnis muss neu oder leer sein. `update_report.json` enthält Entscheidungen, Gründe und Kennzahlen; `update_status.json` ist die knappe Laufzusammenfassung. Fehlerdiagnosen liegen pro Scraper unter `artifacts/` und können HTML, PNG und Playwright-Traces enthalten. Diese Pfade sind lokal und werden nicht veröffentlicht.

### Validierungsgrenzen

- Ranglisten werden erst für die neue Saison aktiviert, wenn Bezirksliga, A-Klasse, B-Klasse und C-Klasse jeweils mindestens einen gültigen Spieler enthalten. Bis dahin zeigt die UI für den behaltenen Stand exakt `Vorjahresstand 2025/26`.
- Ligadaten brauchen mindestens 13 reguläre Ligen und je Liga alle 18 Spieltage in plausibler Reihenfolge.
- Vereinsdaten dürfen nicht leer, strukturell ungültig oder gegenüber dem letzten Stand stark geschrumpft sein. Archive dürfen keine vorhandene Saison oder zugehörige Datensätze verlieren.
- Die JSON-/JS-Paare für Ligen, Ranglisten und Vereine sowie `data_status` müssen inhaltlich exakt gleich sein.

### Automatisierung auf GitHub

Der Workflow `Update Data` läuft alle sechs Stunden und kann zusätzlich mit `workflow_dispatch` manuell gestartet werden. Erst zwei aufeinanderfolgende blockierte oder fehlgeschlagene geplante `update-data`-Läufe eröffnen beziehungsweise aktualisieren ein Incident-Issue; der nächste erfolgreiche geplante Lauf kommentiert die Erholung und schließt es. Dafür sind keine eigenen Secrets erforderlich: Der Workflow nutzt nur die eng begrenzten Rechte des von GitHub bereitgestellten Tokens.

Der Commit-Schritt darf ausschließlich diese generierten Dateien aufnehmen:

```text
league_data.json  league_data.js
ranking_data.json ranking_data.js
club_data.json    club_data.js
archive_data.js   archive_tables.js
data_status.json  data_status.js
calendar_index.json calendar_index.js
calendar_state.json calendars/
```

Lokale Tests, das Ergebnis von GitHub Actions, die Erreichbarkeit auf GitHub Pages und der tatsächliche Abruf durch einen externen Kalenderanbieter sind getrennte Nachweise. Ein grüner Test oder eine erreichbare ICS-Datei beweist noch nicht, wann Apple Calendar, Google Calendar oder Outlook eine Änderung übernimmt.

### Incident prüfen und beheben

1. Im fehlgeschlagenen Actions-Lauf `update_report.json`, die vier Bereichsentscheidungen und das Artefakt `update-failure-<run-id>` prüfen.
2. HTML/PNG/Trace des betroffenen Scrapers ansehen und zwischen Quellenänderung, unvollständiger Saison und technischem Fehler unterscheiden.
3. Lokal Tests und einen Dry-Run mit frischen expliziten Verzeichnissen ausführen. Die öffentlichen Dateien vor und nach dem Dry-Run per Hash vergleichen.
4. Nur die Ursache korrigieren; niemals Validierungsgrenzen umgehen oder alte Daten manuell löschen.
5. `Update Data` manuell auslösen und Bericht sowie explizite Dateiliste kontrollieren. Das Incident-Issue wird erst durch einen erfolgreichen geplanten Lauf automatisch geschlossen.

### Automatischer Browser-Sicherheitstest

GitHub Actions startet nach der Chromium-Installation einen Browser-Smoke-Test unter dem echten Pages-Unterpfad `/BWEDL-Stats/`. Er prüft, dass veröffentlichte Tabellen und Spielernamen nur als Text erscheinen, keine `/api/`-Abhängigkeit entsteht, Teamkalender-Links den Unterpfad behalten, Vereinsfavoriten an beiden vorgesehenen Stellen erscheinen und Profil sowie Match Setup auch aus dem Service-Worker-Cache funktionieren.

Zur optionalen Reproduktion in einer Entwicklungsumgebung:

```powershell
$env:BWEDL_BROWSER_TESTS = "1"
python -m pytest tests/test_browser_security.py -q
```

Der dabei kurzzeitig erzeugte HTTP-Server gehört ausschließlich zum Test-Harness. Die Anwendung selbst wird weiterhin nur über GitHub Pages betrieben.

---

## Als App auf dem Handy installieren (PWA)
1.  Öffne den **[Web-Link](https://tobias-rohde-93.github.io/BWEDL-Stats/)** auf dem Smartphone.
2.  **Android**: Klicke auf "Installieren" (oder 3 Punkte -> App installieren).
3.  **iOS**: Klicke auf "Teilen" -> "Zum Home-Bildschirm".
