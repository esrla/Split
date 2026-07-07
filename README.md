# Split

Serverløs utgiftsdeling med GitHub som lagring.

Split er en enkel mobilvennlig webapp for å holde oversikt over fellesutgifter, for eksempel på ferie. Appen kjører som statisk HTML via GitHub Pages, mens data lagres i et GitHub-repo som en JSONL-logg.

## Hvordan det fungerer

Appen har ingen egen backend.

I stedet brukes GitHub som lagring:

```
Mobilnettleser
   ↓
GitHub Pages
   ↓
GitHub API
   ↓
ledger.jsonl
```

Alle hendelser lagres som egne linjer i `ledger.jsonl`.

Eksempel:

```
{"id":"init","type":"trip.created","name":"Split","createdAt":"2026-07-06T00:00:00.000Z"}
{"id":"abc123","type":"household.added","householdId":"familien-eskil","name":"Familien Eskil","createdAt":"2026-07-06T12:00:00.000Z"}
{"id":"def456","type":"expense.added","household":"familien-eskil","name":"Familien Eskil","description":"Middag","nok":420,"createdAt":"2026-07-06T18:00:00.000Z"}
```

Appen leser loggen, beregner saldoer lokalt i nettleseren, og skriver nye hendelser tilbake til GitHub.

## Bruk

Åpne appen i nettleseren:

https://esrla.github.io/Split/

Første gang må du legge inn:

* GitHub-repo for lagring
* Branch
* Datafil
* GitHub-token

Standardverdier:

```
Repo:   https://github.com/esrla/Frankrike2026
Branch: main
Data:   ledger.jsonl
```

Trykk deretter *Lagre oppsett* og *Last data*.

Hvis `ledger.jsonl` ikke finnes, oppretter appen filen automatisk.

## GitHub-token

For at appen skal kunne lese og skrive data, trenger den en GitHub-token.

Tokenen skal ha tilgang til lagringsrepoet og følgende rettighet:

```
Contents: Read and write
```

Tokenen lagres kun lokalt i nettleseren på enheten du bruker. Den skal ikke legges inn i repoet, og den skal ikke hardkodes i `index.html`.

## Husholdninger

Legg inn husholdningene under *Husholdninger*.

Eksempel:

```
Familien Eskil
Familien Anna
Hyttegjestene
```

Appen lager en intern `householdId` basert på navnet (slug).

## Utgifter

For hver utgift legger du inn:

* hvem som betalte
* beløp (NOK)
* beskrivelse

Alle utgifter deles automatisk mellom alle husholdninger.

## Vekting

Når du ser på status, kan du angi hvor mange personer det er i hver husholdning.

Eksempel:

- Husholdning A = 9
- Husholdning B = 1

Da fordeles alle utgifter 90/10 i stedet for 50/50.

Vektingen lagres lokalt i nettleseren og brukes kun i utregningen. Selve loggen lagrer bare hvem som betalte, beskrivelse og NOK for utgiftene.

## Dataformat

Data lagres som JSONL, altså én JSON-hendelse per linje.

Dette gjør at filen fungerer som en enkel append-only logg. Gamle hendelser trenger normalt ikke endres. Nye husholdninger og utgifter legges til som nye linjer.

### Husholdnings-hendelse

```json
{
  "id": "uuid",
  "type": "household.added",
  "householdId": "familien-eskil",
  "name": "Familien Eskil",
  "createdAt": "2026-07-06T12:00:00.000Z"
}
```

### Utgift-hendelse

```json
{
  "id": "uuid",
  "type": "expense.added",
  "household": "familien-eskil",
  "name": "Familien Eskil",
  "nok": 420,
  "description": "Middag",
  "createdAt": "2026-07-06T18:00:00.000Z"
}
```

Beløp er alltid i NOK. Valuta lagres ikke i dataene.

## Sikkerhet

Ikke legg ekte økonomidata i et offentlig repo hvis du ikke vil at andre skal kunne se dem.

Anbefalt oppsett:

* Frontend/app: kan være offentlig
* Data/ledger: bør være privat
* Token: kun lokalt i nettleseren

For enkel testing kan app og data ligge i samme repo, men vær oppmerksom på at GitHub Pages fra private repo kan kreve betalt GitHub-plan.

## Begrensninger

Dette er en enkel proof-of-concept.

Kjente begrensninger:

* ingen innlogging utover GitHub-token
* ingen avansert konflikthåndtering
* ingen sletting eller redigering av utgifter i brukergrensesnittet
* saldo viser foreløpig bare netto balanse per husholdning

## Utviklingsidé

Mulige neste steg:

* oppgjørsforslag: "Anna betaler 140 NOK til Eskil"
* redigering/sletting via nye korrigerende hendelser
* eksport/import
* bedre feilmeldinger ved GitHub-token-problemer
* egen app-cache/PWA-støtte
