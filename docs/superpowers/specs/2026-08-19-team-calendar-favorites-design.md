# Teamkalender-Abo und gemeinsame Favoriten – Design

## Ziel

BWEDL Stats soll Vereinsfavoriten zusätzlich in derselben allgemeinen Favoritenliste wie Liga- und Pokalfavoriten anzeigen. Nutzer mit einem gespeicherten Profil sollen außerdem den Ligaspielplan ihrer ausgewählten Mannschaft als dauerhaft aktualisierten Kalender abonnieren können. GitHub Pages bleibt die einzige Produktlaufzeit; es gibt keinen lokalen oder serverseitigen Produktdienst.

## Freigegebener Funktionsumfang

- Vereinsfavoriten erscheinen oben unter `FAVORITEN` und weiterhin unter `VEREINE → Favoriten`.
- Das Kalender-Abo gehört ausschließlich zur unter `Mein Profil` gewählten Mannschaft.
- Der Feed enthält alle regulären Ligaspiele der aktuellen Saison, vergangene und kommende.
- Ligapokalspiele sind ausgeschlossen.
- Der bisherige Download einzelner Spiele wird vollständig entfernt.
- `Kalender abonnieren` wird im Dashboard und unter `Mein Profil` angeboten.
- Ein Termin enthält Gegner, Heim- oder Auswärtsstatus, vollständige Begegnung, Datum, Uhrzeit, Liga, Spieltag und den Austragungsort mit der bestmöglichen öffentlichen Adresse.
- Bei einer unvollständigen Adresse bleibt der Termin enthalten und weist auf die unvollständige Anschrift hin.
- Terminänderungen aktualisieren den bestehenden Kalendereintrag, statt eine Dublette anzulegen.

## Architektur

Die bestehende validierte Sechs-Stunden-Pipeline erzeugt die Kalenderfeeds aus demselben freigegebenen Ligadatenstand, der nach GitHub Pages veröffentlicht wird. Ein fokussierter Kalendergenerator verarbeitet ausschließlich reguläre Ligen und verwendet die Vereinsdaten zur Auflösung des Austragungsortes.

Für jede Mannschaft entsteht ein dauerhafter öffentlicher Feed unter `calendars/<team-id>.ics`. Die `team-id` wird aus einer kanonischen Mannschaftsidentität abgeleitet und enthält keine Saison, damit die Abo-URL beim Saisonwechsel bestehen bleibt. Ein gemeinsam veröffentlichter Kalenderindex ordnet exakte und normalisierte Profil-Mannschaftsnamen dem Feed zu.

Die Kalenderablage, ihr Index und der zugehörige Änderungsstand werden zusammen mit den validierten Datendateien transaktional veröffentlicht. Bei einem Generierungs-, Validierungs- oder Schreibfehler bleiben sowohl der bisherige Datenstand als auch die bisherigen Kalender unverändert. Veraltete Feeddateien werden erst im Rahmen eines erfolgreichen vollständigen Austauschs entfernt.

GitHub Pages stellt die statischen ICS-Dateien direkt bereit. Es wird kein API-Endpunkt, Benutzerkonto, Hintergrunddienst oder dauerhaft laufender Server eingeführt.

## Kalendererzeugung

### Mannschafts- und Spielidentität

Der Kalenderindex verwendet dieselbe vorsichtige Normalisierung wie die vorhandene Mannschaftsauflösung. Exakte Namen und ausdrücklich bekannte Aliasnamen dürfen zusammengeführt werden; unscharfe Teiltreffer sind ausgeschlossen.

Jedes Ereignis erhält eine stabile UID aus:

- Saison,
- Liga,
- Spieltag beziehungsweise Runde,
- Ziel-Mannschaft des Feeds.

Datum, Uhrzeit, Gegner, Heim-/Auswärtsstatus und Austragungsort sind bewusst kein Teil der UID. Ändert sich einer dieser Werte innerhalb desselben Ligaspieltags, bleibt es dasselbe Kalenderereignis. Die zugrunde liegenden Ligadaten besitzen keine eigene stabile Spiel-ID; deshalb ist die Kombination aus Saison, Liga, Runde und Ziel-Mannschaft die engste verfügbare Identität. Mehr als eine reguläre Begegnung derselben Mannschaft in derselben Liga und Runde gilt als ungültige Kalenderquelle und blockiert die neue Veröffentlichung.

