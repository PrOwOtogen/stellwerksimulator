# Stellwerksimulator

Ein vollständiger Stellwerksimulator für den Browser: eigene Stellwerke zeichnen,
Fahrpläne anlegen, Fahrstraßen stellen und den Betrieb gegen zufällige Störungen
am Laufen halten. Reines HTML/CSS/JavaScript (ES-Module), keine Abhängigkeiten,
kein Build-Schritt.

## Starten

```bash
python3 -m http.server 8000
# danach http://localhost:8000/index.html im Browser öffnen
```

Ein lokaler Server ist nötig, weil ES-Module über `file://` nicht geladen werden.

## Die vier Bereiche

### Betrieb
Das Gleisbild mit Zügen, Signalen, Weichen und Fahrstraßen.

* **Fahrstraße stellen:** Startsignal oder Ein-/Ausfahrt anklicken, danach das Ziel
  (Signal oder Ausfahrt). Der Fahrweg wird gesucht, die Weichen werden gestellt und
  verschlossen, das Startsignal zeigt Fahrt.
* **Ersatzsignal (Zs1):** Umschalttaste beim Klick auf das Ziel — erlaubt die Vorbeifahrt
  an einem gestörten Signal mit höchstens 40 km/h.
* **Hilfsauflösung:** Rechtsklick auf eine eingestellte Fahrstraße.
* **Weiche umstellen:** Klick auf die Weiche, solange sie frei und nicht verschlossen ist.
* **Automatikbetrieb:** stellt Fahrstraßen selbstständig und beauftragt Entstörungen.
* Start/Pause mit der Leertaste, Zeitraffer 1× bis 60×.

Die Fahrstraßenlogik verhindert Fahrten über besetzte oder verschlossene Abschnitte,
das Auffahren auf Weichen, das Überfahren Halt zeigender Signale und stellt jede Zelle
erst wieder frei, wenn der Zugschluss sie geräumt hat.

### Stellwerk-Editor
* **Gleis zeichnen:** über das Raster ziehen. Aus drei Gleisenden in einer Zelle wird
  automatisch eine Weiche, aus vier eine Kreuzung. Diagonalen sind erlaubt.
* **Hauptsignal / Sperrsignal:** Klick nahe an ein Gleisende; erneuter Klick entfernt es.
* **Bahnsteig:** über die Gleiszellen ziehen und benennen (Umschalt = löschen).
* **Ein-/Ausfahrt:** Streckenende benennen — dort erscheinen und verschwinden die Züge.
* **Geschwindigkeit, Beschriftung, Radieren, Rastergröße, Betriebsbeginn.**
* **Gleisplan prüfen** meldet ungültige Zellen, Signale ohne Gleisende und fehlende
  Ein-/Ausfahrten.

### Fahrplan
Zugnummer, Gattung (ICE bis Güterzug mit passenden Geschwindigkeiten und Längen),
Einfahrt mit Uhrzeit, Ausfahrt, Halte in der Form `Gleis 2@08:15/08:17` sowie
V<sub>max</sub> und Zuglänge (in 100-m-Schritten). **Zufallsfahrplan erzeugen** legt
beliebig viele Fahrten an und verwendet dabei nur Relationen, die im Gleisplan ohne
Fahrtrichtungswechsel befahrbar sind.

### Ereignisse
Zufällige Störungen, einzeln abschaltbar und gewichtbar, mit einstellbarer Häufigkeit
und festem Zufalls-Seed für wiederholbare Läufe:

| Ereignis | Wirkung |
|---|---|
| Weichenstörung | Weiche lässt sich nicht mehr umstellen |
| Signalstörung | Signal zeigt keinen Fahrtbegriff — nur noch Ersatzsignal |
| Gleissperrung | Abschnitt nicht befahrbar |
| Verspätete Einfahrt | Zug erreicht das Stellwerk später |
| Türstörung | verlängerte Haltezeit |
| Fahrzeugstörung | Zug fährt nur noch langsam |
| Notarzteinsatz | langer außerplanmäßiger Halt |
| Personen im Gleis | Langsamfahrt 40 km/h im ganzen Bereich |
| Unwetter | Beschränkung auf 80 km/h |
| Sonderzug | zusätzlicher, nicht im Fahrplan stehender Zug |

Störungen mit Entstörungsbedarf werden erst behoben, wenn der Entstörungsdienst
beauftragt wurde — das dauert je nach Störung einige Minuten.

## Speichern

Stellwerke liegen im `localStorage` des Browsers (Auswahlliste oben rechts) und lassen
sich als JSON exportieren und wieder importieren. Der Gleisplan, der Fahrplan und die
Ereigniskonfiguration stecken gemeinsam in einer Datei.

## Aufbau des Codes

| Datei | Inhalt |
|---|---|
| `js/model.js` | Datenmodell, Gleistopologie, Weichengeometrie, Prüfung |
| `js/interlocking.js` | Fahrwegsuche, Verschluss, Signalbegriffe, Erreichbarkeit |
| `js/sim.js` | Uhr, Fahrdynamik, Belegung, Halte, Automatikbetrieb, Bilanz |
| `js/events.js` | Zufallsgenerator, Ereignisarten, Störungsverwaltung |
| `js/render.js` | Zeichnen des Gleisbildes |
| `js/editor.js` | Zeichenwerkzeuge des Editors |
| `js/timetable.js` | Fahrplandaten, Generator, Fahrplantabelle |
| `js/storage.js` | Speichern, Laden, Im-/Export |
| `js/demo.js` | Beispielstellwerk „Bahnhof Neustadt" |
| `js/main.js` | Oberfläche und Bedienung |

### Modellannahmen
Eine Rasterzelle entspricht 100 m Gleis. Beschleunigung 0,7 m/s², Bremsverzögerung
0,9 m/s², Mindesthaltezeit 30 s. Pünktlich ist ein Zug mit weniger als 5 Minuten
Verspätung bei der Ausfahrt.
