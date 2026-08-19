# 📘 BWEDL Stats - Benutzerhandbuch

Willkommen bei **BWEDL Stats**, deiner App für Darts-Statistiken, Tabellen und Tools rund um die *Baden-Württembergische E-Dart Liga*.

## 🚀 Schnelleinstieg

Die App ist in drei Hauptbereiche unterteilt:
1.  **Dashboard**: Deine persönliche Übersicht (Favoriten, nächste Spiele).
2.  **Ligen**: Alle Tabellen, Ergebnisse und Schedules der aktuellen Saison.
3.  **Tools**: Nützliche Helfer wie der Match Scorer oder H2H-Vergleich.

Ansichten für Ligen, Vereine, Ranglisten und Werkzeuge besitzen direkte Links. Ein geteilter oder kopierter Link öffnet daher wieder die betreffende Ansicht, sofern die dazugehörigen Daten verfügbar sind.

---

## 🧭 Navigation & Bereiche

### 1. Dashboard
Hier landest du beim Start.
-   **Favoriten**: Gespeicherte Vereine erscheinen wie Liga-Favoriten im globalen Bereich **FAVORITEN** und zusätzlich unter **VEREINE → Favoriten**.
-   **Suche**: Nutze die Suchleiste oben links, um schnell nach *Spielern* oder *Vereinen* zu suchen.
-   **Status**: Oben links siehst du, wann die Daten zuletzt aktualisiert wurden.
-   **Profil & Datenschutz**: Die gewählte Spieler- und Mannschaftszuordnung bleibt lokal in diesem Browser und ist kein serverseitiges Benutzerkonto.
-   **Seit deinem letzten Besuch**: Nach einem erneuten Besuch kann eine Karte neue Daten und vergleichbare persönliche Änderungen zusammenfassen. Details bleiben in den jeweiligen Ansichten maßgeblich.

### 2. Ligen & Tabellen
Wähle im Menü links eine Liga aus (z.B. "Bezirksoberliga").
-   **Tabelle**: Die aktuelle Rangliste.
-   **Ergebnisse**: Alle Spieltage und Match-Details (klicke auf ein Match für Details).
-   **Einzelkritik**: Klicke auf einen Spieler in der Tabelle, um seine persönlichen Stats (Wins/Losses) zu sehen.
-   **Saisonhinweise**: Ist eine neue Ranglistensaison noch unvollständig, benennt die App den weiterverwendeten geprüften Stand. Andere Datenbereiche können trotzdem aktueller sein.
-   **Ranglistenanalyse**: Suche und Mindestspiele-Filter grenzen die Liste ein. Analyseansichten können nach Punkten, Durchschnitt oder Spielen sortieren, ändern aber nicht die angezeigten offiziellen Rangwerte.

### 3. Vereinsseiten
Suche nach einem Verein oder klicke in einer Tabelle auf den Vereinsnamen.
-   **Quick Stats**: Überblick über Mitgliederzahl, aktive Ligen und Gesamtpunkte.
-   **Details**: Adresse, Kontaktinfos und Link zum Spielort (Google Maps).
-   **Kader**: Liste aller Spieler mit aktueller Liga und Rang.
-   **Archiv**: Historie des Vereins aus vergangenen Saisons.
-   **Spielaktionen**: Wo Termin und Adresse vorhanden sind, kannst du die Begegnung teilen beziehungsweise den Link kopieren und die Route in Google Maps öffnen. Einen Einzelspiel-Download für den Kalender gibt es nicht mehr.

### 4. Spieler-Profile
Unter **Mein Profil** wählst du einen exakten Spielervorschlag aus; frei eingegebener Text allein wird nicht gespeichert. Der Vorschlag zeigt Verein und zugehörige Ranglistenklassen, damit gleichnamige Personen unterscheidbar bleiben. Wenn dein Datensatz in mehreren Klassen vorkommt, bestätigst du zusätzlich eine **primäre Klasse**.

Das versionierte Profil bleibt ausschließlich lokal in diesem Browser. Ein vorhandenes altes Namensprofil wird nur bei eindeutiger Zuordnung automatisch übernommen; bei mehreren Treffern fordert die App einmalig zur Bestätigung auf.

Mit dem ausgewählten Profil erhältst du:
-   **Formkurve**: Die letzten Spiele und Trend.
-   **Saisonverlauf**: Detaillierte Liste aller gespielten Runden und Ergebnisse.
-   **Head-to-Head**: Vergleiche diesen Spieler direkt mit einem anderen.
-   **Teamkalender**: Abonniere die regulären Saisonspiele deines Profilteams.

### 5. Teamkalender abonnieren

