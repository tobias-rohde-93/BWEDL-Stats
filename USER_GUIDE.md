# BWEDL Stats - Das Offizielle Handbuch 📘

Willkommen im **BWEDL Stats Dashboard**. Deine Zentrale für alle Daten, Statistiken und Analysen rund um die Dart-Ligen des BWEDL e.V.

Dieses Handbuch erklärt dir **jede Funktion**, **jede Statistik** und **jeden Knopf** der App.

---

## ⚡ Schnellstart
- **App installieren**: Öffne die Seite auf dem Handy, klicke im Browser-Menü auf "Zum Startbildschirm" (Android/iOS). Die App läuft dann auch offline!
- **Daten aktualisieren**: Die Web-Version aktualisiert sich automatisch beim Neuladen (wenn Internet verfügbar ist).
- **Direkt einsteigen**: Ansichten für Ligen, Vereine, Ranglisten und Werkzeuge haben direkte Links. Beim Teilen oder Kopieren bleibt deshalb die geöffnete Ansicht erhalten.

### Navigation und Tastatur

Die Seitenleiste fasst die vielen Einträge in aufklappbaren Bereichen zusammen. Ein gespeicherter Verein erscheint wie ein Liga-Favorit im globalen Bereich **FAVORITEN** und zusätzlich unter **VEREINE → Favoriten**; dort findest du außerdem die Vereinsübersicht, die Vereinssuche und zuletzt besuchte Vereine. Mit `Tab` erreichst du alle Schalter und Links, mit `Enter` oder der Leertaste öffnest du sie. `Esc` schließt Suchtreffer beziehungsweise auf kleinen Bildschirmen die geöffnete Navigation.

---

## 🏠 Dashboard (Dein Profil)
Das Dashboard wird aktiviert, sobald du oben links deinen **Namen eingibst** und auswählst.

Die Profilauswahl wird nur lokal im Speicher dieses Browsers abgelegt. Sie wird nicht als Benutzerkonto an einen Server übertragen; beim Löschen der Browserdaten oder in einem anderen Browser muss sie erneut gewählt werden.

Nach einem erneuten Besuch kann eine Karte **„Seit deinem letzten Besuch“** auf neue Daten sowie – bei vergleichbarer Ranglistenbasis – auf Änderungen an Rang, Punkten oder dem nächsten Spiel hinweisen. Die Karte ist eine Zusammenfassung und ersetzt nicht die Detailansichten.

### Teamkalender hinzufügen

Das Kalender-Abo gilt ausschließlich für das im lokalen Profil gespeicherte **Profilteam**. Es enthält alle vergangenen und zukünftigen regulären Ligaspiele der gesamten aktuellen Saison; **Ligapokal** und **Einzelspiel-Download** sind ausgeschlossen. Jeder Termin nennt Gegner, **Heim/Auswärts**, Uhrzeit und die bestverfügbare Adresse des Heimvereins. Eine unvollständige Adresse wird markiert; ein nicht aufgelöster Spielort wird ebenfalls klar gekennzeichnet.

Die Kalenderkarte steht im **Dashboard** und unter **Mein Profil**. **Kalender hinzufügen** öffnet einen gemeinsamen Dialog:

1. **Automatisch aktuell bleiben** ist die empfohlene Wahl. **In Kalender-App öffnen** startet den `webcal`-Link; **Abo-Link kopieren** kopiert dieselbe dauerhafte Abonnementadresse. Der Kalender wird separat und schreibgeschützt eingebunden. Kalenderanbieter können Terminänderungen und Absagen automatisch übernehmen, allerdings möglicherweise später. Für das Kalender-Abo ist eine Internetverbindung erforderlich.
2. **Termine einmalig übernehmen** lädt über **ICS-Datei herunterladen** genau eine gemeinsame Datei mit allen zukünftigen, bereits terminierten Ligaspielen. Diese lässt sich in einen bestehenden oder gemeinsamen Kalender importieren. **Keine automatische Aktualisierung**: Spätere Verschiebungen und Absagen musst du im Zielkalender selbst ändern. Ein erneuter Import kann zu doppelten Terminen führen.

#### Anleitung für iPhone

