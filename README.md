# Buchhaltung Rapid Openair

Windows-Desktop-App für die Buchhaltung des Rapid Openair: Buchungen, Konten, Bilanz und Erfolgsrechnung,
Kontoauszug, Einlesen der Kontobewegungen aus dem E-Banking der GKB mit Buchungsvorschlägen und Dossier als PDF.
Herausgelöst aus der Buchhaltung GmbH der App [Zeiterfassung](https://github.com/fcanetg-prog/zeiterfassung);
beide Apps sind voneinander unabhängig und können nebeneinander installiert sein.

## Installieren

Unter **Releases** die neuste `Buchhaltung-Rapid-Openair-Setup-x.y.z.exe` herunterladen und doppelklicken.
Bei der Windows-Warnung «Weitere Informationen» und dann «Trotzdem ausführen» wählen.
Ein Update installiert man gleich; die Daten bleiben erhalten.

## Daten

Die Daten liegen als eine Datei unter `Dokumente\Buchhaltung Rapid Openair\rapid-buchhaltung-daten.json`
(änderbar unter Einstellungen, z. B. in den Dropbox-Ordner für zwei Rechner). Im Unterordner `Sicherungen`
liegt pro Tag eine Kopie, im Unterordner `Dossiers` die als PDF gespeicherten Dossiers.
In diesem Repository liegen keine Daten.

Das Geschäftsjahr beginnt am 1. Dezember und trägt die Jahreszahl, in der es endet (Geschäftsjahr 2026 =
01.12.2025 bis 30.11.2026); der Beginn ist unter Einstellungen änderbar.

Der Kontenplan wird pro Geschäftsjahr als JSON-Datei importiert:

    { "typ": "kontenplan", "jahr": 2026, "gjBeginn": "12-01", "kontenplan": [ { "sektion": "", "gruppe": "", "konto": "1010", "text": "Bankkonto GKB", "bklasse": "1", "summe_in": "100" }, … ] }

Optional mit `"buchungen": [ … ]`. Das Folgejahr lässt sich in der App aus dem Vorjahr eröffnen.

## Entwickeln

    npm install
    npm start        # App starten
    npm test         # Rechenlogik prüfen
    npm run dist     # Installer bauen (auf Windows)

Jeder Push auf `main` baut den Installer über GitHub Actions und legt einen Release an.
