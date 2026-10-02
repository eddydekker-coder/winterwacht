# Winterwacht

Persoonlijke winter-app voor Ommen (of waar je bent).

- **5 dagen**: KNMI HARMONIE voor de eerste drie dagen, daarna ECMWF AIFS. Sneeuw- en vorstkansen komen uit het AIFS-ensemble.
- **14 dagen**: ensemble-pluimen (AIFS, IFS, GEFS, GEM, ICON) met T2m en T850. Per datum zie je of de nieuwste run kouder (blauw) of warmer (rood) is dan de vorige. Daarnaast een trend van dag 8–14 over de laatste runs en grootschalige signalen: NAO-benadering, oostenwind en blokkade boven Scandinavië.

De app draait als gewone website op GitHub Pages. Een GitHub Action kijkt elk uur of er een nieuwe modelrun is en bewaart een samenvatting in `data/history/`. Zo ontstaat vanzelf het archief voor de run-tot-run vergelijking.

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
- Als de officiële run-tijd niet via Open-Meteo te achterhalen is, toont de app het tijdstip waarop de run binnenkwam.
- Dagmaxima en -minima uit ensembles zijn gebaseerd op de tijdstappen van het model (bij AIFS 6-uurlijks). Daardoor worden extremen iets afgevlakt, maar de vergelijking tussen runs blijft eerlijk.
- De NAO-benadering is indicatief: het drukverschil Azoren–IJsland ten opzichte van een afgeronde maandklimatologie. Het is niet de officiële NOAA-index.

## Bestanden

| Bestand | Wat het doet |
|---|---|
| `index.html`, `styles.css`, `app.js` | De app zelf |
| `lib/stats.js` | Rekenwerk: dagstatistieken, run-vergelijking, wintermeter en signalen. Gedeeld door app en Action |
| `scripts/update.mjs` | Haalt nieuwe runs op en archiveert ze (draait in de Action) |
| `.github/workflows/update.yml` | Elk uur het updatescript draaien |
| `config.json` | Locaties met archief |
| `manifest.webmanifest`, `sw.js`, `icons/` | Installeerbaar op het beginscherm, werkt ook offline |