- **Abo:** Tippe auf **In Kalender-App öffnen**, bestätige das Abonnement in Apple Kalender und wähle bei Bedarf Name und Farbe. Falls keine App startet, kopiere den Abo-Link und füge ihn als Kalenderabonnement ein.
- **Einmalige Kopie:** Tippe auf **ICS-Datei herunterladen** und öffne die Datei über „Dateien“ oder als Anhang. Prüfe vor dem Import den beschreibbaren Zielkalender. Bei einem gemeinsam gepflegten Google-Kalender ist der Import am Computer zuverlässiger.

#### Anleitung für Android / Google Kalender

- **Abo:** Tippe auf **Abo-Link kopieren**. Öffne Google Kalender **am Computer**, wähle „Weitere Kalender → + → Per URL“ und füge den Link ein. Der separate abonnierte Kalender erscheint anschließend in der Android-App.
- **Einmalige Kopie:** Lade die ICS-Datei herunter. Öffne Google Kalender am Computer, wähle „Einstellungen → Importieren & Exportieren“, dann die Datei und den gewünschten bestehenden oder gemeinsamen Kalender. Der Import ist eine einmalige Kopie und wird nicht automatisch aktualisiert.

Es wird weiterhin kein Einzelspiel-Download angeboten; die statische Option bündelt alle passenden zukünftigen Termine des Profilteams in einer Datei.

Der Workflow prüft und validiert die Daten alle sechs Stunden. Nur ein erfolgreicher Lauf mit geänderten Daten veröffentlicht neue statische Kalenderdateien über GitHub Pages ohne API oder Server. Kalenderanbieter bestimmen selbst ihren Abrufrhythmus und können Änderungen später übernehmen. Deshalb kann ein auf GitHub Pages bereits korrigierter Termin in Apple Calendar, Google Calendar oder Outlook noch unverändert erscheinen.

### 1. Die "Hero Card" (Profilkarte)
Ganz oben siehst du dein Spielerprofil mit den wichtigsten Kennzahlen auf einen Blick.

#### **A. Rang & Liga**
- **Rang X**: Dein aktueller Tabellenplatz in deiner Spiel-Liga (z.B. Bezirksliga).
- **Team-Platz** (z.B. `(Team-Platz: 4 / 32)`): Der Rang deiner Mannschaft im Vergleich zur **gesamten Klasse** (alle Gruppen deiner Liga-Ebene zusammen). So siehst du, wie stark deine Mannschaft im ligaweiten Vergleich ist.

#### **B. Punkte & Trend (Die "Grünen Zahlen")**
Neben deinem Punkteschnitt (Ø Punkte) siehst du deine aktuelle Formkurve.
- **Trend (z.B. `↗ +0.8`)**: Zeigt, ob du dich verbesserst.
  - **Pfeil**: ↗ (Aufwärts), ↘ (Abwärts), → (Stabil).
  - **Wert**: Der Unterschied zwischen deinen letzten 3 Spielen und deinem Saison-Schnitt. Grün ist gut!
- **Form**: Dein Punkteschnitt der letzten 3 Spiele.

### 2. Spieltag-Top 20
Direkt auf dem Dashboard siehst du eine Liste der **Top 20 Spieler** des aktuellen Spieltags (aus allen Ligen).
- Zeigt die besten Einzelspieler-Leistungen der letzten Runde.

---

### 3. Karriere-Statistiken (Legacy)
Direkt unter dem Profil findest du deine historischen Leistungen (Daten aus dem Archiv).

Das Archiv speichert alle Saisons, die über die Archivnavigation der Quelle
gefunden wurden. Gehört eine Spieler-Saison zu mehreren Klassen oder Vereinen,
bleiben diese Abschnitte getrennt erhalten; die Karriereansicht zählt die
Spieler-Saison trotzdem nur einmal.

- **🏆 Ewige Punkte**: Die Summe aller Punkte, die du jemals in erfassten Saisons erzielt hast.
- **🥇 Titel**: Wie oft du eine Saison auf **Platz 1** beendet hast.
- **📈 Best-Wert**: Deine höchste Punktzahl, die du je in einer einzelnen Saison erreicht hast.
- **🦅 Höchste Liga**: Die höchste Spielklasse, in der du je aktiv warst (Bezirksliga > A- > B- > C-Klasse).

---

