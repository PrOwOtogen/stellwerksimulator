# Stellwerksimulator

Ein Stellwerksimulator für den Browser: Fahrstraßen stellen, Züge nach Fahrplan durch
den Bahnhof führen, Störungen beheben – in Szenarien mit Punkten und Sternen oder frei
auf selbst gebauten Stellwerken. Reines HTML/CSS/JavaScript (ES-Module), keine
Abhängigkeiten, kein Build-Schritt.

## Starten

```bash
python3 -m http.server 8000
# danach http://localhost:8000/index.html im Browser öffnen
```

Ein lokaler Server ist nötig, weil ES-Module über `file://` nicht geladen werden.
Beim ersten Start erscheint der Startbildschirm mit Szenarien, freiem Spiel,
Einführung und Editor; später ist er über das Logo oben links erreichbar.

---

## Spielen

### Einführung
Zwölf Schritte führen durch die Bedienung: Fahrstraße per Maus stellen, Betrieb starten,
Ausfahrt über die Befehlszeile, Kontextmenü, Zugfunk beantworten, Störung entstören.
Jeder Schritt markiert die passende Stelle im Gleisbild und geht weiter, sobald die
Aufgabe erledigt ist.

### Szenarien
| Szenario | Stellwerk | Schwerpunkt |
|---|---|---|
| Erster Dienst | Neustadt | wenige Züge, zum Kennenlernen |
| Berufsverkehr | Neustadt | dichter Takt, Zugmeldeverfahren |
| Störungstag | Neustadt | Weichen-, Signal- und Stellwerksstörungen nach Drehbuch |
| Baustelle Gleis 3 | Neustadt | gesperrtes Bahnsteiggleis, Gleiswechsel, Langsamfahrstelle |
| Kreuzungen auf der Nebenbahn | Waldheim | eingleisige Strecke, Zugkreuzungen |
| Kopfbahnhof am Morgen | Seestadt | Wendebetrieb über eine eingleisige Zufahrt |

