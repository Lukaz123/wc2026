#!/usr/bin/env node
/**
 * scrape-results.mjs
 * Fetches finished WC 2026 scores from TheSportsDB and writes them to Firebase.
 * TheSportsDB updates within minutes of final whistle — no API key needed.
 *
 * Usage:
 *   node scrape-results.mjs              # live run — writes to Firebase
 *   node scrape-results.mjs --dry-run    # prints what would change, writes nothing
 *
 * Required env vars:
 *   FIREBASE_DB_URL    e.g. https://svjetsko-prenstvo-2026-default-rtdb.europe-west1.firebasedatabase.app
 *   FIREBASE_TOKEN     Firebase Database secret (Project Settings → Service Accounts → Database Secrets)
 */

const FEED_URL = "https://www.thesportsdb.com/api/v1/json/3/eventsseason.php?id=4429&s=2026";
const DB_URL   = process.env.FIREBASE_DB_URL?.replace(/\/$/, "");
const TOKEN    = process.env.FIREBASE_TOKEN;
const DRY_RUN  = process.argv.includes("--dry-run");

if (!DB_URL || !TOKEN) {
  console.error("Missing FIREBASE_DB_URL or FIREBASE_TOKEN env vars.");
  process.exit(1);
}

// ─── Team name aliases (TheSportsDB name → your Firebase name) ────────────
const ALIAS = {
  "Czech Republic":        "Czechia",
  "Turkey":                "Türkiye",
  "DR Congo":              "Congo DR",
  "Iran":                  "IR Iran",
  "Ivory Coast":           "Côte d'Ivoire",
  "Cape Verde":            "Cabo Verde",
  "Bosnia-Herzegovina":    "Bosnia & Herzegovina",
  "Bosnia and Herzegovina":"Bosnia & Herzegovina",
  "United States":         "USA",
  "Korea Republic":        "South Korea",
  "Curacao":               "Curaçao",
};

function normalize(name) {
  return (ALIAS[name] ?? name).toLowerCase().trim();
}

// ─── Helpers ──────────────────────────────────────────────────────────────
async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

async function patch(path, data) {
  const url = `${DB_URL}/${path}.json?auth=${TOKEN}`;
  const res = await fetch(url, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status} ${await res.text()}`);
}

function getResult(home, away) {
  if (home > away) return "1";
  if (home === away) return "X";
  return "2";
}

// ─── Main ─────────────────────────────────────────────────────────────────
const [feed, fixturesRaw] = await Promise.all([
  get(FEED_URL),
  get(`${DB_URL}/fixtures.json?auth=${TOKEN}`),
]);

const events   = feed.events || [];
const fixtures = Object.entries(fixturesRaw || {}).map(([id, f]) => ({ id, ...f }));

let updated = 0, skipped = 0, unmatched = 0;

for (const match of events) {
  // Only process finished matches
  if (match.strStatus !== "FT") continue;

  const homeScore = parseInt(match.intHomeScore);
  const awayScore = parseInt(match.intAwayScore);
  if (isNaN(homeScore) || isNaN(awayScore)) continue;

  const result = getResult(homeScore, awayScore);
  const date   = match.dateEvent; // "2026-06-11"
  const home   = normalize(match.strHomeTeam);
  const away   = normalize(match.strAwayTeam);

  // Find matching Firebase fixture by date + team names
  const fix = fixtures.find(f => {
    if (!f.date) return false;
    // Firebase dates are stored as full ISO strings — compare just the date part
    const fixDate = new Date(f.date).toISOString().slice(0, 10);
    // TheSportsDB dateEvent is local date — also try the day before/after for midnight games
    const d = new Date(date);
    const dates = [
      d.toISOString().slice(0, 10),
      new Date(d - 86400000).toISOString().slice(0, 10),
      new Date(d + 86400000).toISOString().slice(0, 10),
    ];
    return dates.includes(fixDate) &&
           normalize(f.home) === home &&
           normalize(f.away) === away;
  });

  if (!fix) {
    console.warn(`UNMATCHED: ${match.strHomeTeam} vs ${match.strAwayTeam} on ${date}`);
    unmatched++;
    continue;
  }

  // Already has correct result — skip
  if (fix.homeScore === homeScore && fix.awayScore === awayScore && fix.result === result) {
    skipped++;
    continue;
  }

  const payload = { homeScore, awayScore, result, locked: true };

  if (DRY_RUN) {
    console.log(`DRY RUN — would update ${fix.id}: ${fix.home} ${homeScore}–${awayScore} ${fix.away} (${result})`);
    updated++;
  } else {
    await patch(`fixtures/${fix.id}`, payload);
    console.log(`Updated ${fix.id}: ${fix.home} ${homeScore}–${awayScore} ${fix.away}`);
    updated++;
  }
}

const suffix = DRY_RUN ? "  (DRY RUN — nothing written)" : "";
console.log(`\nDone. updated=${updated} skipped=${skipped} unmatched=${unmatched}${suffix}`);
