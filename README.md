# BWEDL Stats Dashboard

Ein interaktives Dashboard für die Dart-Ligen des BWEDL e.V.
Die Web-Version ist hier verfügbar: **[BWEDL Stats öffnen](https://tobias-rohde-93.github.io/BWEDL-Stats/)**

## Funktionen
- **Aktuelle Tabellen & Ergebnisse** aller Ligen
- **Persönliche Statistiken**: Suche nach deinem Namen, um Durchschnitt, Trend und Saisonverlauf zu sehen.
- **Match-Preview**: Plane dein nächstes Spiel mit Team-Aufstellungen.
- **Offline-Modus**: Installierbar als App (PWA) auf Android und iOS.

---

## Lokal Installieren & Daten Aktualisieren

Da die Web-Version auf statischem Hosting läuft, funktioniert der "Aktualisieren"-Button nur in der lokalen Version. Um die Ligen-Daten zu erneuern, musst du das Tool auf deinem Rechner ausführen.

### Voraussetzungen
- [Python 3.x](https://www.python.org/downloads/) muss installiert sein.
- [Git](https://git-scm.com/downloads) (optional, zum Klonen).

### Schnell-Installation (Windows)
1.  **Code herunterladen**:
    Klick oben auf den grünen Button **Code** -> **Download ZIP** und entpacke den Ordner.
2.  **Installieren**:
    Doppelklicke auf `setup.bat`. 
    *   Das Skript installiert alles nötige und erstellt eine Verknüpfung auf deinem Desktop.
3.  **Starten**:
    Klicke einfach auf die neue **"BWEDL Stats"** Verknüpfung auf deinem Desktop.

*(Voraussetzung: [Python](https://www.python.org/downloads/) muss installiert sein. Das Skript sagt dir Bescheid, falls es fehlt.)*

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
```

### Incident prüfen und beheben

1. Im fehlgeschlagenen Actions-Lauf `update_report.json`, die vier Bereichsentscheidungen und das Artefakt `update-failure-<run-id>` prüfen.
2. HTML/PNG/Trace des betroffenen Scrapers ansehen und zwischen Quellenänderung, unvollständiger Saison und technischem Fehler unterscheiden.
3. Lokal Tests und einen Dry-Run mit frischen expliziten Verzeichnissen ausführen. Die öffentlichen Dateien vor und nach dem Dry-Run per Hash vergleichen.
4. Nur die Ursache korrigieren; niemals Validierungsgrenzen umgehen oder alte Daten manuell löschen.
5. `Update Data` manuell auslösen und Bericht sowie explizite Dateiliste kontrollieren. Das Incident-Issue wird erst durch einen erfolgreichen geplanten Lauf automatisch geschlossen.

### Lokale UI-Prüfung

```powershell
python server.py
# in einem zweiten Terminal
Invoke-WebRequest http://localhost:8000/ -UseBasicParsing
```

Danach `http://localhost:8000/` im Browser öffnen und Datenstand, Spielersuche, H2H, Match Preview sowie Desktop- und Mobilansicht prüfen. Der lokale Aktualisieren-Button startet weiterhin einen echten Lauf; für eine schreibfreie Prüfung deshalb den obigen Dry-Run im Terminal verwenden.

---

## Als App auf dem Handy installieren (PWA)
1.  Öffne den **[Web-Link](https://tobias-rohde-93.github.io/BWEDL-Stats/)** auf dem Smartphone.
2.  **Android**: Klicke auf "Installieren" (oder 3 Punkte -> App installieren).
3.  **iOS**: Klicke auf "Teilen" -> "Zum Home-Bildschirm".
