# Stellwerksimulator

Ein ausführlicher Stellwerksimulator für den Browser: eigene Stellwerke zeichnen,
Fahrpläne aufstellen, Fahrstraßen mit allen betrieblichen Abhängigkeiten stellen und
den Betrieb gegen Zufallsereignisse am Laufen halten.
Reines HTML/CSS/JavaScript (ES-Module), keine Abhängigkeiten, kein Build-Schritt.

## Starten

```bash
python3 -m http.server 8000
# danach http://localhost:8000/index.html im Browser öffnen
```

Ein lokaler Server ist nötig, weil ES-Module über `file://` nicht geladen werden.

---

## Betrieb

Das Gleisbild zeigt Gleise, Weichen, Signale, Bahnsteige, Bahnübergänge, Zugnummern
und den Zustand jeder Fahrstraße.

**Fahrstraßen**

* Start (Signal oder Einfahrt) anklicken, dann das Ziel (Signal, Ausfahrt oder – beim
  Rangieren – ein Gleis). Während der Auswahl wird der Fahrweg als Vorschau angezeigt.
* **Zuglenkung:** Liegen Signale zwischen Start und Ziel, wird automatisch die ganze
  Kette der Teilfahrstraßen eingestellt – ein Klick von der Einfahrt bis zur Ausfahrt
  genügt. Was sich nicht stellen lässt, wird gemeldet und kann in den
  Fahrstraßenspeicher wandern.
* Fahrstraßen lassen sich **im Voraus** stellen, lange bevor der Zug da ist; der
  Durchrutschweg der vorherigen Fahrstraße wird dabei überlagert und aufgelöst.
  Das Feld „Fahrstraße" listet alle eingestellten Fahrstraßen mit ihrem Zustand
  (Fahrt frei, Weichen laufen, Bahnübergang noch offen …).
* Eine Fahrstraße zeigt erst Fahrt, wenn **alle Weichen in Endlage** liegen
  (Umlaufzeit), der **Flankenschutz** hergestellt ist, der **Durchrutschweg** frei ist
  und die **Bahnübergänge geschlossen** sind.
* Der Verschluss löst sich **zellenweise hinter dem Zugschluss** auf, der Flankenschutz
  entfällt mit dem jeweils geräumten Abschnitt, der Durchrutschweg nach Stillstand.
* **Umschalt+Klick** auf das Ziel: Ersatzsignal **Zs1** (Vorbeifahrt am gestörten oder
  gesperrten Signal, höchstens 40 km/h).
* **Rangierfahrstraßen** (Taste `R` oder Schalter): über Sperrsignale, höchstens
  25 km/h, Einfahrt in besetzte Gleise erlaubt.
* **Fahrstraßenspeicher**: nicht einstellbare Fahrstraßen können vorgemerkt werden und
  stellen sich selbst ein, sobald der Weg frei wird.
* **Selbststellbetrieb** je Signal: die zuletzt gestellte Fahrstraße wird beim nächsten
  Zug automatisch wiederholt.
* **Automatikbetrieb**: der Rechner disponiert selbst, schließt Bahnübergänge und
  beauftragt Entstörungen.

**Signalbegriffe**

| Begriff | Bedeutung |
|---|---|
| Hp0 | Halt |
| Hp1 | Fahrt |
| Hp2 | Langsamfahrt – der Fahrweg lenkt über eine abzweigende Weiche ab |
| Zs1 | Ersatzsignal (Vorbeifahrt am Halt zeigenden Signal) |
| Sh1 | Rangierfahrt frei |
| Vr0 / Vr1 / Vr2 | Vorsignal: Halt, Fahrt bzw. Langsamfahrt erwarten |

**Weitere Bedienung**

* Klick auf eine Weiche stellt sie um (nicht, wenn verschlossen, besetzt, gestört oder
  als Flankenschutz festgelegt).
* Klick auf einen Bahnübergang schließt bzw. öffnet die Schranken.
* **Rechtsklick** öffnet ein Kontextmenü: Fahrstraße auflösen (bei befahrener
  Fahrstraße als Hilfsauflösung mit Wartezeit), Selbststellbetrieb, Signalsperre,
  Ersatzsignal, Gleissperrung, Zug verfolgen.
* **Zugfunk**: Lokführer melden sich, wenn sie zu lange vor einem Halt zeigenden Signal
  stehen; Anschlusszüge, Bahnübergänge und Störungen melden sich ebenfalls – jeweils
  mit Antwortmöglichkeiten.
* Zugliste mit Filter und Sortierung, Klick zentriert das Gleisbild auf den Zug.

**Bedienung über die Tastatur**

Die Befehlszeile im Feld „Fahrstraße" nimmt Start und Ziel entgegen – `A N1`,
`West Ost` oder `Hauptstrecke Gleis 2`. Erlaubt sind Signalnamen, Ein-/Ausfahrten
und Bahnsteignamen; die passende Fahrstraßenkette wird gestellt.

**Zugdetails**