Das Kalender-Abo gilt ausschließlich für das im lokalen Profil gespeicherte **Profilteam**. Es enthält alle vergangenen und zukünftigen regulären Ligaspiele der gesamten aktuellen Saison; **Ligapokal** und **Einzelspiel-Download** sind ausgeschlossen. Jeder Termin nennt Gegner, **Heim/Auswärts**, Uhrzeit und die bestverfügbare Adresse des Heimvereins. Eine unvollständige Adresse wird markiert; ein nicht aufgelöster Spielort wird ebenfalls klar gekennzeichnet.

Die Abo-Karte steht im **Dashboard** und unter **Mein Profil**. **In Kalender-App öffnen** öffnet den `webcal`-Link; **HTTPS-Link kopieren** kopiert dieselbe Abonnementadresse zum manuellen Einfügen. Für das Kalender-Abo ist eine Internetverbindung erforderlich.

Der Workflow prüft und validiert die Daten alle sechs Stunden. Nur ein erfolgreicher Lauf mit geänderten Daten veröffentlicht neue statische Kalenderdateien über GitHub Pages ohne API oder Server. Kalenderanbieter bestimmen selbst ihren Abrufrhythmus und können Änderungen später übernehmen. Lokale Tests, GitHub Actions, erreichbare Live-Dateien und der tatsächliche externe Kalenderabruf sind daher getrennte Nachweise.

### 6. Kompakte Navigation und Tastatur

Die Seitenleiste verwendet aufklappbare Bereiche. **Vereine** bietet zuerst die Vereinsübersicht und Suche, danach kompakte Favoriten und zuletzt besuchte Vereine statt einer langen Gesamtliste. Derselbe Vereinsfavorit bleibt zugleich im globalen Bereich **FAVORITEN** und unter **VEREINE → Favoriten** sichtbar. Mit `Tab` wechselst du zwischen den Bedienelementen; `Enter` oder die Leertaste aktiviert sie. `Esc` schließt Suchtreffer und auf kleinen Bildschirmen die Navigation.

---

## 🛠️ Tools & Features

### ⚔️ H2H Vergleich (Head-to-Head)
Vergleiche zwei Spieler direkt miteinander.
-   **Titel & Erfolge**: Wer hat mehr Meisterschaften gewonnen?
-   **Erfahrung**: Wer spielt schon länger in der Liga?
-   **Aktueller Trend**: Wer ist momentan besser in Form?

### 🎯 Match Scorer
Ein Tool, um deine eigenen Darts-Matches zu tracken und zu scoren.
-   **Verschiedene Modi**: Spiele 1vs1 (Single Out), Double Out, Master Out oder **Liga (2vs2)**.
-   **Liga-Modus**: Spezieller 2vs2 Modus mit Block-Regel (Partner muss weniger Punkte als Gegner haben zum Checken).
-   **Spracheingabe**: Sage einfach "Hundertachtzig" oder "Sechsundzwanzig", um zu scoren!
-   **Dartboard-Input**: Klicke auf das virtuelle Board, um Treffer einzugeben.
-   **Checkout-Hilfe**: Zeigt dir mögliche Wege zum Finish an (z.B. T20 - T20 - D20).

### 📱 Installation (App)
Diese Seite ist eine **PWA (Progressive Web App)**.
-   **Android (Chrome)**: Klicke auf das Menü (3 Punkte) -> "Zum Startbildschirm hinzufügen" oder "App installieren".
-   **iOS (Safari)**: Klicke auf den "Teilen"-Button -> "Zum Home-Bildschirm".
    So hast du die Stats immer als App auf dem Handy – auch offline! Ein Kalender-Abo oder dessen Aktualisierung benötigt weiterhin eine Internetverbindung.

---

## ❓ Häufige Fragen (FAQ)

**Wie oft werden die Daten aktualisiert?**
GitHub Actions prüft den Datenstand alle sechs Stunden; neue statische Dateien gibt es nur nach einem erfolgreichen Lauf mit Änderungen. Der **Aktualisieren**-Button prüft den auf GitHub Pages bereitgestellten Datenstand und lädt die veröffentlichten Dateien neu; einen lokalen Produktserver gibt es nicht. Ein Kalenderanbieter kann seinen abonnierten Link später erneut abrufen.

**Stimmen die Daten immer zu 100%?**
Wir geben unser Bestes! Da Daten aus verschiedenen Quellen (PDFs, HTML) zusammengeführt werden, kann es in seltenen Fällen zu Abweichungen kommen. Melde Fehler gerne!

**Kann ich alte Saisons sehen?**
Ja! Auf den Vereins- und Spielerseiten findest du ein "Archiv", das bis zu den erfassten historischen Daten zurückreicht.
