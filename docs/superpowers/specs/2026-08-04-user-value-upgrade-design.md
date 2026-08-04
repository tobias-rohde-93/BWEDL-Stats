# BWEDL Stats User-Value Upgrade Design

## Ziel

Die bestehende statische PWA wird so erweitert, dass Nutzer schneller zu ihrem nächsten echten Spiel, eindeutig zum richtigen Saisonstand und mit stabilen teilbaren Links zu relevanten Ansichten gelangen. Bestehende Stärken wie Profil, H2H, Match Center, Vereinsarchiv und Ewige Tabelle bleiben erhalten und werden gezielt besser zugänglich gemacht.

## Ausgangslage

Der Live-Audit am 04.08.2026 hat folgende konkrete Probleme bestätigt:

- Das persönliche Dashboard zeigt einen späteren spielfreien Termin ohne Uhrzeit vor früheren echten Spielen mit vollständigem Termin.
- Ranglisten und persönliche Saisonstatistiken verwenden bewusst den behaltenen Vorjahresstand 2025/26, kennzeichnen ihn aber nur im Datenstatus der Seitenleiste.
- Ein frisch geladener Hash-Link wie `#ranking/Bezirksliga` behält zwar seine URL, rendert beim Start aber das Dashboard.
- Ohne gespeichertes Profil erklärt das Dashboard den persönlichen Mehrwert nicht und zeigt im Wesentlichen die Top-20-Liste.
- Die Vereinsnavigation enthält mehr als 50 Einträge, Vereinsdetailseiten rendern sehr große Termin- und Archivmengen gleichzeitig, und mobile Nutzer müssen entsprechend weit scrollen.
- Ranglisten besitzen keine lokale Suche, Mindestspielzahl oder alternative Sortierung.
- Änderungen seit dem letzten Besuch sind trotz der regelmäßig aktualisierten Daten nicht sichtbar.
- Mehrere Navigationselemente sind klickbare `div`-Elemente ohne vollständige Tastatursemantik.
- Der mobile Inhaltsbereich kann wenige Pixel horizontal scrollen.

## Gewählter Ansatz

Die App wird inkrementell innerhalb der bestehenden HTML-, CSS- und JavaScript-Struktur erweitert. Ein Framework-Wechsel oder eine komplette Neuentwicklung wäre für eine statische, offlinefähige PWA unverhältnismäßig und würde Datenpipeline, Service Worker und vorhandene Tests unnötig gefährden.

Gemeinsam genutzte reine Hilfsfunktionen für Termine, Routen, Saisonstatus, Ranglistenfilter und Besuchssnapshots werden aus dem großen UI-Renderer herausgelöst. Die bestehende `bundle_v31.js` bleibt Einstiegspunkt und orchestriert Rendering sowie Ereignisse. Dadurch können kritische Regeln unabhängig vom DOM getestet werden, ohne das funktionierende Hostingmodell zu verändern.

## Funktionsumfang

### 1. Verlässliche Terminlogik

Ein gemeinsamer Terminselektor verarbeitet alle Spiele des gespeicherten Teams.

- Spiele gegen `Spielfrei`, `Freilos` oder vergleichbare Platzhalter gelten nicht als echte nächste Spiele.
- Zukünftige echte Spiele mit Datum und Uhrzeit werden chronologisch zuerst sortiert.
- Echte Spiele mit Datum, aber ohne Uhrzeit, folgen am passenden Kalendertag.
- Echte Spiele ohne parsebaren Termin erscheinen nach allen datierten Spielen als `Termin offen`.
- Vergangene und bereits abgeschlossene Spiele erscheinen nicht in der Vorschau.
- Dashboard und Vereinsdetailseite nutzen dieselbe Terminregel.

Die erste Karte heißt nur dann `Nächstes Spiel`, wenn sie ein echtes Spiel enthält. Spielfreie Termine dürfen separat als Hinweis dargestellt werden, aber nicht als Gegner oder Hauptaktion.

### 2. Eindeutiger Saisonkontext

Die bestehende Retain-Regel der Datenpipeline bleibt unverändert: Die Saison 2026/27 wird für Ranglisten erst aktiviert, wenn Bezirksliga, A-, B- und C-Klasse jeweils mindestens einen gültigen Eintrag enthalten.

Die UI liest den Ranglistenstatus aus `data_status` und zeigt einen wiederverwendbaren Saisonhinweis direkt in:

- Dashboard-Profil und Formkurve,
- Spieltags-Siegern,
- jeder Ranglistenseite,
- H2H-Auswertungen, sofern Ranglistendaten verwendet werden,
- Match Preview, sofern Aufstellungen aus Ranglistendaten berechnet werden.

Beim Retain-Stand lautet die Kernaussage: `Vorjahresstand 2025/26 – die neue Rangliste wird erst nach vollständigem Saisonstart aktiviert.` Aktuelle Spielpläne bleiben klar als Saison 2026/27 gekennzeichnet. Historische Karrierekennzahlen werden davon getrennt beschriftet.

### 3. Stabile Direktlinks und Teilen

Der Startvorgang wertet `location.hash` aus, validiert Routentyp und ID und rendert die angeforderte Ansicht. Nur ein leerer, unbekannter oder ungültiger Hash fällt auf das Dashboard zurück.

Unterstützte Direktlinks umfassen Dashboard, Profilwahl, Liga, Ligapokalarchiv, Rangliste, Verein, Vereinsübersicht, H2H, Ewige Tabelle, Tools, Match Preview und Wiki. IDs werden URL-kodiert und defensiv dekodiert. Browser-Zurück und -Vorwärts bleiben mit `history.state` synchron.

Relevante Seiten erhalten eine Aktion `Teilen`. Sie nutzt `navigator.share`, wenn verfügbar, und fällt sonst auf das Kopieren der kanonischen URL zurück. Die Rückmeldung ist nicht-blockierend und verwendet keinen JavaScript-Alert.

### 4. Persönliches Spielcenter

Das nächste echte Spiel wird zur primären Dashboard-Aktion. Die Karte zeigt Gegner, Wettbewerb, Heim/Auswärts, Datum, Uhrzeit und – soweit Vereinsdaten verfügbar sind – die Spielstätte.

Aktionen:

- `Match analysieren` öffnet die vorhandene Match Preview mit vorausgewähltem eigenem Team und Gegner.
- `Route öffnen` erzeugt einen externen Kartenlink aus der vorhandenen Vereinsadresse, ohne zusätzliche Geocoding-Abhängigkeit.
- `Kalender` erzeugt clientseitig eine `.ics`-Datei mit Termin, Teams, Wettbewerb und Spielstätte.
- `Teilen` teilt den stabilen Direktlink mit einer kurzen Spielzusammenfassung.

Fehlende Adresse, Uhrzeit oder Gegner blenden nur die jeweils nicht mögliche Aktion aus. Die übrige Karte bleibt nutzbar.

### 5. Einstieg ohne Profil

Vor der Top-20-Liste erscheint für Nutzer ohne gespeichertes Profil eine kompakte, dominante Einstiegskarte:

- Nutzenversprechen: persönliche Statistiken, Form und nächste Spiele,
- Primäraktion `Mein Profil einrichten`,
- Sekundärhinweis, dass die Auswahl ausschließlich lokal im Browser gespeichert wird.

Nach erfolgreicher Profilauswahl verschwindet die Karte. Die vorhandene Profilwahl und Mannschaftsbestätigung bleiben erhalten.

### 6. Kompaktere Navigation und Vereinsseiten

Die Seitenleiste zeigt unter `Vereine` nur `Vereinsübersicht öffnen`, ein Suchfeld und höchstens die zuletzt oder als Favorit geöffneten Vereine. Die vollständige Liste bleibt in der Vereinsübersicht verfügbar.

Die Vereinsübersicht erhält Suche und Ortsfilter. Ein optionaler Kartenlink je Verein nutzt die bestehende Adresse; eine eingebettete Karte oder zusätzliche Kartendienst-Abhängigkeit ist nicht Teil dieses Umfangs.

Vereinsdetailseiten werden schrittweise offengelegt:

- maximal fünf nächste echte Spiele initial, mit Teamfilter und `Alle anzeigen`,
- letzte Ergebnisse getrennt,
- Kader kompakt und suchbar,
- Archivjahre standardmäßig eingeklappt,
- unvollständige Ligapokalzeilen ohne Gegner oder Ergebnis werden als `Daten unvollständig` gekennzeichnet und nicht als reguläres Ergebnis präsentiert.

### 7. Nutzbare Ranglisten

Jede Ranglistenseite erhält eine lokale Werkzeugleiste mit:

- Namens- und Vereinssuche,
- Sortierung nach Rang, Gesamtpunkten, Durchschnitt und Spielen,
- Mindestspielzahl,
- Aktion `Meine Position`, wenn ein Profil gespeichert ist.

Die offizielle Rangreihenfolge bleibt die Standardansicht. Alternative Sortierungen werden ausdrücklich als Analyseansicht beschriftet und verändern keine offiziellen Rangnummern. Die eigene Zeile wird hervorgehoben und bei `Meine Position` in den sichtbaren Bereich gescrollt.

### 8. Änderungen seit dem letzten Besuch

Die App speichert ausschließlich lokal einen kompakten Snapshot aus Datenversionskennung, Ergebnissummen, Ranglistenwert des eigenen Profils und nächstem echten Spiel.

Beim nächsten erfolgreichen Laden wird der alte Snapshot mit dem aktuellen Stand verglichen. Das Dashboard zeigt nur relevante, nachweisbare Änderungen:

- neue oder geänderte Ergebnisse in Wettbewerben des eigenen Teams,
- veränderte persönliche Rangposition oder Punkte,
- geänderter nächster Spieltermin,
- allgemein neuer Datenstand, wenn keine persönlichere Aussage möglich ist.

Der neue Snapshot wird erst nach erfolgreicher Dateninitialisierung gespeichert. Beschädigte oder veraltete Local-Storage-Werte werden ignoriert und ersetzt. Es gibt keine Push-Benachrichtigungen und kein Benutzerkonto.

### 9. Barrierefreiheit und mobile Stabilität

- Navigationseinträge und interaktive Karten werden echte `button`- oder `a`-Elemente oder erhalten gleichwertige Rolle, Tastatursteuerung und Fokusdarstellung.
- Aufklappbereiche führen `aria-expanded` und `aria-controls`.
- Suchergebnisse sind per Pfeiltasten, Enter und Escape bedienbar.
- Statusänderungen wie Kopieren oder Filtern werden über eine dezente `aria-live`-Region gemeldet.
- Farbe bleibt nie der einzige Träger eines Zustands.
- Der Hauptinhalt erhält keine unnötige horizontale Scrollleiste; breite Datentabellen bleiben in einem klar begrenzten Tabellen-Scroller horizontal bedienbar.
- Bewegungen respektieren `prefers-reduced-motion`.

Die bestehende dunkle, sportlich-technische Gestaltung bleibt erhalten. Neue Komponenten verwenden die vorhandenen Blau-, Grün- und Goldakzente sowie die bestehende Kartensprache, damit kein visueller Bruch entsteht.

## Komponenten und Verantwortlichkeiten

- `app_utils.js`: reine Funktionen für Terminreihenfolge, Platzhaltererkennung, Hash-Routen, Saisonhinweise, ICS-Inhalte und Snapshot-Differenzen.
- `bundle_v31.js`: Zustandsverwaltung, Rendering, DOM-Ereignisse und Integration der Hilfsfunktionen.
- `style.css`: wiederverwendbare Klassen für Saisonbanner, Aktionen, Filterleisten, Fokuszustände, Akkordeons und responsive Tabellen.
- `index.html`: Einbindung der Hilfsfunktionen, globale Live-Region und notwendige semantische Grundstruktur.
- `sw_v31.js`: Cacheliste um neue statische Dateien ergänzen und Cacheversion anheben.
- `tests/test_user_value_utils.js`: ausführbare Node-Tests der reinen Regeln.
- fokussierte bestehende oder neue Vertragstests: Start-Routing, Dashboard-Einstieg, Saisonkennzeichnung, Ranglistenwerkzeuge, Navigation und Service-Worker-Cache.

## Datenfluss

1. Statische Datendateien und `data_status` werden wie bisher vor dem Bundle geladen.
2. Die App validiert beim Start den Hash und initialisiert die zugehörige Ansicht.
3. Reine Hilfsfunktionen erzeugen aus vorhandenen Liga-, Ranglisten- und Vereinsdaten konsistente View-Modelle.
4. Renderer bauen daraus Saisonbanner, Terminaktionen, Filteransichten und Änderungsmeldungen.
5. Nutzerpräferenzen und Besuchssnapshot bleiben ausschließlich in Local Storage.
6. Scraper, Validierungsgrenzen, Veröffentlichungstransaktion und Sechs-Stunden-Workflow bleiben unverändert.

