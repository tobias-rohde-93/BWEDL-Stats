# GitHub-Pages Security and Profile Identity Hardening Design

## Ziel

Die BWEDL-Stats-Anwendung wird auf einen einzigen produktiven Laufzeitmodus reduziert: eine vollständig statische, offlinefähige PWA auf GitHub Pages. Gleichzeitig werden die bestätigte HTML-Injection-Grenze geschlossen und gespeicherte Spielerprofile eindeutig den richtigen Ranglisteneinträgen zugeordnet.

Das Paket verändert keine BWEDL-Fachregeln, keine Ranglisten-Aktivierungsregel und keine öffentlichen Datenquellen. Es härtet die Veröffentlichung und Interpretation bereits vorhandener Daten.

## Ausgangslage

Der Code-Audit am 18.08.2026 hat drei zusammenhängende Risiken bestätigt:

- `server.py` liefert im lokalen Modus das gesamte Repository aus und bietet mit `/api/update` einen nicht geschützten, parallel aufrufbaren Prozessstart. Dieser Laufzeitmodus wird zukünftig nicht benötigt, weil die Anwendung ausschließlich über GitHub Pages läuft.
- Liga- und Ranglistenscraper übernehmen externes Tabellen-`outerHTML`. Die Validierung prüft Tabellenstruktur, entfernt aber keine aktiven Inhalte oder Event-Attribute. Das Frontend setzt diese Zeichenketten anschließend mit `innerHTML` ein.
- Das Profil speichert nur `myPlayerName` und sucht später mit dem ersten Namens-Treffer. Ein Name kann in mehreren Klassen vorkommen. Auch die Quellspalte `Nr.` ist nur innerhalb einer Ranglistenklasse eindeutig und darf nicht als globaler Personen-Identifier behandelt werden.

## Gewählter Ansatz

Die bestehende statische Architektur bleibt erhalten. Sicherheitsgrenzen werden an zwei Stellen durchgesetzt:

1. Die Datenpipeline normalisiert fremde Tabellen auf einen kleinen erlaubten Tabellenumfang.
2. Das Frontend interpretiert veröffentlichte Daten weiterhin als nicht vertrauenswürdig und rendert Text über DOM-Knoten mit `textContent`.

Die Spieleridentität wird in einen eindeutigen Ranglistendatensatz und eine vorsichtig abgeleitete Personengruppe getrennt. So kann das Dashboard einen exakten Primärdatensatz auswählen und gleichzeitig echte Mehrfachmeldungen derselben Person über mehrere Klassen anzeigen, ohne unterschiedliche Spieler zusammenzuführen.

Ein kompletter Backend- oder Framework-Umbau ist nicht Bestandteil dieses Pakets. GitHub Pages bleibt alleiniger öffentlicher Anwendungsserver.

## Deployment-Vertrag

### Öffentliche Laufzeit

- Die Anwendung besteht ausschließlich aus statischen HTML-, CSS-, JavaScript-, Manifest-, Bild- und Datendateien.
- Alle Laufzeit-URLs bleiben relativ zum Dokument beziehungsweise zur Service-Worker-Registrierung, damit das GitHub-Pages-Projektverzeichnis `/BWEDL-Stats/` unterstützt bleibt.
- Der Browser ruft keine `/api/*`-Route auf und erwartet keinen Python-Prozess.
- Der Service Worker behält für veröffentlichte Datendateien eine Network-First-Strategie und für die Anwendungshülle eine kontrollierte Cache-Strategie.
- Der Aktualisieren-Button lädt ausschließlich den neuesten veröffentlichten GitHub-Pages-Datenstand. Er startet keinen Scraper und zeigt keinen lokalen Prozessfortschritt.
- Der sichtbare Datenstand stammt aus den veröffentlichten `data_status`-Artefakten. Die Oberfläche behauptet nicht, einen GitHub-Workflow gestartet zu haben.

### Veröffentlichung

- `.github/workflows/update.yml` bleibt der einzige automatische Aktualisierungspfad.
- Der Workflow führt Tests und `update_data.py` aus, veröffentlicht nur validierte Artefakte und committet geänderte Datendateien nach `main`.
- Die Anwendung benötigt weder GitHub-Token noch GitHub-API-Zugriff im Browser.
- Fehler und Fortschritt eines GitHub-Actions-Laufs bleiben in GitHub Actions beziehungsweise dessen Artefakten. Sie werden nicht als Live-Fortschritt in der öffentlichen PWA simuliert.