### 4. Saison-Verlauf & Analyse

#### **A. Form-Kurve (Lollipop-Chart)**
Die Grafik mit den "Stielen" zeigt deine Punkte der letzten **8 Spieltage**.
- **Hellgraue Linie**: Dein Saison-Durchschnitt (Zielwert).
- **Grüne Punkte**: Überdurchschnittliches Spiel.
- **Rote Punkte**: Unterdurchschnittliches Spiel.
- **Balkenhöhe**: Die tatsächlich erzielten Punkte.

#### **B. Liga-Vergleich**
Ein Balkendiagramm, das dich mit dem Rest der Liga vergleicht.
- **Dein Balken (Blau)**: Dein aktueller Schnitt.
- **Graue Linie**: Der Durchschnitt aller Spieler deiner Liga.
- **Top-Wert**: Der Schnitt des aktuell besten Spielers der Liga.

---

### 5. Detail-Statistiken
Hier gehen wir ins Detail.

- **Spiele**: Anzahl der absolvierten Spiele (x / 18).
- **Team**: Dein Punkteverhältnis im Team (z.B. 6:10).
- **Mein Score**: Deine erreichten Ranglistenpunkte im Spiel (z.B. 10)

---

## 🏆 Ligen & Tabellen
Über "Alle Ligen" im Menü kommst du zur Übersicht.

Wenn Ranglisten für eine neue Saison noch nicht vollständig vorliegen, zeigt ein Saisonhinweis transparent, welcher geprüfte Stand weiterverwendet wird. Spielpläne, Ergebnisse oder Vereinsdaten können trotzdem einen neueren Stand haben; beachte deshalb immer den Datenstand des jeweiligen Bereichs.

### Tabellen-Ansicht
Klicke auf eine Liga (z.B. "B-Klasse Gruppe 3"), um die Tabelle zu sehen.
- **Teams**: Klicke auf einen Team-Namen, um den **Kader** und den **Spielplan** des Teams zu sehen.
- **Spieltage**: Oben kannst du zwischen "Tabelle" und den einzelnen "Spieltagen" (R1, R2...) umschalten, um Ergebnisse zu sehen.

In Ranglisten kannst du nach Spieler oder Verein suchen, eine Mindestzahl an Spielen filtern und eine Analyseansicht nach Punkten, Durchschnitt oder Spielen wählen. Die ursprünglichen offiziellen Rangwerte bleiben dabei sichtbar; die Analyse-Sortierung ist keine neue offizielle Platzierung. Wenn ein lokales Profil zur Rangliste passt, führt **„Meine Position“** zur passenden Zeile.

### Spielaktionen und Vereinsadressen

Bei passenden Begegnungen stehen direkte Aktionen bereit: **Teilen** nutzt – soweit verfügbar – den Teilen-Dialog und sonst eine Kopiermöglichkeit, und **Route** öffnet die hinterlegte Adresse in Google Maps. Einen Einzelspiel-Download für den Kalender gibt es nicht mehr; verwende stattdessen das Teamkalender-Abo auf dem Dashboard oder unter Mein Profil. Fehlen Termin oder Adresse, wird die jeweilige Aktion nicht angeboten. Prüfe vor der Fahrt weiterhin die offiziellen Angaben.

---

## ⚔️ Match Preview Tool
Das Werkzeug liefert auch vor dem ersten Spieltag eine Vierer-Prognose. Wähle deine Liga, das Heim-Team und das Gast-Team. Die automatisch angenommene Aufstellung lässt sich vor jeder Berechnung manuell korrigieren; fehlen bekannte Spieler, erscheinen sichtbare neutrale Plätze statt einer Nullwertung.

### Evidenz in der Kader-Liste

- **Aktuell**: Der Spieler ist dem gewählten Team in den veröffentlichten Daten der laufenden Saison zugeordnet und die Bewertung beruht auf aktuellen Einsätzen.
- **Aktuell + Historie**: Aktuelle Einsätze werden mit der historischen Bewertung stabilisiert, solange die laufende Saison noch wenig Evidenz liefert.
- **Vorjahreskader**: Der Spieler ist nur über den letzten abgeschlossenen Saisonkader belegt. Deshalb steht zusätzlich **Kaderzugehörigkeit unbestätigt** dabei.
- **Historischer Ersatzkader**: Der Spieler stammt ausschließlich aus der davorliegenden Saison und wird nur verwendet, wenn der jüngere historische Kader nicht vier identifizierbare Spieler liefert.
- **Neutraler Klassenwert**: Für diesen der vier Plätze ist kein Spieler sicher zuordenbar. Der Platz verwendet einen positiven Schätzwert der gewählten Klasse und bleibt als unsichere Annahme sichtbar.