Ein Klick auf einen Zug in der Liste (oder im Kontextmenü des Gleisbildes) öffnet ein
Fenster mit Lauf, Zustand, Geschwindigkeit und zulässiger Geschwindigkeit, Zuglänge,
Beschleunigungs- und Bremswerten, Fahrerlaubnis, allen Halten mit Plan- und Ist-Zeiten
sowie den Schaltflächen „verfolgen", „Ersatzsignal anfordern" und „Zug streichen".

**Abfahrtstafel**

Je Bahnsteig werden die nächsten Abfahrten mit Ziel und Verspätung angezeigt.

---

## Mitgelieferte Stellwerke

| Vorlage | Besonderheit |
|---|---|
| Bahnhof Neustadt | Durchgangsbahnhof, 4 Bahnsteiggleise, 4 Streckenäste, Abstellgruppe, 2 Bahnübergänge |
| Kreuzungsbahnhof Waldheim | eingleisige Strecke – Zugkreuzungen müssen geplant werden |
| Kopfbahnhof Seestadt | 4 Kopfgleise, alle Züge wenden, eingleisige Zufahrt |
| Leeres Stellwerk | leeres Raster für eigene Entwürfe |

Über „Neu" lässt sich eine Vorlage auswählen; jede bringt Gleisplan, Signale und einen
passenden Fahrplan mit.

---

## Stellwerk-Editor

* **Gleis zeichnen** über das Raster; aus drei Gleisenden in einer Zelle entsteht eine
  Weiche, aus vier eine Kreuzung, die sich zur **Doppelkreuzungsweiche** umschalten lässt.
  Diagonalen sind erlaubt, übersprungene Zellen werden automatisch ergänzt.
* **Signale**: Hauptsignal, Haupt- mit Vorsignal am Mast, eigenständiges Vorsignal,
  Sperrsignal. Eigenschaften (Name, Art, eigener Durchrutschweg, Selbststellbetrieb,
  Sperre) über Rechtsklick.
* **Bahnsteige**, **Abstellgleise**, **Ein-/Ausfahrten**, **Bahnübergänge**
  (automatisch oder handbedient), **Geschwindigkeiten**, **Beschriftungen**.
* **Bausteine**: Gleisverbindung links/rechts, doppelte Gleisverbindung, Bahnsteiggleis,
  Überholgleis, Stumpfgleis mit Sperrsignal.
* **Rückgängig/Wiederholen** (Strg+Z / Strg+Y), Zoom, Rastergröße, Betriebsbeginn.
* **Gleisplan prüfen** meldet ungültige Zellen, doppelte Signalnamen, Signale ohne
  Gleisende, fehlende Ein-/Ausfahrten.

---

## Fahrplan

Zugnummer, Gattung (ICE bis Nahgüterzug und Lokfahrt mit passenden Geschwindigkeiten
und Längen), Einfahrt mit Uhrzeit, Ausfahrt, V<sub>max</sub> und Zuglänge.

* **Halte-Editor** je Zug: Bahnsteig, Ankunft, Abfahrt und **Anschlüsse** von anderen
  Zügen samt maximaler Wartezeit. Kurzschreibweise in der Tabelle:
  `Gleis 2@08:15/08:17>RE 4711`.
* **Wende**: ein Zug endet, wechselt nach der Wendezeit die Fahrtrichtung und verkehrt
  mit neuer Zugnummer zurück.
* **Taktlinien** anlegen (Gattung, Relation, Halt, erste Abfahrt, Takt, Anzahl, Wende).
* **Zufallsfahrplan** – verwendet nur Relationen, die im Gleisplan ohne
  Fahrtrichtungswechsel befahrbar sind.
* **Fahrplan prüfen** meldet unmögliche Relationen, Halte abseits des Fahrwegs,
  Zeitfehler und unbekannte Anschlusszüge. **CSV-Export**.

---

## Ereignisse

17 Störungsarten, einzeln abschaltbar, gewichtbar, mit einstellbarer Häufigkeit und
festem Zufalls-Seed für wiederholbare Läufe:

| Ereignis | Wirkung |
|---|---|
| Weichenstörung | Weiche lässt sich nicht mehr umstellen |
| Signalstörung | Signal zeigt keinen Fahrtbegriff – nur noch Ersatzsignal |
| Gleissperrung / Oberleitungsschaden | Abschnitt nicht befahrbar |
| Gleisfreimeldung gestört | Abschnitt meldet Falschbelegung, Grundstellung nötig |
| Stellwerksstörung | vorübergehend keine Fahrstraßen einstellbar |
| Bahnübergangsstörung | Schranken schließen nicht, Fahrten gesperrt |
| Verspätete Einfahrt / Personalmangel | Zug kommt später |
| Türstörung / Notarzteinsatz | verlängerte Haltezeit |
| Fahrzeugstörung | Zug fährt nur noch langsam |
| Personen im Gleis / Unwetter | Langsamfahrt im ganzen Bereich |
| Zugausfall | angekündigter Zug entfällt |
| Sonderzug / Lokfahrt | zusätzlicher, nicht im Fahrplan stehender Zug |

Störungen mit Entstörungsbedarf werden erst behoben, wenn der Entstörungsdienst
beauftragt wurde – das dauert je nach Störung einige Minuten.

