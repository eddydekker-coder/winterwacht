// Begrippenlijst voor de Weerkaarten. In teksten staat [[id|zichtbare tekst]]; linkTerms() maakt er een
// onderstreepte knop van die de uitleg opent. Uitleg is bedoeld om kaartlezen te leren.

export const GLOSS = {
  z500: { t: 'Geopotentiaalhoogte 500 hPa (Z500)', d: [
    'Het niveau waar de luchtdruk 500 hPa is, ligt gemiddeld op ca. 5,5 km hoogte. De hoogte van dat niveau (in geopotentiële meters, gpm; op de kaart in decameter) zegt iets over de gemiddelde temperatuur van de luchtkolom eronder: warme lucht zet uit, dus het niveau ligt hoger; koude lucht trekt samen, dus lager.',
    'Lijnen van gelijke hoogte lopen (bijna) evenwijdig aan de stroming. Zo zie je troggen, ruggen en de straalstroom in één oogopslag.',
    'Rond 5500 gpm (550 dam) ligt grofweg de grens tussen koude en milde lucht boven West-Europa. Onder 5300 gpm is het in de winter echt koud.'] },
  t850: { t: 'Temperatuur op 850 hPa (T850)', d: [
    'De temperatuur op ca. 1,5 km hoogte. Daar heeft de grond nauwelijks invloed meer, dus T850 laat de luchtmassa zien: waar komt de lucht vandaan en hoe koud of zacht is die?',
    'T850 is niet de temperatuur die je buiten voelt. Het verschil met de temperatuur op 2 m hangt af van bewolking, wind, zon, sneeuwdek en de [[inversie]]. In de winter ligt het dagmaximum ruwweg 3 tot 9° boven T850: bij zon en droge lucht meer, onder dikke laagbewolking of bij mist soms nauwelijks. Daarom gebruikt deze app voor de temperatuur bij je locatie de 2 m-temperatuur uit het model zelf en niet een vuistregel uit T850.',
    'Sneeuw is in Nederland pas aannemelijk als T850 onder ca. −3 à −4°C komt én het aan de grond rond of onder 1°C is.'] },
  t2m: { t: 'Temperatuur op 2 m', d: [
    'De temperatuur op de hoogte van een weerhut (2 m). Dit is de temperatuur die je als „het weer” kent.',
    'In de kaarten is het een momentopname op het gegeven tijdstip: een run van 12Z geeft 13:00 of 14:00 lokale tijd, vlak bij het dagmaximum in de winter; een run van 00Z geeft 01:00 of 02:00, midden in de nacht. De pluimen en uurwaarden geven de dagextremen; die liggen dus anders dan een momentopname.',
    'Het model rekent op een raster van ca. 10 à 25 km, hier teruggebracht tot 1°. Lokale effecten (stad, bos, zandgrond, mist) zitten er niet in.'] },
  mslp: { t: 'Luchtdruk op zeeniveau (MSLP)', d: [
    'De luchtdruk herleid naar zeeniveau, zodat plekken op verschillende hoogte vergelijkbaar zijn. Op de kaart zie je dit als [[isobaren]].',
    'Lage druk (L) betekent dat lucht samenkomt en opstijgt: wolken, neerslag, vaak wind. Hoge druk (H) betekent dalende lucht: droger en rustiger, in de winter met mist of vorst bij opklaringen.',
    'Het absolute getal zegt weinig; het gaat om de verschillen over de afstand (het [[drukgradient]]).'] },
  isobaren: { t: 'Isobaren', d: [
    'Lijnen die plekken met dezelfde luchtdruk (op zeeniveau) verbinden. Hier om de 4 hPa getekend.',
    'Zoals hoogtelijnen op een topografische kaart: dicht bij elkaar betekent een steil drukverval, en dus harde wind.',
    'Wind waait bij benadering langs de isobaren, niet er dwars doorheen. Zie [[geostrofisch]] en [[buysballot]].'] },
  drukgradient: { t: 'Drukgradient', d: [
    'Het verval van de luchtdruk over een afstand, hier in hPa per 100 km. De druk drijft de wind aan: hoe groter de gradiënt, hoe sterker de [[geostrofisch|geostrofische wind]].',
    'Richtwaarden voor West-Europa op 52°N: 1 hPa per 100 km geeft ca. 25 km/u in de vrije atmosfeer; 4 hPa per 100 km ca. 100 km/u.',
    'Aan de grond remt [[wrijving]] de wind af tot ruwweg 50 à 70% daarvan en draait hem naar de lage druk toe.'] },
  geostrofisch: { t: 'Geostrofische wind', d: [
    'Het evenwicht tussen de drukkracht (van hoog naar laag) en de Corioliskracht (door de draaiing van de aarde). Het resultaat is wind die langs de isobaren waait, met lage druk links van de windrichting op het noordelijk halfrond.',
    'In de vrije atmosfeer (boven ca. 1 km) klopt dit goed. Aan de grond verstoren [[wrijving]] en de kromming van de isobaren (gradiëntwind) het beeld.',
    'De app rekent de geostrofische wind uit het drukveld en toont daarnaast de 10 m-wind van het model zelf. Het verschil is wrijving.'] },
  wrijving: { t: 'Wrijving en grenslaag', d: [
    'In de onderste ca. 1 km (de planetaire grenslaag) remt de grond de wind af. De wind draait daardoor ca. 15 tot 30° naar de lagedrukzijde en is boven land 50 tot 70% van de geostrofische wind.',
    'Boven zee is de wrijving kleiner dan boven land, dus de kuststreek krijgt meer wind dan het binnenland. Ommen ligt ver van zee: de wind aan de grond is er zwakker dan de isobaren doen vermoeden.',
    'Windstoten (vlagen) komen uit hogere lagen naar beneden en zitten niet in de kaartvelden. Bij stevige wind zijn vlagen vaak 1,5 tot 2 keer de gemiddelde wind.'] },
  buysballot: { t: 'Wet van Buys Ballot', d: [
    'Op het noordelijk halfrond geldt: sta met de wind in de rug, dan ligt de lage druk links en de hoge druk rechts (iets naar voren gedraaid door [[wrijving]]).',
    'Rond een lagedrukgebied draait de wind dus linksom (tegen de klok in), rond een hogedrukgebied rechtsom.',
    'Bij een depressie die ten noorden van je passeert krijg je dus eerst zuidenwind, daarna westenwind, en na het koufront noordwest.'] },
  trog: { t: 'Trog', d: [
    'Een U-vormige uitbuiging van de [[z500|hoogtelijnen]] naar het zuiden: een golf met lage hoogte en koude lucht. Het is een lange golf in de bovenstroming (Rossbygolf).',
    'Vóór de troggenas stroomt warme lucht omhoog (stijgende lucht: bewolking, regen, vaak dalende druk). Achter de as zakt koude lucht naar het zuiden (buien, opklaringen, frisse noordwestelijke wind).',
    'Een trog die zich diep naar het zuiden uitbuigt en afsnijdt, heet een afgesneden lage (cut-off low). Die beweegt traag en is lastig te voorspellen.'] },
  rug: { t: 'Rug', d: [
    'Een bult in de [[z500|hoogtelijnen]] naar het noorden: hoge hoogte en meestal warmere lucht. Onder een rug daalt de lucht (subsidentie), dus rustig en droog weer.',
    'In de winter kan onder een rug door uitstraling bij een heldere nacht vorst ontstaan, of hardnekkige mist en laagbewolking onder een [[inversie]].',
    'Een rug die blijft staan en lage drukgebieden tegenhoudt heet een [[blokkade]].'] },
  straalstroom: { t: 'Straalstroom (jet)', d: [
    'Een smalle band met zeer harde wind op ca. 9 à 11 km hoogte, op de grens tussen koude en milde lucht. Op de kaart herken je hem aan hoogtelijnen die dicht op elkaar liggen.',
    'De straalstroom stuurt de depressies. Ligt hij vlak en westelijk boven de Noordzee, dan krijgt Nederland de ene depressie na de andere uit het westen (zacht, nat, winderig). Een kronkelende jet met troggen en ruggen laat koude lucht tot ver naar het zuiden komen.',
    'Op 500 hPa geldt ca. 30 m/s (110 km/u) of meer als stevig.'] },
  advectie: { t: 'Advectie', d: [
    'Het aanvoeren van een luchtmassa door de wind. Warmteadvectie = warmere lucht komt aan; koudeadvectie = koudere lucht komt aan.',
    'Je beoordeelt dit door stroomopwaarts te kijken: welke T850 ligt er 500 à 1000 km tegen de bovenstroming in? Die lucht bereikt je binnen ca. een dag.',
    'Zeewater verwarmt of koelt de lucht onderweg: koude lucht uit het oosten over land blijft koud, uit het noorden over de Noordzee wordt hij zachter en onstabieler (buien).'] },
  inversie: { t: 'Inversie', d: [
    'Een laag waarin de temperatuur met de hoogte toeneemt in plaats van afneemt. Zij werkt als deksel: de lucht eronder kan niet opstijgen.',
    'In de winter ontstaat een inversie vaak onder hoge druk: de grond straalt uit en koelt de onderste lucht, terwijl er boven warmere lucht ligt. Dan blijven laagbewolking en mist hangen, ook als T850 mild is, en blijft het dagmaximum laag.',
    'Modellen hebben moeite met de [[grenslaagwolk|hardnekkige laagbewolking]] onder zo’n inversie; daar zit vaak de fout in de maximumtemperatuur.'] },
  grenslaagwolk: { t: 'Laagbewolking onder een inversie', d: [
    'Stratus of hoogneveldek dat onder een [[inversie]] vastzit. Zonlicht in december bereikt de grond nauwelijks, dus de dag wordt nauwelijks warmer dan de nacht.',
    'Of die bewolking in het model wegbrandt of blijft, is een van de lastigste punten bij hoge druk in de winter. Eén run kan 4° meer of minder maximumtemperatuur geven op die ene aanname.',
    'Controleer in zulke situaties de pluim (de bandbreedte van het ensemble) en niet één lijn.'] },
  uitstraling: { t: 'Nachtvorst en uitstraling', d: [
    'Bij een heldere hemel en weinig wind straalt de grond warmte uit. De temperatuur op 2 m daalt dan sterk, ook als de luchtmassa (T850) niet echt koud is.',
    'Wolken en wind verhinderen dit: een bewolkte of winderige nacht blijft vorstvrij.',
    'Een raster van 10 à 25 km (en hier 1°) kan lokale koudegaten niet goed laten zien; Ommen en het Vechtdal kunnen kouder worden dan het model zegt.'] },
  anomalie: { t: 'Anomalie', d: [
    'Het verschil met het gemiddelde voor die tijd van het jaar (de klimatologie). „3° kouder dan normaal” zegt meer dan „2°C”, omdat de normaal in de winter zelf al sterk verandert.',
    'Deze app vergelijkt de 2 m-temperatuur met de normalen van De Bilt (1991–2020) die ook in de rest van de app gebruikt worden, en T850 met een eigen benadering van de normaal. Die laatste is ruw, dus let op het teken en de orde van grootte, niet op de decimaal.'] },
  ensemble: { t: 'Ensemble en pluim', d: [
    'Een ensemble bestaat uit veel runs (bij ECMWF 51, bij GEFS 31) met licht gewijzigde beginvoorwaarden. De spreiding tussen die leden is de onzekerheid.',
    'Een pluim toont al die leden voor één plek. Dicht bij elkaar = het model is zeker; wijd uiteen = scenario’s lopen uit.',
    'Het gemiddelde van alle leden is geen echt weerbeeld, maar vlakt uit. Lees daarom altijd ook de bandbreedte (P10 tot P90), niet alleen het gemiddelde.'] },
  deterministisch: { t: 'Deterministische run', d: [
    'Eén enkele modelrun op het fijnste raster (IFS HRES 9 km, GFS 13 km; hier gedownload op 0,25° en teruggebracht tot 1°). Hij heeft het meeste detail maar is slechts één van de mogelijke scenario’s.',
    'Daardoor kan een deterministische kaart er duidelijk anders uitzien dan de pluim, zeker na 5 dagen: de run kan aan de rand van het ensemble zitten.',
    'Lees een deterministische run altijd samen met het ensemble en kijk naar de [[runvergelijking|vorige runs]].'] },
  voorspelbaarheid: { t: 'Voorspelbaarheidshorizon', d: [
    'Elk weerverschijnsel heeft een eigen horizon waarna een model het niet meer betrouwbaar kan plaatsen: fronten en kleine lagedrukgebieden ca. 4 à 5 dagen, grote systemen (depressies, hogedrukgebieden) 6 à 7 dagen, planetaire golven (de grote troggen en ruggen) 8 à 9 dagen.',
    'Dus: op +120 uur kun je het grote drukpatroon vertrouwen, maar de plaats van een regenzone nog niet. Op +240 uur is alleen het patroon als scenario bruikbaar.',
    'Deze horizonnen zijn richtwaarden uit de praktijk van modelbeoordeling, geen vaste grens; ze hangen af van de weersituatie.'] },
  runvergelijking: { t: 'Run-tot-run vergelijking', d: [
    'Vergelijk de nieuwste run met die van 12 uur (en 24 uur) eerder voor dezelfde geldigheidstijd. Een model dat steeds dezelfde kant op schuift, wijst op een echte trend; een model dat heen en weer springt („springerigheid”) is onzeker.',
    'Praktijkregel: dempen. Een sprong van 2 à 3° in één update is zelden de nieuwe waarheid; wacht tot de volgende run het bevestigt, en kijk of andere modellen meegaan.',
    'In de weergave „t.o.v. vorige run” toont de kleur het verschil (nieuw min oud) en de gestippelde lijnen de oude run.'] },
  blokkade: { t: 'Blokkade', d: [
    'Een stationair hogedrukgebied of rug op hoge breedte (boven Scandinavië, IJsland of Groenland) dat de normale westenstroming verstoort. Depressies moeten eromheen of blijven weg.',
    'Een blokkade ten noorden of oosten van ons is in de winter de belangrijkste voorwaarde voor aanhoudende kou in Nederland, doordat er oostenwind uit Rusland of Scandinavië ontstaat.',
    'Blokkades en hun einde zijn berucht moeilijk voor modellen; vertrouw ze pas als ze in meerdere runs en in het ensemble terugkomen.'] },
  nao: { t: 'NAO', d: [
    'De Noord-Atlantische Oscillatie: het drukverschil tussen de Azoren (hoog) en IJsland (laag). Is dat verschil groot (positieve NAO), dan is de westenstroming sterk en de winter zacht en nat. Is het klein of omgekeerd (negatieve NAO), dan is de stroming zwak of meridionaal en kan koude lucht komen.',
    'De NAO is geen voorspelling maar een kenmerk van het patroon. Zie ook [[teleconnectie|teleconnecties]]. Scenario’s met negatieve NAO en een blokkade geven de grootste kans op winterweer in Nederland.'] },
  uitlopers: { t: 'Depressie-uitlopers en randstoringen', d: [
    'Een diepe depressie die ver weg (bijvoorbeeld bij IJsland of Schotland) ligt, stuurt fronten en regenbanden mee die onze streek als uitlopers of randstoringen bereiken. Het centrum zelf blijft ver weg.',
    'Typisch beeld: wisselende bewolking, regenbanden met opklaringen ertussen en een zuidwest- tot westenwind. Een tussenliggende rug kan even een zonnige, droge dag geven.',
    'De plaats en timing van zulke banden zijn op meer dan 3 à 4 dagen vooruit lastig, omdat de breedte van een front kleiner is dan wat het model nauwkeurig kan plaatsen.'] },
  teleconnectie: { t: 'Teleconnecties (NAO, SSW, El Niño)', d: [
    'Teleconnecties zijn vaste verbanden tussen drukpatronen op verre plekken, zoals de [[nao|NAO]]. Ze verschuiven het gemiddelde weer, maar bepalen niet de afzonderlijke dag.',
    'Een losse dagkaart wijkt meestal af van het klimatologisch patroon (winter: lage druk bij IJsland, hoge druk bij de Azoren, dus zuidwestenwind). Pas gemiddelden over weken laten het patroon zien. Na een grote stratosferische opwarming (SSW) is het drukverschil tussen IJsland en de Azoren gemiddeld kleiner, wat kou kansrijker maakt.',
    'Teleconnecties werken ook voorbij de voorspelbaarheidshorizon, maar je hebt meerdere weken nodig voor een betrouwbaar gemiddelde. Ze zijn dus een achtergrond voor de seizoensverwachting, geen hulpmiddel voor een dagkaart.'] },
  neerslag6: { t: 'Neerslag over 6 uur', d: [
    'De hoeveelheid neerslag (mm) die in het model in de 6 uur vóór het getoonde tijdstip viel, gemiddeld over ca. 1° (ca. 100 km).',
    'Daarom zie je op de kaart zachte vlakken in plaats van smalle buienlijnen. Het is geschikt om fronten en neerslaggebieden te volgen, niet om de buien boven Ommen te voorspellen.',
    '1 mm water geeft ruwweg 1 tot 1,5 cm natte sneeuw of 1,5 tot 2 cm droge sneeuw.'] },
  sneeuwgrens: { t: 'Sneeuwgrens en neerslagtype', d: [
    'Neerslag valt als sneeuw als de lucht er van boven tot onder koud genoeg voor is. Als vuistregel: T850 onder ca. −3 à −4°C en een 2 m-temperatuur rond of onder 1°C.',
    'Het verschil tussen sneeuw en regen is vaak één graad in een dunne laag boven de grond. Daarom zijn kaarten op 1° nooit het laatste woord: kijk ook naar de pluim (sneeuwkans) en de uurwaarden.',
    'In de kaart kleurt neerslag paars waar deze vuistregel voldaan is.'] },
  beaufort: { t: 'Windkracht (Beaufort)', d: [
    'Schaal van 0 tot 12 voor de gemiddelde wind op 10 m. Windkracht 4 = 20–28 km/u, 6 = 39–49 km/u, 8 = 62–74 km/u (storm begint bij 9).',
    'De kaart toont de 10 m-wind uit het model: een gemiddelde over het raster, geen vlagen.'] },
  ifs: { t: 'ECMWF IFS (HRES)', d: [
    'Het deterministische hoofdmodel van het Europese weercentrum (ECMWF, Reading): fysisch model op ca. 9 km, 4 runs per dag, waarvan 00Z en 12Z tot 10 dagen vooruit.',
    'Vaak het betrouwbaarste middellangetermijnmodel in Europa, maar ook IFS levert van één run een scenario: lees het met het ensemble.'] },
  aifs: { t: 'ECMWF AIFS', d: [
    'Het AI-model van ECMWF (Artificial Intelligence Forecasting System). Het is getraind op decennia aan analyses en rekent veel sneller dan een fysisch model, op 0,25°.',
    'AIFS is vaak zo goed als IFS en soms beter bij grote patronen, maar het heeft minder fysische details (neerslagextremen, grenslaag, vlagen). Een groot verschil tussen AIFS en IFS is een teken van onzekerheid.'] },
  gfs: { t: 'NOAA GFS', d: [
    'Het Amerikaanse deterministische model (13 km), 4 runs per dag. Open data, daarom veel gebruikt.',
    'In Europa meestal iets minder nauwkeurig dan ECMWF en vaak minder stabiel van run tot run. Een verschil tussen ECMWF en GFS zegt iets over de onzekerheid; de waarheid ligt niet automatisch bij één van de twee.'] },
  verschilkaart: { t: 'Verschilkaart', d: [
    'Toont model A min model B voor dezelfde run en hetzelfde moment. Rood: A is warmer (bij T850) of heeft hogere druk. Blauw: A is kouder of heeft lagere druk. Wit: de modellen zijn het eens.',
    'De zwarte lijnen zijn de hoogte of druk van model A, de gestippelde lijnen die van model B. Liggen de lijnen over elkaar, dan zijn de patronen gelijk. Een verschuiving van een trog van 200 km geeft grote temperatuurverschillen langs de rand.',
    'Verschillen onder ca. 1,5° of 4 hPa kun je zien als „modellen eens”. Grote verschillen markeren de onzekere gebieden.'] },
  raster: { t: 'Raster en resolutie', d: [
    'De modelvelden zijn hier teruggebracht tot 1°, ca. 110 km noord-zuid en 70 km oost-west op deze breedte. Uurwaarden en pluimen komen uit Open-Meteo en horen bij gridpunten van ca. 10 à 25 km (de eerste dagen KNMI HARMONIE, 2,5 km).',
    'De kaarten zijn bedoeld om het patroon te leren lezen. Voor details op de plek zelf gelden de pluimen en uurwaarden.'] },
  hpa: { t: 'hPa en gpm', d: [
    'Hectopascal (hPa) is de eenheid van luchtdruk; 1 hPa = 1 millibar. Gemiddeld is de druk op zeeniveau 1013 hPa; onder ca. 1000 is het laag, boven ca. 1020 hoog.',
    'Geopotentiële meter (gpm) is vrijwel gelijk aan de hoogte in meters, gecorrigeerd voor de zwaartekracht. 60 gpm = 6 decameter (dam).'] },
};

const escHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Zet [[id|tekst]] of [[id]] in al ge-escapete tekst om in een onderstreepte knop.
export function linkTerms(html) {
  return html.replace(/\[\[([a-z0-9]+)(?:\|([^\]]+))?\]\]/gi, (m, id, label) => {
    const g = GLOSS[id];
    if (!g) return label || id;
    return `<button type="button" class="term" data-t="${id}">${label || escHtml(g.t.toLowerCase())}</button>`;
  });
}

export function termSheet(id) {
  const g = GLOSS[id];
  if (!g) return null;
  return { title: g.t, html: g.d.map((p) => `<p>${linkTerms(escHtml(p))}</p>`).join('') };
}