Die Spielerleistung wird als Quotient aus Punkten und **tatsächlichen Einsätzen** berechnet. Leere Runden und `x` zählen nicht als Einsatz; eine historische Gesamtsumme ohne belegte Einsätze wird nicht als Leistungsdurchschnitt verwendet. Kleine Stichproben werden zusätzlich mit vier klassenüblichen Einsätzen stabilisiert.

Obwohl das Archiv alle von der Quelle entdeckten Saisons speichert, zählen für den historischen Ausgangswert der Prognose nur die **zwei neuesten abgeschlossenen Saisons**: die jüngere mit **70 %**, die vorherige mit **30 %**. Ist nur eine davon nutzbar, erhält sie 100 %. Aktuelle Ergebnisse ersetzen diese Historie anschließend schrittweise, statt sie nach dem ersten Einsatz abrupt zu verdrängen.

Leistungen aus **Bezirksliga**, **A-Klasse**, **B-Klasse** und **C-Klasse** sind nicht automatisch gleichwertig. Ein Klassenwechsel wird nur anhand ausreichend vieler tatsächlich beobachteter Wechsel auf die Klasse der gewählten Partie angepasst. Fehlt dafür eine belastbare Kalibrierung, erfindet das Modell keinen Faktor und kennzeichnet die Prognose als sehr unsicher.

### Aufstellung, Ergebnis und Unsicherheit

Die vier vorausgewählten Spieler können über die Kontrollkästchen manuell entfernt oder ersetzt werden. **Prognose berechnen** verwendet immer genau vier Plätze und zeigt die dabei verwendete aktuelle, historische oder neutrale Evidenz. Formdaten aus abgeschlossenen Saisons heißen ausdrücklich **Historische Form** und werden nicht als aktuelle Form ausgegeben.

Nur bei ausreichender historischer Ergebnisbasis erscheinen getrennte Werte für Heim, Unentschieden und Auswärts. Ein **Plausibler Bereich** zeigt, wie stark unsichere Spieler-, Klassen- und Kaderannahmen das Ergebnis verändern können. Reicht die Kalibrierung nicht aus, zeigt das Werkzeug stattdessen eine relative Aufstellungsstärke und keine behauptete Sieg-Wahrscheinlichkeit. Historische Kader sind keine offizielle aktuelle Meldeliste; Hinweise wie **Kaderzugehörigkeit unbestätigt** und die Datenqualität gehören daher zur Aussage der Prognose.

### Spielauswahl und 1v1-Stärkevergleich

Erkannte Spiele erscheinen in einem **horizontalen Karussell**. Wische seitlich oder nutze die Pfeile und wähle die vollständige Spielkarte aus. Dadurch werden Liga, Heim- und Gast-Team übernommen; die Aufstellung bleibt anschließend bearbeitbar.

Die 4x4-Matrix vergleicht jeden Heimspieler mit jedem Gastspieler. Der Prozentwert ist der relative, klassenbereinigte Anteil der aktuellen und historischen Stärke des Heimspielers – **keine einzelne Sieg-Wahrscheinlichkeit**. Grün zeigt Heimvorteil, Amber einen ausgeglichenen Vergleich und Rot einen Gastvorteil. Ein `?` kennzeichnet eine **unsichere Datenbasis**, etwa bei neutralen, unbestätigten oder nicht eindeutig zugeordneten Daten.

Alle Aktualisierungen kommen ausschließlich aus den veröffentlichten statischen Artefakten auf **GitHub Pages**. Das Werkzeug ruft keine eigene API und keinen lokalen Server auf.

---

## 🔍 Head-to-Head (H2H) Vergleich
Willst du wissen, ob du gegen einen bestimmten Gegner gewinnst?
1. Klicke auf "H2H Vergleich" im Menü.
2. Wähle **Spieler A** (Dich) und **Spieler B** (Gegner).