Jedes Szenario hat Ziele (etwa „mindestens 16 Zugfahrten, 70 % pünktlich"), eine feste
Betriebszeit und Punkteschwellen für zwei und drei Sterne. Die Anzeige oben rechts im
Gleisbild zeigt den Fortschritt. Bestwerte werden im Browser gespeichert. Mit
Automatikbetrieb ist höchstens ein Stern möglich.

### Punkte
Pünktliche Zugfahrten und Abfahrten, angenommene Zugmeldungen, schnell beauftragte
Entstörungen und gehaltene Anschlüsse bringen Punkte; Verspätungen, Halte vor
Signalen, Hilfsauflösungen, Ersatzsignale und gestrichene Züge kosten Punkte. Die
vollständige Tabelle steht unter Einstellungen, der Verlauf in der Auswertung.

---

## Bedienung im Betrieb

**Gleisbild**
* Ziehen verschiebt, das Mausrad zoomt um den Mauszeiger, `F` passt den Plan ein.
  Mittlere Maustaste oder Leertaste + Ziehen verschieben ebenfalls.
* Die Übersichtskarte unten rechts zeigt den Ausschnitt; ein Klick springt dorthin.
* Tooltips zeigen zu Signalen, Weichen, Zügen, Bahnübergängen und Ein-/Ausfahrten
  Begriff, Lage, Fahrstraße, Wartegrund, Verspätung und nächste Züge.

**Fahrstraßen**
* Start (Signal oder Einfahrt) anklicken, dann das Ziel (Signal, Ausfahrt oder
  Gleisende). Liegen Signale dazwischen, wird die ganze Kette gestellt
  (**Zuglenkung**). Die Vorschau zeigt den Weg schon beim Zeigen auf das Ziel.
* Eine Fahrstraße zeigt erst Fahrt, wenn die Weichen umgelaufen sind, der
  Flankenschutz steht, der Durchrutschweg frei ist und Bahnübergänge geschlossen sind.
  Der Reiter **Stellen** nennt zu jeder Fahrstraße den Wartegrund.
* **Umschalt+Klick** aufs Ziel: Ersatzsignal Zs1. **Rangieren** (Taste `R`) für
  Rangierfahrstraßen über Sperrsignale. **Speicher** merkt nicht einstellbare
  Fahrstraßen vor. **Automatik** (Taste `A`) disponiert selbst.
* **Befehlszeile** unten links: `A N1`, `West Ost`, `Hauptstrecke Gleis 2`.
* **Rechtsklick**: Fahrstraße auflösen (befahren nur als Hilfsauflösung mit Wartezeit),
  Selbststellbetrieb, Signal sperren, Ersatzsignal, Gleis sperren, Zugdetails.

**Seitenleiste**
| Reiter | Inhalt |
|---|---|
| Stellen | eingestellte Fahrstraßen mit Begriff oder Wartegrund, Speicher, Bahnübergänge, Baustellen |
| Züge | alle offenen Zugfahrten mit Filter und Sortierung, Abfahrtstafel je Bahnsteig |
| Funk | Zugmeldungen, Lokführer-Rückfragen, Anschlüsse, Bahnübergänge – mit Antwortknöpfen |
| Störungen | aktive Störungen mit „Entstören", gesperrte Gleise, Weichen und Signale |
| Protokoll | Meldungsbuch mit Filter (Betrieb, Hinweise, Störungen, Punkte) |

**Zugdetails** (Klick auf einen Zug): Lauf, Zustand, Geschwindigkeit, Fahrwerte,
Fahrerlaubnis, alle Halte mit Plan- und Ist-Zeiten, **Gleiswechsel** für den nächsten
Halt, Ersatzsignal, Zug verfolgen, Zug streichen.

**Kopfleiste**: Uhr, Start/Pause, Zeitraffer 1×–120×, **Zeitsprung** bis zum nächsten
Ereignis (wenn gerade kein Zug fährt), Punktestand, Signaltöne, Einstellungen und das
Menü (Startbildschirm, Szenarien, Einführung, neues Stellwerk, Speichern, Export,
Import, Spielstände, Hilfe).

**Statusleiste**: abgeschlossene Zugfahrten, Pünktlichkeit, Ø Verspätung, Züge im
Bereich, aktive Störungen und die jeweils letzte Meldung.

### Betriebliche Abläufe
* **Zugmeldeverfahren** (einstellbar, im Szenario „Berufsverkehr" aktiv): Das
  Nachbarstellwerk bietet jeden Zug drei Minuten vor der Einfahrt an; erst nach der
  Annahme fährt er ein. „Später" bietet ihn zwei Minuten danach erneut an.
* **Geplante Baustellen**: Gleissperrungen und Langsamfahrstellen zu festen Zeiten.
  Ist ein Bahnsteiggleis gesperrt, fragt die Reisendeninformation nach einem
  Gleiswechsel und schlägt passende Bahnsteige vor.
* **Anschlüsse, Wenden, Selbststellbetrieb, Bahnübergänge von Hand, Spielstände** wie
  bisher.

### Signaltöne
Zugmeldungen, Rückfragen, Störungen und gestellte Fahrstraßen werden kurz akustisch
angezeigt; der Lautsprecher-Knopf schaltet die Töne ab.

---

## Stellwerk-Editor

* **Werkzeuge**: Gleis, Radieren, Haupt-, Vor- und Sperrsignal, Bahnsteig,
  Abstellgleis, Ein-/Ausfahrt, Bahnübergang, DKW, Geschwindigkeit, Beschriftung,
  Eigenschaften und **Bereich**.
* **Bereich**: Rechteck aufziehen, dann `Strg+C` / `Strg+X` / `Strg+V` (an der
  Mausposition), `Entf` löscht, Pfeiltasten verschieben den Ausschnitt.
* **Signale automatisch setzen**: Ausfahrsignale an beiden Enden jedes
  Bahnsteiggleises, Einfahrsignal vor der ersten Weiche jeder Einfahrt mit Vorsignal.
* **Bausteine**: Gleisverbindungen, doppelte Gleisverbindung, Bahnsteig-, Überhol- und
  Stumpfgleis.
* **Prüfung**: Ein Klick auf einen Befund springt zur Stelle und markiert sie.
* Rückgängig/Wiederholen, Zoom, Einpassen, Übersichtskarte, Koordinatenanzeige.

## Fahrplan, Ereignisse, Diagramme, Auswertung, Einstellungen

* **Fahrplan**: Tabelle mit Halte- und Wende-Editor, Taktlinien, Zufallsfahrplan,
  Prüfung, CSV-Export.
* **Ereignisse**: 17 Zufallsereignisse (gewichtbar, abschaltbar, mit Seed) und die
  Planung von Baustellen.
* **Diagramme**: Bildfahrplan (Zeit-Weg-Linien) und Gleisbelegung (Plan gegen Ist).
* **Auswertung**: Kennzahlen, Verspätungsverteilung, Punkteverlauf und alle
  Zugfahrten mit Plan- und Ist-Zeiten; CSV-Export.
* **Einstellungen**: Fahrdynamik mit den Profilen „Vorbildgetreu", „Zügig" und
  „Sehr zügig", Sicherungstechnik, Zugmeldeverfahren, Anzeige, Punkteregeln.

---

## Tastenkürzel

| Taste | Wirkung |
|---|---|
| Leertaste | Start/Pause |
| `1` … `7` | Zeitraffer 1×, 2×, 5×, 10×, 30×, 60×, 120× |
| `Z` | Zeitsprung bis zum nächsten Ereignis |
| `A` / `R` / `F` | Automatik / Rangiermodus / Gleisplan einpassen |
| `+` / `−` | zoomen |
| Esc | Auswahl abbrechen, Menüs und Dialoge schließen |
| F1 | Hilfe |
| Editor: `Strg+Z` / `Strg+Y` | rückgängig / wiederholen |
| Editor, Bereich: `Strg+C/X/V`, `Entf`, Pfeile | kopieren, ausschneiden, einfügen, löschen, verschieben |

---

## Aufbau des Codes

| Datei | Inhalt |
|---|---|
| `js/model.js` | Datenmodell, Gleistopologie, Weichen- und DKW-Geometrie, Prüfung |
| `js/interlocking.js` | Wegesuche, Verschluss, Flankenschutz, Durchrutschweg, Signalbegriffe, Zuglenkung |
| `js/sim.js` | Uhr, Fahrdynamik, Belegung, Halte, Anschlüsse, Wenden, Zugfunk, Zugmeldeverfahren, Baustellen, Gleiswechsel, Automatik, Spielstände, Ereignisschnittstelle |
| `js/events.js` | Zufallsgenerator, 17 Ereignisarten, Störungsverwaltung |
| `js/scoring.js` | Punktesystem |
| `js/scenarios.js` | Szenarien, Ziele, Sterne, Bestenliste |
| `js/sound.js` | Signaltöne (Web Audio) |
| `js/render.js` | Gleisbild, Übersichtskarte, Markierungen |
| `js/editor.js` | Zeichenwerkzeuge, Bereichsauswahl, Zwischenablage, Signalautomatik |
| `js/timetable.js` | Fahrplandaten, Generatoren, Fahrplanprüfung |
| `js/storage.js` | Stellwerke und Spielstände, Im-/Export, Migration |
| `js/demo.js`, `js/layouts.js` | mitgelieferte Stellwerke |
| `js/main.js` | Start, Hauptschleife, Kopfleiste, Tastatur |
| `js/ui/app.js`, `dom.js`, `icons.js` | gemeinsamer Zustand, Hilfsfunktionen, Symbole |
| `js/ui/viewport.js` | Verschieben, Zoomen, Einpassen, Übersichtskarte |
| `js/ui/simview.js` | Betriebsansicht, Tooltips, Kontextmenü, Seitenleiste, Zugdetails |
| `js/ui/editorview.js` | Editoransicht und Eigenschaftsdialoge |
| `js/ui/timetableview.js`, `eventsview.js`, `diagrams.js`, `settingsview.js` | übrige Ansichten |
| `js/ui/gamemode.js`, `tutorial.js` | Startbildschirm, Szenarien, Spielstände, Hilfe, Einführung |

In der Browserkonsole steht `window.stellwerk` mit `sim`, `layout`, `startScenario`,
`startTutorial` und `fastForward` zur Verfügung.

### Modellannahmen
Eine Rasterzelle entspricht standardmäßig 50 m Gleis (einstellbar); Zuglängen werden in
Zelleneinheiten gerechnet. Jede Zuggattung hat eigene Anfahr- und Bremswerte.
Voreinstellungen: Durchrutschweg 200 m, Weichenumlaufzeit 6 s, Mindesthaltezeit 30 s,
Hilfsauflösung nach 90 s, Bahnübergang schließt in 25 s, pünktlich unter 5 Minuten.
Die Automatik disponiert jeweils die ganze Kette bis zu einem sicheren Platz
(Bahnsteig oder Ausfahrt), damit sich Züge auf eingleisigen Abschnitten nicht
gegenseitig festfahren.
