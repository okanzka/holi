# 🌴 Heybe: holiday planner

A personal trip planner with a holiday look. Pick a week, say how flexible you are, and it finds the cheapest flights, then helps you with hotels.

## What it does

- **Flights**
  - Round trip, one way, or **Anywhere**, on either side (e.g. Nürnberg → anywhere, or anywhere → Nürnberg).
  - Cities, whole countries and 4,000+ airports, with search in English, Turkish or German.
  - **Fare calendar** (Pegasus-style): the lowest fare per day around your chosen date, in a week or month view.
  - **Multi-city** (home → A → B → home) and **? → last stop → home** routes, built from direct flights.
  - **Visa filter** for Turkish passport holders (visa-free, Schengen visa, e-visa, on arrival…), list as of Nov 2026.
  - Airline logos, an airline filter and a "direct flights only" option.
- **Hotels:** shifted stay dates, 7 hotel sites with your dates filled in, and a shortlist with price per night.
- **Stay planner:** press 🏨 on any flight option. You go city by city with 12 or more hostel and hotel suggestions with real prices (Google Hotels via SerpApi, plus a free source that needs no key: Booking.com, Agoda, Trip.com and other rates through Xotelo), pick one per city, and get the total cost of stays + flights.

## Prices

| Source | Airlines | Freshness |
|---|---|---|
| Ryanair public fare finder | Ryanair group | live |
| [Travelpayouts](https://www.travelpayouts.com) / Aviasales Data API | all airlines (Pegasus, Wizz Air, AJet, SunExpress, THY, Lufthansa…) | recent searches, can change |

Always confirm the final price on the booking site. Visa rules change often too, so check with the embassy before you travel.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer. There are no packages to install.

1. *(Optional, for all airlines)* Get a free API token from Travelpayouts (Profile → API token). Copy `travelpayouts.key.example` to `travelpayouts.key` and paste the token in. This file is git-ignored and never sent to the browser.
2. *(Optional, for hotel suggestions with prices)* Get a free [SerpApi](https://serpapi.com/manage-api-key) key and put it in `serpapi.key`. This file is git-ignored too. Without it, the stay planner still shows suggestions from the free source (fewer places, and it takes 10–20 seconds per city).
3. Double-click **`start.bat`** (Windows), or run `node server.js`.
4. The site opens at **http://localhost:8080**.

You can also open `index.html` directly as a file. That works, but only with Ryanair prices.