### Die Analyse
Das System zeigt dir:
- **Win Probability**: Wer gewinnt wahrscheinlich? (basierend auf Form, Schnitt, Erfahrung).
- **Direkter Vergleich**:
  - **Höchste Klasse**: Wer hat höher gespielt?
  - **Meiste Punkte**: Wer hat in der aktuellen Saison mehr Punkte?
  - **Beste Platzierung**: Wer steht weiter oben?

---

## ❓ Häufige Fragen (FAQ)

**Q: Woher kommen die Daten?**
A: Die Daten werden von der offiziellen BWEDL-Seite abgerufen.

**Q: Mein Name taucht nicht auf?**
A: Prüfe, ob du in der Liga-Tabelle offiziell gelistet bist. Manchmal dauert es einen Tag nach dem Spieltag, bis die Daten da sind.

**Q: Was bedeutet "(L3)"?**
A: "Last 3" - Der Durchschnitt der letzten 3 Spiele.

**Q: Was bedeutet „Vorjahresstand 2025/26“ beim Datenstand?**
A: Die Ranglisten der neuen Saison sind noch nicht in allen vier Klassen vollständig. Deshalb bleibt der letzte geprüfte Stand sichtbar; Liga-, Vereins- und Archivdaten können trotzdem aktueller sein.

**Q: Wann werden neue Ranglisten angezeigt?**
A: Erst wenn Bezirksliga, A-Klasse, B-Klasse und C-Klasse jeweils mindestens einen gültigen Spieler liefern. So ersetzt ein leerer oder nur teilweiser Zwischenstand keine funktionierenden Daten.

**Q: Wann erscheint eine Terminänderung im abonnierten Kalender?**
A: Der validierte GitHub-Workflow prüft den Datenstand alle sechs Stunden und veröffentlicht nur erfolgreiche Änderungen. Dein Kalenderanbieter entscheidet danach selbst, wann er den Link erneut abruft; die sichtbare Änderung kann deshalb später eintreffen. Offline kann kein neuer Stand geladen werden.

---

## Technische Prüfung für Betreibende

Die Daten werden zunächst nach `.staging/` geladen und je Bereich als `publish`, `retain`, `blocked` oder `failed` bewertet. Nur ein insgesamt gültiger Lauf wird als Ganzes veröffentlicht. `retain` behält bewusst den letzten gültigen Stand; `blocked` und `failed` verhindern die gesamte Veröffentlichung.

Ein sicherer lokaler Testlauf lautet:

```powershell
python -m pip install -r requirements.txt
python -m pytest
python update_data.py --dry-run --staging-dir .staging/manual-check --artifacts-dir artifacts/manual-check
```

Der Dry-Run schreibt `update_report.json`, `update_status.json` und gegebenenfalls HTML-, PNG- oder Trace-Diagnosen unter `artifacts/`, lässt aber die öffentlichen Datendateien unverändert. GitHub Pages ist die einzige produktive Laufzeit. Für eine reine Entwicklungs-Vorschau kann `python -m http.server 8000 --bind 127.0.0.1` gestartet und `http://127.0.0.1:8000/` geöffnet werden; dieser statische Testserver besitzt keine Aktualisierungslogik.

Bei einem Incident zuerst Bericht und Fehlerartefakte prüfen, dann mit frischen Staging-/Artefaktpfaden reproduzieren. Veröffentlicht werden dürfen nur `league_data.{json,js}`, `ranking_data.{json,js}`, `club_data.{json,js}`, `archive_data.js`, `archive_tables.js`, `data_status.{json,js}`, `calendar_index.{json,js}`, `calendar_state.json` und `calendars/*.ics`. Der GitHub-Workflow läuft alle sechs Stunden, ist manuell startbar und eröffnet erst nach zwei aufeinanderfolgenden geplanten Fehlern ein Issue; ein erfolgreicher geplanter Lauf schließt es nach einem Recovery-Kommentar. Lokale Tests, GitHub Actions, die Live-Dateien auf GitHub Pages und die spätere Aktualisierung durch einen externen Kalenderanbieter bleiben getrennte Nachweise.

---
*Erstellt mit ❤️ für den Dartsport.*