---

## Bildfahrplan, Gleisbelegung, Auswertung, Einstellungen

* **Bildfahrplan**: Zeit-Weg-Linien je Strecke – durchgezogen die tatsächliche Fahrt
  (grün/gelb/rot nach Verspätung), gestrichelt der Fahrplan. Betriebsstellen und
  Bahnsteige sind als Waagerechte eingezeichnet, Kreuzungen und Überholungen dadurch
  gut erkennbar.
* **Gleisbelegung**: Zeit-Gleis-Diagramm mit geplanter (grau) und tatsächlicher
  (grün/rot) Belegung je Bahnsteig, mit Zeitmarke des laufenden Betriebs.
* **Auswertung**: Kennzahlen, Verspätungsverteilung als Diagramm und eine Tabelle
  aller Züge mit Plan- und Ist-Zeiten je Halt; CSV-Export.
* **Einstellungen**: Streckenmaßstab (Meter je Rasterzelle), Fahrdynamik-Faktor,
  Anfahrbeschleunigung und Bremsverzögerung mit den Profilen „Vorbildgetreu",
  „Zügig" und „Sehr zügig", Flankenschutz, Durchrutschweg und dessen Auflösezeit,
  Weichenumlaufzeit, Schließzeit der Bahnübergänge, Wartezeit der Hilfsauflösung,
  Mindesthaltezeit, Pünktlichkeitsgrenze, Geschwindigkeiten für Hp2, Zs1 und
  Rangierfahrten sowie Anzeigeoptionen.
* **Spielstände**: der laufende Betrieb (Uhrzeit, Züge, Fahrstraßen, Verschlüsse,
  Störungen, Bilanz) lässt sich speichern und wieder laden.
* Stellwerke liegen im `localStorage` und lassen sich als JSON exportieren und
  importieren – Gleisplan, Fahrplan, Ereignis- und Betriebseinstellungen in einer Datei.

---

## Tastenkürzel

| Taste | Wirkung |
|---|---|
| Leertaste | Start/Pause |
| `A` | Automatikbetrieb ein/aus |
| `R` | Rangierfahrstraßen-Modus |
| `1`…`6` | Zeitraffer 1× bis 60× |
| `+` / `−` | Gleisbild vergrößern/verkleinern |
| Esc | Auswahl abbrechen |
| Strg+Z / Strg+Y | Editor: rückgängig / wiederholen |
| F1 | Hilfe |

Fahrstraßen lassen sich auch über die Befehlszeile stellen: Start und Ziel eintippen
(`A N1`) und Enter drücken.

---

## Aufbau des Codes

| Datei | Inhalt |
|---|---|
| `js/model.js` | Datenmodell, Gleistopologie, Weichen- und DKW-Geometrie, Prüfung |
| `js/interlocking.js` | Wegesuche, Verschluss, Flankenschutz, Durchrutschweg, Signalbegriffe |
| `js/sim.js` | Uhr, Fahrdynamik, Belegung, Halte, Anschlüsse, Wenden, Zugfunk, Automatik, Spielstände |
| `js/events.js` | Zufallsgenerator, 17 Ereignisarten, Störungsverwaltung |
| `js/render.js` | Zeichnen des Gleisbildes |
| `js/editor.js` | Zeichenwerkzeuge, Bausteine, Rückgängig-Verwaltung |
| `js/timetable.js` | Fahrplandaten, Zufalls- und Taktgenerator, Fahrplanprüfung |
| `js/storage.js` | Stellwerke und Spielstände speichern, Im-/Export, Migration |
| `js/demo.js` | Beispielstellwerk „Bahnhof Neustadt" |
| `js/layouts.js` | weitere Stellwerksvorlagen (Kreuzungsbahnhof, Kopfbahnhof) |
| `js/main.js` | Oberfläche, Bedienung, Diagramme |

Zum Nachsehen in der Browserkonsole steht `window.stellwerk` mit `sim`, `layout` und
einigen Funktionen bereit.

### Modellannahmen

Eine Rasterzelle entspricht standardmäßig 50 m Gleis (einstellbar von 25 bis 200 m);
die Zuglänge wird in Zelleneinheiten gerechnet und skaliert mit.
Jede Zuggattung hat eigene Anfahr- und Bremswerte (S-Bahn 1,25 m/s², Güterzug
0,25 m/s²). Voreinstellungen: Durchrutschweg 200 m, Weichenumlaufzeit 6 s,
Mindesthaltezeit 30 s, Hilfsauflösung nach 90 s, Bahnübergang schließt in 25 s.
Pünktlich ist ein Zug mit weniger als 5 Minuten Verspätung bei der Ausfahrt.
Fahrtrichtungswechsel gibt es nur als geplante Wende; Automatik und Fahrplangenerator
verwenden deshalb nur durchgehend befahrbare Relationen. Die Automatik disponiert
jeweils nur bis zu einem „sicheren Platz" (Bahnsteig oder Ausfahrt), damit sich Züge
auf eingleisigen Abschnitten nicht gegenseitig verklemmen.