### Entfernung des lokalen Produktmodus

- `server.py` und `start.bat` werden entfernt.
- Die `/api/update`-Integration und das Polling von `update_status.json` werden aus `bundle_v31.js` entfernt.
- Entwicklungs- und Browserprüfungen dürfen einen beliebigen statischen Test-Webserver verwenden. Dieser ist Testinfrastruktur und kein Bestandteil der Produktarchitektur.
- README und User Guide unterscheiden klar zwischen öffentlicher GitHub-Pages-Nutzung, GitHub-Actions-Datenaktualisierung und einer optionalen statischen Vorschau für Entwickler.
- Das von `update_data.py` erzeugte `update_status.json` darf als lokale beziehungsweise Workflow-Diagnose bestehen bleiben, wird aber von der öffentlichen Anwendung nicht geladen und nicht veröffentlicht.

## HTML-Sicherheitsgrenze

### Pipeline-Normalisierung

Alle von BWEDL-Seiten übernommenen Ranglisten- und Ligatabellen durchlaufen vor der Veröffentlichung einen gemeinsamen Sanitizer.

Erlaubt sind ausschließlich:

- `table`, `thead`, `tbody`, `tfoot`, `tr`, `th` und `td`;
- reiner Textinhalt der Zellen;
- die strukturellen Attribute `colspan` und `rowspan`, sofern sie positive, begrenzte Ganzzahlen enthalten.

Entfernt werden insbesondere:

- `script`, `style`, `iframe`, `object`, `embed`, `svg`, `math`, `img`, `a`, `form` und unbekannte Elemente;
- sämtliche Event-Handler wie `onclick` oder `onerror`;
- `class`, `style`, `id`, URL-Attribute und alle übrigen Quellattribute;
- Kommentare und nicht tabellarische Wrapper.

Die Normalisierung ist deterministisch. Ein gültiger Kandidat wird erst veröffentlicht, wenn alle erwarteten Tabellen nach der Normalisierung noch die fachlich benötigte Tabellenstruktur enthalten. Ein Kandidat, dessen Nutzdaten durch die Bereinigung leer oder strukturell ungültig werden, wird blockiert und ersetzt keine zuletzt gültigen Daten.

### Frontend-Rendering

- Veröffentlichte Tabellenzeichenketten werden nie direkt einer `innerHTML`-Eigenschaft zugewiesen.
- Ein gemeinsamer Parser liest ausschließlich die erlaubte Tabellenstruktur und erzeugt neue lokale DOM-Knoten.
- Zellwerte werden ausschließlich über `textContent` gesetzt.
- Zulässige `colspan`- und `rowspan`-Werte werden nach erneuter numerischer Prüfung gesetzt.
- Dynamische Namen, Vereinsbezeichnungen, Suchergebnisse und Match-Scorer-Werte werden ebenfalls über DOM-/Text-APIs gerendert oder vor kontrollierten Templates konsequent escaped.
- Bestehende sichere Tabellenhelfer werden vereinheitlicht, statt parallele Renderer mit unterschiedlichen Vertrauensannahmen zu behalten.

Damit bleibt ein manipuliertes oder historisch bereits unsicheres Datenartefakt auch dann inert, wenn es den Pipeline-Sanitizer umgehen sollte.

## Profilidentität

### Zwei Identitätsebenen

Die Quellspalte `Nr.` ist nach bestehender Pipeline-Regel nur innerhalb einer Ranglistenklasse eindeutig. Deshalb gelten folgende Schlüssel:

- `recordKey`: normalisierte Klasse plus `id`, zum Beispiel `B-Klasse|1028`. Dieser Schlüssel identifiziert genau eine veröffentlichte Ranglistenzeile.
- `personKey`: Vereinsnummer `v_nr`, `id` und kanonischer Name. Dieser Schlüssel gruppiert nur Datensätze, bei denen alle drei Merkmale übereinstimmen.

Ein identisches `id` in unterschiedlichen Klassen genügt ausdrücklich nicht für eine Personenzuordnung. Auch `v_nr + id` genügt nicht, weil die aktuellen Daten mindestens einen Fall mit verschiedenen Namen enthalten.

### Gespeichertes Profil

Das neue lokale Profilobjekt erhält eine Schema-Version und mindestens:

- `recordKey` des gewählten Primärdatensatzes;
- `personKey` zur Ermittlung weiterer eindeutig passender Klassen;
- `id`, `vNr`, `name` und `primaryLeague` als prüfbare Fallback-Metadaten;
- die bestätigte Mannschaft, sofern sie aus den vorhandenen Vereins- und Spielplandaten eindeutig bestimmt wurde.

Der Anzeigename bleibt Nutzinhalt, ist aber kein Suchschlüssel mehr. Dashboard, eigene Ranglistenposition, Form, Match Preview und Hervorhebungen arbeiten mit dem exakten Datensatz beziehungsweise der expliziten Personengruppe.

### Profilauswahl

- Speichern ist nur nach Auswahl eines konkreten Vorschlags möglich.
- Freie Texteingabe ohne ausgewählten Datensatz wird mit einer verständlichen Meldung abgewiesen.
- Vorschläge zeigen Name, Verein und alle sicher zugeordneten Klassen, damit gleichnamige Spieler unterscheidbar bleiben.
- Hat eine Person mehrere Klassen, wählt der Nutzer ausdrücklich die primäre Klasse. Die übrigen Klassen bleiben als weitere Saisonkontexte sichtbar.
- Ändert der Nutzer den Suchtext nach einer Auswahl, wird die Auswahl ungültig, bis erneut ein Vorschlag gewählt wurde.

### Migration bestehender Profile

Beim ersten Laden mit altem `myPlayerName`:

1. Alle kanonischen Namens-Treffer werden zu sicheren Personengruppen zusammengefasst.
2. Genau eine Personengruppe wird automatisch migriert; bei mehreren Ranglistenzeilen derselben sicheren Gruppe wird eine bisher gespeicherte beziehungsweise eindeutig ableitbare Klasse bevorzugt.
3. Mehrere unterschiedliche Personengruppen, widersprüchliche Daten oder kein Treffer führen nicht zu einer automatischen Zuordnung.
4. In diesem Fall bleibt der alte Name nur als vorausgefüllte Suchhilfe erhalten und die App fordert eine einmalige Bestätigung an.
5. Nach erfolgreicher Migration wird das versionierte Profilobjekt geschrieben. Legacy-Schlüssel werden erst danach entfernt.

Beschädigte Local-Storage-Werte blockieren die App nicht. Sie werden ignoriert und führen zur normalen Profilauswahl.

## Datenfluss

1. GitHub Actions ruft die BWEDL-Quellen ab.
2. Scraper extrahieren Rohdaten und Tabellenkandidaten.
3. Der gemeinsame Sanitizer normalisiert Tabellen; die fachliche Pipelinevalidierung prüft anschließend den bereinigten Kandidaten.
4. Nur die transaktional akzeptierten Datendateien werden nach `main` committed und über GitHub Pages veröffentlicht.
5. Die PWA lädt die veröffentlichten Datendateien relativ zu ihrem GitHub-Pages-Basispfad.
6. Sichere Frontend-Renderer bauen daraus DOM-Strukturen.
7. Die Profilauflösung verbindet das lokale, versionierte Profil ausschließlich mit eindeutigen veröffentlichten Datensätzen.

## Fehlerbehandlung

- Eine entfernte oder zerstörte Tabelle blockiert den betroffenen Veröffentlichungskandidaten und behält den letzten gültigen Datenstand.
- Eine unerwartete Tabellenstruktur erzeugt Pipeline-Diagnosen, aber kein ungeprüftes öffentliches HTML.
- Kann die öffentliche Seite beim Aktualisieren keine neuen Datendateien laden, bleibt der vorhandene Offline-Stand nutzbar und die UI meldet die fehlgeschlagene Aktualisierung nicht als Erfolg.
- Ein nicht mehr vorhandener Profil-Datensatz wird nicht auf einen ähnlich benannten Spieler umgebogen. Die App fordert eine erneute Auswahl an.
- Mehrdeutige Legacy-Profile werden nie automatisch dem ersten Treffer zugewiesen.
- Local-Storage-Schreibfehler beeinträchtigen nur die Persistenz; die aktuell gewählte Ansicht bleibt bedienbar.

## Teststrategie

Jede Verhaltensänderung folgt Red-Green-Refactor.

Automatisiert werden mindestens geprüft:

- `server.py`, `start.bat`, `/api/update`, localhost-Sonderlogik und öffentliches Fortschritts-Polling sind aus dem Produktvertrag entfernt;
- alle öffentlichen Ressourcen funktionieren unter einem simulierten GitHub-Pages-Unterpfad;
- der Service Worker registriert und lädt Daten relativ zum Projektpfad;
- der Aktualisieren-Button startet ausschließlich ein öffentliches Daten-Reload und keinen Prozess;
- Pipeline-Sanitizing entfernt Skripte, Event-Attribute, URL-Attribute, SVG/MathML, Styles und verschachtelte aktive Inhalte;
- zulässige Tabellen und begrenzte `rowspan`-/`colspan`-Werte bleiben erhalten;
- nach Sanitizing leere oder strukturell unbrauchbare Tabellen werden blockiert;
- manipulierte veröffentlichte Tabellen können im echten Browser weder Script noch Event-Handler ausführen;
- `recordKey` ist pro Klasse eindeutig und gleiche IDs verschiedener Klassen kollidieren nicht;
- `personKey` gruppiert echte Mehrklassen-Treffer, führt aber den vorhandenen Fall gleicher Vereinsnummer und ID bei verschiedenen Namen nicht zusammen;
- Profilwahl akzeptiert nur einen konkreten Vorschlag und speichert die explizite Primärklasse;
- eindeutige Legacy-Profile migrieren, mehrdeutige Profile verlangen Bestätigung;
- Dashboard, Ranglistenmarkierung und Match Preview verwenden das neue Profilmodell;
- bestehende Python-, Node-, PWA-, Mobil-, Offline- und Navigationsregressionen bleiben grün.

Zusätzlich läuft ein Browser-Rundgang auf Desktop und `390 x 844` über einen GitHub-Pages-kompatiblen Unterpfad. Er umfasst Erstladen, Service-Worker-Aktivierung, Offline-Neuladen, öffentlichen Daten-Reload, eindeutige und mehrdeutige Profilwahl, mehrere Klassen sowie einen manipulierten Tabellenfixture ohne Codeausführung.

## Nicht-Ziele

- Kein lokaler Companion-Server und keine lokale Aktualisierungs-API.
- Kein Backend, Login, Cloudprofil oder serverseitiger Nutzerspeicher.
- Kein GitHub-Token oder GitHub-API-Aufruf im Browser.
- Kein manueller Workflow-Start aus der öffentlichen PWA.
- Keine Änderung des Sechs-Stunden-Zeitplans oder der bestehenden transaktionalen Veröffentlichungslogik.
- Keine vollständige Bundle-Modularisierung oder Daten-Lazy-Loading in diesem Paket; das folgt im Architekturpaket.
- Noch keine Mehrfachprofile oder Spielerfavoriten; dieses Paket schafft dafür nur das korrekte Identitätsmodell.

## Akzeptanzkriterien

- Die ausgelieferte Anwendung funktioniert vollständig als statische PWA im GitHub-Pages-Projektpfad und enthält keine Abhängigkeit von `server.py` oder `/api/*`.
- Eine öffentliche Aktualisierung lädt nur veröffentlichte Daten und suggeriert keinen lokal oder remote gestarteten Scraper.
- Kein von den BWEDL-Quellen übernommener aktiver HTML-Inhalt kann im Browser ausgeführt werden.
- Pipeline und Frontend besitzen voneinander unabhängige Schutzgrenzen gegen manipulierte Tabellen.
- Ein Profil verweist auf genau einen gewählten Ranglistendatensatz; Name allein und klassenübergreifendes `id` allein werden nicht mehr zur Zuordnung verwendet.
- Echte Mehrklassen-Einträge derselben sicheren Personengruppe sind sichtbar und besitzen eine explizite Primärklasse.
- Mehrdeutige Altprofile werden nicht falsch automatisch migriert.
- GitHub Actions aktualisiert und veröffentlicht validierte Daten weiterhin ohne neuen manuellen Schritt.
- Bestehende Offline-, Routing-, Mobil- und Fachfunktionen bleiben erhalten.

## Rollback

Die Umsetzung wird in getrennten Commits für Deployment-Bereinigung, Sanitizer/Renderer und Profilidentität vorgenommen. Das öffentliche Datenformat bleibt während der Umstellung rückwärtslesbar. Die Profilmigration entfernt Legacy-Werte erst nach erfolgreichem Schreiben des neuen Objekts. Jeder Teil kann separat zurückgenommen werden, ohne die von GitHub Actions zuletzt veröffentlichten gültigen Datendateien zu verlieren.