## Fehlerbehandlung

- Ungültige Direktlinks fallen mit einer verständlichen Meldung auf das Dashboard zurück.
- Nicht parsebare Termine werden nicht verworfen, sondern nach datierten Spielen als `Termin offen` geführt.
- ICS- oder Share-Fehler zeigen eine nicht-blockierende Rückmeldung; die Seite bleibt bedienbar.
- Fehlende Vereinsadresse deaktiviert nur die Routenaktion.
- Ungültige Snapshotdaten werden entfernt, ohne das Rendering zu blockieren.
- Filter ohne Treffer zeigen einen erklärenden Leerzustand und eine Zurücksetzen-Aktion.

## Teststrategie

Jede Verhaltensänderung folgt Red-Green-Refactor.

Automatisiert werden mindestens geprüft:

- chronologische Auswahl echter Spiele inklusive Spielfrei, fehlender Uhrzeit und offenem Termin,
- Erzeugung gültiger ICS-Felder und Escape-Regeln,
- Start auf allen unterstützten Hash-Routen sowie Fallback ungültiger Links,
- korrekter Retain-Hinweis aus `data_status`,
- Ranglistenfilter, Sortierungen und Mindestspielzahl ohne Änderung offizieller Rangwerte,
- Snapshotvergleich für Ergebnisse, Rangposition und Terminänderung,
- Profil-Einstiegskarte nur ohne gespeichertes Profil,
- semantische Navigation und mobile Schließlogik,
- neue Assets im Service-Worker-Cache.

Danach laufen die vollständige Python- und Node-Test-Suite, JavaScript-Syntaxprüfungen und ein Browser-Rundgang auf Desktop sowie `390 x 844`. Der Browser-Rundgang umfasst Erstbesuch, Profilwahl, nächstes Spiel, Kalenderdatei, Teilen-Fallback, Direktlink-Neuladen, Ranglistenfilter, Vereinsseite, Tastaturnavigation, Offline-Neuladen und Prüfung auf Anwendungsfehler in der Konsole.

## Nicht-Ziele

- Kein Login, Serverkonto oder Cloud-Synchronisierung.
- Keine Push-Benachrichtigungen.
- Keine Änderung der Ranglisten-Aktivierungsregel.
- Kein neues Frontend-Framework.
- Keine neue Karten- oder Geocoding-API.
- Keine Änderung an den BWEDL-Quellen oder der Sechs-Stunden-Pipeline, außer wenn ein separater reproduzierbarer Datenfehler festgestellt wird.
- Kein automatischer Commit oder Push generierter Nutzerdaten aus der Oberfläche.

## Akzeptanzkriterien

- Das Dashboard bezeichnet immer das chronologisch nächste echte Spiel als `Nächstes Spiel`; Spielfrei ist nie Hauptgegner.
- Vorjahresdaten sind überall dort direkt gekennzeichnet, wo Nutzer sie interpretieren.
- Ein geteilter Direktlink rendert nach frischem Laden genau die referenzierte gültige Ansicht.
- Nutzer können das nächste Spiel analysieren, teilen, als Kalenderdatei speichern und bei vorhandener Adresse eine Route öffnen.
- Nutzer ohne Profil erkennen den persönlichen Mehrwert und gelangen mit einer Aktion zur Einrichtung.
- Vereins- und Archivseiten zeigen zunächst eine kompakte, filterbare aktuelle Ansicht.
- Ranglisten lassen sich lokal durchsuchen, analysieren und zur eigenen Position springen.
- Das Dashboard zeigt belastbare Änderungen seit dem letzten Besuch ohne Serverkonto.
- Primärnavigation und Suchinteraktionen sind mit Tastatur und sichtbarem Fokus bedienbar.
- Bei `390 x 844` scrollt der Seitenrahmen nicht horizontal; nur explizite Tabellencontainer dürfen horizontal scrollen.
- Bestehende Datenpipeline-, Archiv-, Profil-, Navigations- und PWA-Tests bleiben grün.

## Rollback

Die Erweiterungen werden in getrennten, testbaren Schritten umgesetzt. Neue Hilfsdatei, UI-Komponenten, Routingstart und Service-Worker-Version können jeweils separat zurückgenommen werden. Datenformate und Scraper bleiben kompatibel, sodass ein UI-Rollback keine veröffentlichten BWEDL-Daten verändert.
