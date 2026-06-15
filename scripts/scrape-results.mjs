// ─────────────────────────────────────────────────────────────
// Auto results scraper for WC 2026 predictions app
// Source : openfootball/worldcup.json (public domain, no API key)
// Target : Firebase Realtime DB  fixtures/{id}
// Runtime: Node 20+ (uses global fetch). No dependencies.
//
// What it does, each run:
//   1. Pull the latest 2026 results feed (final scores only).
//   2. Pull your current fixtures from Firebase.
//   3. Match feed games to fixtures by team names (+ date tiebreaker).
//   4. For any finished game whose fixture has no result yet,
//      PATCH { homeScore, awayScore, result, locked:true } — same
//      shape the admin "Set Result" button writes.
//
// Idempotent: a fixture that already has the correct score is skipped.
// ─────────────────────────────────────────────────────────────

const DB_URL =
  process.env.FIREBASE_DB_URL ||
  "https://svjetsko-prvenstvo-2026-default-rtdb.europe-west1.firebasedatabase.app";

const SOURCE =
  process.env.RESULTS_SOURCE ||
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";

const DRY_RUN = process.env.DRY_RUN === "1";

// Normalised-name → canonical token. Both the feed's name and your
// app's name run through canon(); they only need to land on the SAME
// string. Names that already match after norm() need no entry here.
const ALIASES = {
  "czech republic": "czechia",
  "turkey": "turkiye",
  "dr congo": "congodr",      "congo dr": "congodr",
  "iran": "iran",             "ir iran": "iran",
  "ivory coast": "ivorycoast","cote d ivoire": "ivorycoast",
  "cape verde": "capeverde",  "cabo verde": "capeverde",
  "korea republic": "south korea",
  "united states": "usa",
};

function norm(name) {
  return String(name || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
const canon = (name) => {
  const n = norm(name);
  return ALIASES[n] || n;
};

const teamName = (t) => (typeof t === "object" && t ? t.name : t);
const pairKey  = (home, away) => `${canon(home)}|${canon(away)}`;

async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function main() {
  // 1. Feed
  const feed = await getJSON(SOURCE);
  const feedMatches = feed.matches || feed.rounds?.flatMap((r) => r.matches) || [];

  // 2. Fixtures
  const fixtures = (await getJSON(`${DB_URL}/fixtures.json`)) || {};

  // Index fixtures by team-pair (group games meet once → unique key)
  const byPair = {};
  for (const [id, f] of Object.entries(fixtures)) {
    byPair[pairKey(f.home, f.away)] = { id, f };
  }

  let updated = 0, skipped = 0, unmatched = 0;

  for (const m of feedMatches) {
    const home = teamName(m.team1 ?? m.home);
    const away = teamName(m.team2 ?? m.away);

    // Final score: score.ft = [h,a]  (fall back to score1/score2)
    const ft = m.score?.ft;
    const h = Array.isArray(ft) ? ft[0] : m.score1;
    const a = Array.isArray(ft) ? ft[1] : m.score2;
    if (h == null || a == null) continue; // not finished yet

    const hit = byPair[pairKey(home, away)];
    if (!hit) {
      unmatched++;
      console.log(`  ? no fixture for: ${home} vs ${away}`);
      continue;
    }

    const { id, f } = hit;
    // Already has this exact result → nothing to do
    if (f.homeScore === h && f.awayScore === a && f.result) { skipped++; continue; }

    const result = h > a ? "1" : h === a ? "X" : "2";
    const body = { homeScore: h, awayScore: a, result, locked: true };

    console.log(`  ✓ ${home} ${h}–${a} ${away}  →  fixtures/${id}`);
    if (!DRY_RUN) {
      const res = await fetch(`${DB_URL}/fixtures/${id}.json`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`PATCH fixtures/${id} → HTTP ${res.status}`);
    }
    updated++;
  }

  console.log(
    `\nDone. updated=${updated} skipped=${skipped} unmatched=${unmatched}` +
    (DRY_RUN ? "  (DRY RUN — nothing written)" : "")
  );
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
