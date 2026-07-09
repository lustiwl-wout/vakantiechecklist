# Vakantiechecklist

Slimme inpaklijsten voor je vakantie. Werkt op PC, tablet en mobiel.

Per gebruiker een eigen account. Bij het aanmaken van een reis kies je je bestemming op de kaart en vul je datums, reizigers, transport, weer, accommodatie en activiteiten in — de app genereert een inpaklijst op maat die je vrij kunt aanpassen.

## Functies

- **Slimme generator**: items op maat van land (EHIC, stekkertype, visum, valuta), reisduur (hoeveelheden kleding), leeftijden (baby t/m senior), weer, transport (incl. huurauto), accommodatie en activiteiten — inclusief reisapotheek en een "Voor vertrek"-takenlijst.
- **Mijn gezin**: gezinsleden eenmalig opslaan met geboortedatum; leeftijden worden berekend op de vertrekdatum. Losse medereizigers per reis met een leeftijdscategorie.
- **Reizigers-tabs**: ieders eigen spullen gefilterd afvinken; tellers voor aantallen (8/9 ingepakt); inklapbare categorieën met voortgang.
- **Bestemming op de kaart** (OpenStreetMap/Leaflet) met **omgevingsadvies**: pretparken, dierentuinen, natuur, musea en restaurants in de buurt, leeftijdsbewust gesorteerd, met grens-detectie (bv. milieuvignet-advies bij een dagje Duitsland). "Zet op mijn programma" werkt de paklijst direct bij.
- **Slimme suggesties bij wijzigingen**: pas je reisgegevens aan, dan stelt de app voor wat erbij moet én wat niet meer nodig is — bewust verwijderde items komen nooit terug.
- **Verder**: dupliceren voor een volgende reis, drag-en-drop herordenen, afdrukken op 1 A4, admin-portal voor gebruikersbeheer.

## Stack

- **Backend**: Node.js + Express 5
- **Database**: PostgreSQL (gehost op [Neon](https://neon.tech)), tabellen worden automatisch aangemaakt
- **Auth**: bcryptjs + JWT in een httpOnly cookie, rate limiting op inloggen
- **Frontend**: vanilla HTML/CSS/JS (SPA met hash-routing), Leaflet voor de kaart
- **Geo-data**: OpenStreetMap (Nominatim + Overpass) met cache in de database en achtergrond-prefetch
- **Hosting**: gratis web service op [Render](https://render.com)

## Lokaal draaien

1. `npm install`
2. Maak een gratis Postgres-database op [neon.tech](https://neon.tech) en kopieer de connection-string.
3. Kopieer `.env.example` naar `.env` en vul in:
   ```
   DATABASE_URL=postgresql://...
   JWT_SECRET=<willekeurige string van min. 32 tekens>
   ```
4. `npm start` (of `npm run dev` voor auto-reload)
5. Open http://localhost:3000

## Deployen op Render

1. Push deze repo naar GitHub.
2. Maak op Render een **New → Web Service** aan, kies de repo. Render leest `render.yaml` automatisch.
3. Env vars: `DATABASE_URL` = je Neon connection-string; `JWT_SECRET` wordt gegenereerd; `ADMIN_USER` en `ADMIN_PASSWORD` voor het admin-portal op `/admin` (optioneel — zonder deze vars is het portal uitgeschakeld).

> Let op: gratis Render-services slapen na ~15 minuten inactiviteit. De eerste request na een slaapperiode duurt 30–60 seconden.

## Bestandsoverzicht

```
server.js                 — entry point, error handling, SPA-fallback
db.js                     — Postgres-pool + schema (auto-migratie bij start)
auth.js                   — bcrypt + JWT helpers en middleware
ratelimit.js              — in-memory rate limiter (login/registratie)
templates.js              — slimme item-generator
countries.js              — landenlijst met reis-eigenschappen (EHIC, euro, stekker, visum)
routes/auth.js            — register / login / logout / me
routes/checklists.js      — CRUD op checklists, suggesties, bulk-acties
routes/items.js           — items afvinken / bewerken / verwijderen
routes/family.js          — gezinsleden beheren
routes/geo.js             — kaart-zoeken + omgevingsadvies (OSM, met cache)
routes/meta.js            — landenlijst voor de frontend
routes/admin.js           — admin-portal (gebruikersbeheer)
public/index.html         — SPA shell
public/style.css          — mobile-first styling + print op 1 A4
public/app.js             — SPA met hash-routing
render.yaml               — Render deployment config
```