Ein veröffentlichter Zustandsindex hält pro UID den letzten semantischen Fingerabdruck und die `SEQUENCE`. Bei einer relevanten Änderung wird die Sequenz erhöht und `LAST-MODIFIED` aktualisiert. Unveränderte Daten erzeugen weder neue Sequenzen noch unnötige Veröffentlichungs-Commits.

### Termininhalt

Jeder Termin verwendet aus Sicht der abonnierten Mannschaft:

- `SUMMARY`: `Heimspiel gegen <Gegner>` oder `Auswärtsspiel bei <Gegner>`;
- `DTSTART`: offizieller Termin, korrekt aus `Europe/Berlin` nach UTC umgerechnet;
- `DTEND`: drei Stunden nach Spielbeginn;
- `LOCATION`: Vereinsheim, Straße und Ort des tatsächlichen Heimvereins, soweit vorhanden;
- `DESCRIPTION`: vollständige Begegnung, Heim-/Auswärtsstatus, Liga, Spieltag und bei Bedarf `Adresse unvollständig`;
- stabile `UID`, monotone `SEQUENCE`, `DTSTAMP` und `LAST-MODIFIED`;
- `STATUS:CONFIRMED` für regulär angesetzte Spiele.

Kalender- und Textwerte werden nach RFC-5545-Regeln escaped. Lange Inhaltszeilen werden nach UTF-8-Bytelänge korrekt gefaltet. Unkontrollierte Zeilenumbrüche oder zusätzliche ICS-Felder aus Quelldaten dürfen nicht eingeschleust werden.

### Unvollständige und geänderte Termine

Ein noch nie veröffentliches Spiel ohne parsebares Datum oder ohne Uhrzeit wird nicht in den Feed aufgenommen. Sobald ein vollständiger offizieller Termin vorliegt, erscheint es beim nächsten erfolgreichen Datenlauf.

Fehlen Teile einer Anschrift, wird aus den vorhandenen Feldern der bestmögliche Ort gebildet. Die Beschreibung kennzeichnet die Adresse als unvollständig; der Termin bleibt nutzbar.

Verschobene Spiele behalten ihre UID und erhalten aktualisierte Zeit-, Orts- und Änderungsfelder. Eine zuvor veröffentlichte Begegnung, die entfernt wird oder ihren vollständigen Termin verliert, bleibt für die laufende Saison mit erhöhter Sequenz als `STATUS:CANCELLED` erhalten. Wird dieselbe Begegnung erneut angesetzt, wird dieselbe UID wieder auf `STATUS:CONFIRMED` aktualisiert.

Beim Saisonwechsel wird derselbe Mannschaftsfeed auf die neue aktuelle Saison umgestellt. Ereignis-UIDs enthalten die Saison, sodass neue und alte Spielzeiten nicht kollidieren.

## Veröffentlichung und GitHub Pages

Der Kalendergenerator läuft nach erfolgreicher Datenvalidierung und vor der finalen Promotion. Er liest ausschließlich die freigegebenen Kandidaten für Liga- und Vereinsdaten. Seine Ausgaben werden zuerst in der frischen Staging-Ablage erzeugt und vollständig validiert.

Die Veröffentlichungstransaktion wird um folgende Artefakte erweitert:

- den Kalenderindex für die Browser-App;
- das Feedverzeichnis `calendars/`;
- den öffentlichen, ausschließlich aus ohnehin öffentlichen Spielplandaten bestehenden Änderungszustand.

Der bestehende GitHub-Actions-Job behält seine eng begrenzte Berechtigung `contents: write` und nimmt nur die explizit vorgesehenen Kalenderartefakte in den Daten-Commit auf. Kalenderdateien werden nicht von der Oberfläche zurückgeschrieben.

Die Feeds geben Aktualisierungshinweise für einen Sechs-Stunden-Rhythmus aus. Apple Kalender, Google Kalender, Outlook und andere Anbieter entscheiden dennoch selbst, wann sie einen Abo-Link erneut abrufen; eine sofortige Synchronisierung kann die App nicht garantieren.

## Bedienung

### Kalender-Abo

Dashboard und Profilansicht erhalten eine kompakte, zur bestehenden dunklen sportlich-technischen Gestaltung passende Kalenderaktion.

Ist eine gültige Profil-Mannschaft gespeichert und im Kalenderindex vorhanden, öffnet `Kalender abonnieren` einen barrierefreien Dialog mit:

- Mannschaftsname und Hinweis `Ligaspiele · aktuelle Saison`;
- `In Kalender-App öffnen` über die entsprechende `webcal://`-Adresse;
- `Abo-Link kopieren` als absolute HTTPS-Adresse für Anbieter mit manueller URL-Eingabe;
- einem kurzen Hinweis, dass der jeweilige Kalenderanbieter Aktualisierungsintervalle bestimmt.

