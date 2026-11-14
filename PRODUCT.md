# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Today: the owner and people close to them, living in Germany (default home airport Nürnberg), holding Turkish passports, planning short holidays on a budget with flexible dates. Later the site may open to the public, so every surface must make sense to a first-time visitor who does not know the owner's habits.

## Product Purpose
Heybe ("saddlebag") packs a whole holiday plan into one place: pick a week, say how flexible you are, find the cheapest flights (including "Anywhere"), add stays city by city, and see the real total. Success = the visitor leaves with a concrete, bookable trip and its total cost, then books on the airline or hotel site.

## Positioning
Three things together that neighbouring tools do not combine:
- Flexible dates (± up to 4 days) and "Anywhere" on either side of the route, with a per-day fare calendar.
- Visa awareness for Turkish passport holders (visa-free, Schengen visa OK, e-visa, on arrival, required).
- Flight + stay total: multi-city and "? → last stop → home" routes, a stay planner per city, one total.

Heybe is not a booking site: it compares and links out to booking sites with dates filled in.

## Operating Context
- Pages: Home (trip form, shared across pages), Flights (search, best deals, every destination, fare calendar, detail with booking links), Hotels (stay dates, 7 hotel sites, shortlist, stay planner).
- Runs locally via `node server.js` at http://localhost:8080; can also open as a file (Ryanair prices only).
- Price sources: Ryanair public fare finder (live), Travelpayouts/Aviasales (recent, all airlines), Google Flights/Hotels via SerpApi (optional key).
- Used on desktop and iPhone.

## Capabilities and Constraints
- Plain static HTML/CSS/vanilla JS, no build step, no npm dependencies; Node ≥ 18 server for API proxying. JS reads class names and DOM ids, so markup contracts must be preserved.
- Prices are indicative; final price must be confirmed on the booking site. Visa list is as of Nov 2026 and must be checked with the embassy.

## Brand Commitments
- Name: "heybe" (lowercase wordmark). Interface language: English (search accepts English, Turkish, German).

## Evidence on Hand
Real data: live fares, 4,000+ airports, airline logos, country flags, visa list. No testimonials, user counts, press or partner claims exist; do not invent them.

## Product Principles
1. The total trip, not the cheapest single ticket: always lead toward a bookable plan with a total.
2. Honest prices: show source and freshness, never imply a price is guaranteed.
3. Flexibility is the default mode: dates and destinations are ranges, not fixed points.
4. Built for one traveller's real situation (home airport, passport) first, legible to strangers second.

## Accessibility & Inclusion
Must work well on iPhone Safari (no sideways panning, no input zoom) and respect reduced motion. No further standard established.
