# Winterwacht

Persoonlijke winter-app voor Ommen (of waar je bent).

- **5 dagen**: KNMI HARMONIE voor de eerste drie dagen, daarna ECMWF AIFS. Sneeuw- en vorstkansen komen uit het AIFS-ensemble.
- **14 dagen**: ensemble-pluimen (AIFS, IFS, GEFS, GEM, ICON) met T2m en T850. Per datum zie je of de nieuwste run kouder (blauw) of warmer (rood) is dan de vorige. Daarnaast een trend van dag 8–14 over de laatste runs en grootschalige signalen: NAO-benadering, oostenwind en blokkade boven Scandinavië.

- **Weerkaarten**: de nieuwste run van AIFS, ECMWF (IFS) en GFS in aparte tabs, plus een tab **Verschil** (EC−GFS, AIFS−EC, AIFS−GFS). Per verwachtingsmoment (+24 tot +240 uur) twee kaarten: luchtmassa en stroming (T850 met hoogtelijnen van 500 hPa) en druk met neerslag (isobaren en 6-uursneerslag, sneeuw in paars). Per model kun je met één knop het verschil met de run van 12 uur eerder tonen. Onder elke kaart staan vier regels: wat je ziet, zo lees je het, wat het model voor je locatie geeft (2 m-temperatuur, 10 m-wind en neerslag uit hetzelfde model en dezelfde run) en een controle (pluim, vorige run, voorspelbaarheid). Vaktermen zijn onderstreept en klikbaar (`lib/glossary.js`). De kaartvelden staan op de aparte tak `maps-data` (één commit, wordt telkens overschreven) en worden in de browser getekend.
- **Winter**: de lange termijn volgens ECMWF. EC46 geeft weekafwijkingen tot 46 dagen vooruit en wordt dagelijks bijgewerkt. SEAS5 geeft maandafwijkingen tot 7 maanden vooruit en wordt maandelijks op de 5e bijgewerkt. Per maand en per week zie je de wintermeter, de kans op kouder of warmer dan normaal, het verschil met de vorige uitgave, en hoe de verwachting voor december, januari en februari zich uitgave na uitgave ontwikkelt.

De app draait als gewone website op GitHub Pages. Een GitHub Action kijkt elk uur of er een nieuwe modelrun is, bewaart een samenvatting in `data/history/` en haalt (met Python) de kaartvelden van AIFS, ECMWF en GFS op. Zo ontstaat vanzelf het archief voor de run-tot-run vergelijking.

## Eenmalig instellen (± 10 minuten)

1. Maak op github.com een nieuwe **openbare** repository aan, bijvoorbeeld `winterwacht`.
2. Upload alle bestanden uit deze map, ook de verborgen map `.github`. Op een Mac zie je verborgen mappen in Finder met Cmd + Shift + punt.
3. Ga naar **Settings → Actions → General → Workflow permissions** en kies **Read and write permissions**. Sla op.
4. Ga naar **Settings → Pages**. Kies bij *Source* **Deploy from a branch**, branch **main**, map **/ (root)**. Sla op.
5. Ga naar **Actions → Nieuwe modelruns ophalen → Run workflow** om de eerste run meteen op te halen. Daarna gebeurt dit elk uur vanzelf.
6. Na een paar minuten staat de app op `https://<jouw-gebruikersnaam>.github.io/winterwacht/`.

## Op je iPhone zetten

Open de link in **Safari** → deelknop → **Zet op beginscherm**. De app opent dan schermvullend, met het sneeuwvlok-icoon.

## Delen met andere liefhebbers

Stuur gewoon de link. Iedereen kan via het locatiemenu zijn eigen plaats kiezen. Het run-archief van de GitHub Action geldt voor de plaatsen in `config.json`. Voor andere plaatsen bouwt de app een eigen geschiedenis op in de browser van die gebruiker, telkens wanneer de app wordt geopend.

Een extra vaste locatie met archief toevoegen? Voeg een regel toe in `config.json`:

```json
{ "id": "winterswijk", "name": "Winterswijk", "lat": 51.97, "lon": 6.72 }
```

## Goed om te weten

- Data: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0, gratis voor niet-commercieel gebruik).
- Kaarten: ECMWF open data (IFS en AIFS, CC BY 4.0) en NOAA GFS (publiek domein). De kaartuitleg is een momentopname uit het model zelf (2 m-temperatuur, 10 m-wind) en wordt gecontroleerd tegen de pluim. Sneeuw geldt bij T850 onder ca. −3°C én 2 m-temperatuur onder ca. 2°C. Het is bedoeld om kaartlezen te leren, niet als lokale verwachting. Dagmaxima en -minima staan in de pluimen en uurwaarden, niet op de kaart.
- Als de officiële run-tijd niet via Open-Meteo te achterhalen is, toont de app het tijdstip waarop de run binnenkwam.
- Dagmaxima en -minima uit ensembles zijn gebaseerd op de tijdstappen van het model (bij AIFS 6-uurlijks). Daardoor worden extremen iets afgevlakt, maar de vergelijking tussen runs blijft eerlijk.
- De NAO-benadering is indicatief: het drukverschil Azoren–IJsland ten opzichte van een afgeronde maandklimatologie. Het is niet de officiële NOAA-index.

## Bestanden

| Bestand | Wat het doet |
|---|---|
| `index.html`, `styles.css`, `app.js` | De app zelf |
| `lib/stats.js` | Rekenwerk: dagstatistieken, run-vergelijking, wintermeter en signalen. Gedeeld door app en Action |
| `lib/longrange.js` | Rekenwerk voor de lange termijn (EC46 en SEAS5) |
| `scripts/update.mjs` | Haalt nieuwe runs op en archiveert ze (draait in de Action) |
| `scripts/maps.py` | Haalt de laatste AIFS-, ECMWF- en GFS-run (en de run 12 uur eerder) op en bewaart kaartvelden op 1 graad; de Action publiceert ze op de tak `maps-data` |
| `lib/maps.js`, `lib/glossary.js`, `lib/coast.json` | Tekent de kaarten, schrijft de uitleg per kaart en bevat de begrippenlijst; kustlijnen en landsgrenzen (Natural Earth, publiek domein) |
| `.github/workflows/update.yml` | Elk uur het updatescript draaien |
| `config.json` | Locaties met archief |
| `manifest.webmanifest`, `sw.js`, `icons/` | Installeerbaar op het beginscherm, werkt ook offline |