Der Dialog verwendet eine echte Überschrift, native Buttons beziehungsweise Links, Fokusführung, Escape zum Schließen, Fokus-Rückgabe und eine nicht-blockierende `aria-live`-Rückmeldung beim Kopieren.

Ohne Profil führt die Stelle zu `Mein Profil einrichten`. Ist die gespeicherte Mannschaft nicht im Index vorhanden, erscheint eine verständliche Meldung und kein erfundener Link. Offline erklärt die App, dass ein Kalender-Abo eine Internetverbindung benötigt.

Die bisherige Aktion zum Herunterladen eines einzelnen `.ics`-Termins wird aus allen Spielkarten entfernt. Teilen, Route, Match Preview und Liga-Navigation bleiben unverändert.

### Favoriten

Die allgemeine Favoritenliste filtert Vereinsfavoriten nicht mehr aus. Jeder Vereinsfavorit erhält dort denselben sichtbaren Favoritenstil wie Liga- und Pokaleinträge und navigiert zur Vereinsseite.

Die kompakte Vereinsnavigation bleibt bestehen und zeigt dieselben Vereinsfavoriten weiterhin unter `VEREINE → Favoriten`. Die doppelte Sichtbarkeit ist beabsichtigt: oben als schneller globaler Favorit, im Vereinsbereich als kontextbezogener Vereinszugang.

## Fehlerbehandlung

- Unbekannte Mannschaftszuordnungen werden nicht unscharf geraten und erzeugen keinen falschen Feed.
- Eine teilweise Anschrift erzeugt einen Termin mit den vorhandenen Ortsinformationen und Warnhinweis. Ein nicht eindeutig auflösbarer Heimverein erzeugt niemals ersatzweise die Adresse der Gastmannschaft; der Termin bleibt dann ohne `LOCATION` und nennt in der Beschreibung `Austragungsort nicht auflösbar`.
- Unvollständige Terminangaben erzeugen kein Ereignis mit Mitternacht oder einer erfundenen Uhrzeit.
- Ungültige oder unsichere ICS-Ausgaben blockieren die neue Gesamtveröffentlichung.
- Ein Fehler während der Promotion rollt Kalender- und Datendateien gemeinsam auf den vorherigen Stand zurück.
- Ein fehlender Kalenderindex blockiert nicht das übrige UI-Rendering; nur die Abo-Aktion zeigt einen erklärenden Fehlerzustand.
- Clipboard-, `webcal`- oder Offline-Fehler bleiben lokal, nicht-blockierend und lassen die Seite bedienbar.

## Komponenten und Verantwortlichkeiten

- `pipeline/calendar_feeds.py`: Terminparser, Mannschafts-/Vereinsauflösung, stabile Identitäten, Änderungszustand und sichere ICS-Erzeugung.
- `pipeline/publish.py`: sicherer transaktionaler Austausch der dynamischen Kalenderablage zusammen mit den bestehenden Dateien.
- `update_data.py`: Orchestrierung der Kalendererzeugung nach erfolgreicher Validierung und vor der Promotion.
- `.github/workflows/update.yml`: explizites Staging und Committen der veröffentlichten Kalenderartefakte.
- `bundle_v31.js`: gemeinsame Favoritenliste, Kalenderindex-Auflösung, Dashboard-/Profilaktion und Dialogsteuerung; Entfernung des Einzeltermin-Downloads.
- `style.css`: fokussierte Kalenderaktions- und Dialogstile im bestehenden Designsystem.
- `index.html`: Einbindung des Kalenderindex, soweit für den synchronen App-Start erforderlich.
- `sw_v31.js`: notwendige statische App-Shell-/Index-Aktualisierung; die Vielzahl der ICS-Feeds wird nicht vollständig vorab offline gecacht.
- `USER_GUIDE.md` und `WIKI.md`: Abonnement, Anbieterhinweise, Adressgrenzen und geänderte Favoritenbeschreibung.

## Teststrategie

Jede Verhaltensänderung wird testgetrieben umgesetzt und muss zuerst durch einen gezielt fehlschlagenden Test beschrieben werden.

Automatisierte Generator- und Pipeline-Tests prüfen mindestens:

- ausschließlich reguläre Ligaspiele und vollständiger Ausschluss des Ligapokals;
- alle datierten Saisonspiele statt nur kommender Spiele;
- Gegner und korrekter Heim-/Auswärtsstatus aus Sicht jedes Feeds;
- offizielle Uhrzeit, Zeitzonenumrechnung und dreistündige Dauer;
- Adresse ausschließlich vom tatsächlichen Heimverein;
- unvollständige Adressen mit explizitem Warnhinweis;
- stabile UID bei Termin- und Ortsänderungen;
- monotone Sequenz und unveränderte Ausgabe bei identischem Datenstand;
- Absetzung und erneute Ansetzung derselben Begegnung;
- RFC-konformes Escaping, CRLF, UTF-8-Zeilenfaltung und Schutz vor ICS-Injektion;
- vollständiges Rollback bei Generator-, Validierungs- und Promotionsfehlern;
- Entfernung veralteter Feeddateien nur bei erfolgreicher Transaktion;
- Audit der aktuell veröffentlichten Spielplandaten gegen die bekannte Vereinsauflösung.

Browser- und UI-Verträge prüfen mindestens:

- Vereinsfavoriten in allgemeiner und vereinsspezifischer Liste;
- korrekte Navigation jedes Favoritentyps;
- Kalenderaktion im Dashboard und Profil;
- Profil-Onboarding ohne gespeicherte Mannschaft;
- HTTPS- und `webcal`-URL unter dem GitHub-Pages-Unterpfad;
- Kopierfallback, Offline-Meldung, Fokusführung, Escape und mobile Darstellung;
- vollständige Entfernung der Einzeltermin-Downloads ohne Verlust anderer Spielaktionen.

Vor Abschluss laufen die vollständige Python-/Node-Suite, Syntaxprüfungen, Workflow-Vertragstests und der vorhandene Browser-Smoke-Test. Implementierte lokale Evidenz, GitHub-Actions-Ergebnis und Live-GitHub-Pages-Prüfung werden getrennt berichtet.

Nach einem autorisierten Push werden auf GitHub Pages mindestens eine reale Feed-URL, HTTP-Status, Antworttyp, ICS-Struktur und der in der App erzeugte Abo-Link geprüft. Ob und wann ein externer Anbieter eine Änderung übernimmt, kann nur als manuelle externe Verifikation dokumentiert werden.

## Nicht-Ziele

- Kein Kalender für Vereinsfavoriten oder alle Mannschaften eines Vereins.
- Kein Ligapokal im Abo.
- Kein einzelner ICS-Download pro Spiel.
- Keine Push-Benachrichtigungen und kein sofort erzwungener Kalenderabruf.
- Kein Benutzerkonto, keine Cloud-Synchronisierung und keine serverseitige Kenntnis lokaler Favoriten.
- Keine Änderung der offiziellen Datenquelle oder des Sechs-Stunden-Rhythmus.
- Kein neues Frontend-Framework und kein externer Kalenderdienst.

## Akzeptanzkriterien

- Ein Vereinsfavorit erscheint unmittelbar oben unter `FAVORITEN` und weiterhin unter `VEREINE → Favoriten`.
- Für eine gültige Profil-Mannschaft sind Dashboard und Profil mit demselben dauerhaften Teamfeed verbunden.
- Der Feed enthält alle regulären Ligaspiele der aktuellen Saison und keine Ligapokalspiele.
- Jeder veröffentlichte Termin enthält Gegner, Heim-/Auswärtsstatus, Uhrzeit und den bestmöglichen Austragungsort mit Adresse.
- Eine Terminverschiebung aktualisiert dieselbe UID mit höherer Sequenz und erzeugt keine Dublette.
- Ein entfernter oder vorübergehend nicht mehr terminierter veröffentlichter Spieltermin wird als abgesagt gekennzeichnet.
- Nutzer können den Feed über `webcal` öffnen oder seine HTTPS-Adresse kopieren.
- Es gibt in der App keinen Einzeltermin-Download mehr.
- Kalender- und Ligadaten können nicht in unterschiedlichen erfolgreich veröffentlichten Ständen landen.
- Bestehende Favoriten-, Profil-, Spielkarten-, Pipeline-, Sicherheits-, Navigations- und PWA-Verträge bleiben grün.

## Rollback

Kalendergenerator, UI-Integration und Veröffentlichungserweiterung werden in getrennten testbaren Commits umgesetzt. Ein Rollback kann die Kalenderaktion und Kalenderartefakte entfernen, ohne das vorhandene Liga-, Ranglisten-, Vereins- oder Archivformat zu verändern. Schlägt ein automatischer Lauf vor der Freigabe fehl, bleibt der zuletzt erfolgreich veröffentlichte Kalenderstand verfügbar.
