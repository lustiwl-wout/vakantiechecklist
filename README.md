# Vakantiechecklist

Slimme inpaklijsten voor je vakantie. Werkt op PC, tablet en mobiel.

Per gebruiker een eigen account. Bij het aanmaken van een lijst vul je je bestemming, datums, reizigers (met leeftijd), transport, verwacht weer, accommodatie en geplande activiteiten in — de app maakt op basis daarvan een passende inpaklijst die je vervolgens vrij kunt aanpassen.

## Stack

- **Backend**: Node.js + Express
- **Database**: PostgreSQL (gehost op [Neon](https://neon.tech))
- **Auth**: bcryptjs + JWT in een httpOnly cookie
- **Frontend**: vanilla HTML/CSS/JS (SPA met hash-routing)
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

De database-tabellen worden automatisch aangemaakt bij de eerste start.

## Deployen op Render

1. Push deze repo naar GitHub.
2. Maak op Render een **New → Web Service** aan, kies de repo. Render leest `render.yaml` automatisch.
3. Bij de env vars: vul `DATABASE_URL` in met je Neon connection-string. `JWT_SECRET` wordt automatisch gegenereerd.
4. Eerste deploy duurt een paar minuten — daarna is de site live op je `*.onrender.com`-URL.

> Let op: gratis Render-services slapen na ~15 minuten inactiviteit. De eerste request na een slaapperiode duurt 30–60 seconden.

## Hoe de slimme sjabloon werkt

In `templates.js` staat één functie `generateItems(...)` die op basis van de inputs een lijst items oplevert. Voorbeelden:

| Input                            | Wat er gebeurt                                                  |
|----------------------------------|-----------------------------------------------------------------|
| Reiziger jonger dan 2            | Luiers, flesvoeding, knuffel, reisbedje, etc.                   |
| Reiziger 5–12                    | Speelgoed, tablet voor onderweg                                 |
| Reiziger 65+                     | Extra medicatie + recepten                                      |
| Weer = warm                      | Zonnebrand, zonnebril, hoed, lichte kleding                     |
| Weer = koud                      | Winterjas, muts, sjaal, thermo-ondergoed                        |
| Accommodatie = camping           | Tent, slaapzak, zaklamp, kookspullen                            |
| Activiteit = skiën               | Ski-jas, skihelm, skipas                                        |
| Transport = vliegtuig            | Boarding pass, vloeistoffen <100ml, powerbank-waarschuwing      |
| Bestemming buiten EU/euro-zone   | Stekkeradapter, vreemde valuta, paspoort i.p.v. ID              |
| Reisduur                         | Hoeveelheden ondergoed/sokken/shirts schalen mee                |

De gegenereerde lijst is een startpunt — alle items zijn vrij te bewerken, te verwijderen, of zelf toe te voegen.

## Bestandsoverzicht

```
server.js                 — entry point
db.js                     — Postgres-pool + auto-migratie
auth.js                   — bcrypt + JWT helpers en middleware
templates.js              — slimme item-generator
routes/auth.js            — register/login/logout/me
routes/checklists.js      — CRUD op checklists + items aanmaken
routes/items.js           — items afvinken / hernoemen / verwijderen
public/index.html         — SPA shell
public/style.css          — mobile-first styling
public/app.js             — SPA met hash-routing
render.yaml               — Render deployment config
```
