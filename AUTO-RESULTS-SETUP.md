# Auto-import match results

Automatically pulls final scores into your Firebase `fixtures` so you don't
have to enter them by hand. The app is untouched — it updates live exactly as
it does when you use the admin **Set Result** button.

## How it works

```
GitHub Actions (cron, every 30 min)
        │
        ├─ fetch openfootball/worldcup.json  (free, no API key, public domain)
        ├─ fetch your fixtures from Firebase
        ├─ match games by team name (+ alias map for Türkiye, Czechia, …)
        └─ PATCH {homeScore, awayScore, result, locked:true} for finished games
```

- **Source:** `openfootball/worldcup.json` — keyless, public-domain, already
  carrying live final scores. Updated ~daily (sometimes faster) by the
  community, **not second-by-second**. For a friends pool that's fine, and
  manual entry still works for anything the feed is slow on.
- **Idempotent:** a fixture that already has the right score is skipped, so
  re-runs are harmless.

## One-time setup

1. **Put this folder on GitHub.** From `wc2026/`:
   ```bash
   git init
   git add .
   git commit -m "WC2026 app + auto results"
   gh repo create wc2026 --private --source=. --push
   ```
   (or create the repo in the GitHub UI and push). The workflow lives at
   `.github/workflows/auto-results.yml` and the script at
   `scripts/scrape-results.mjs`.

2. **Confirm Firebase allows the write.** The script writes via the REST API
   with no auth — the same unauthenticated access your web app already uses
   (test-mode rules). If your Realtime DB rules still allow public writes to
   `/fixtures`, you're done. If you've locked them down, see *Locked rules*
   below.

3. **Test it.** GitHub → **Actions** tab → *Auto-import WC2026 results* →
   **Run workflow** → tick **Dry run** first to see what it *would* write,
   then run again without dry-run to actually import.

That's it — after that it runs every 30 minutes on its own.

## Run it locally (optional)

```bash
cd wc2026
DRY_RUN=1 node scripts/scrape-results.mjs   # preview, writes nothing
node scripts/scrape-results.mjs             # real import
```

## Locked Firebase rules

If your DB rules are NOT open for writes, the REST PATCH needs auth. Easiest
path: create a **legacy database secret** (Firebase Console → Project Settings
→ Service accounts → Database secrets), add it as a GitHub secret named
`FIREBASE_DB_SECRET`, and append `?auth=$FIREBASE_DB_SECRET` to the URLs in the
script. (Ask me and I'll wire this in.)

## Notes / caveats

- **Re-adds cleared results.** If you manually *clear* a result in admin but
  the feed still reports that game as finished, the next run will re-import it.
  If you need a permanent override, tell me and I'll add a `manualOverride`
  flag the script respects.
- **Team-name aliases** live in `ALIASES` at the top of the script. If a game
  ever logs `? no fixture for: X vs Y`, add the mismatching name there.
- **Knockout stage:** matching is by team pair. Group teams meet once so it's
  unambiguous; in knockouts a repeat pairing is matched by the team pair too,
  which is fine since those fixtures don't exist in your data until you add them.
- **Timeliness:** want minutes-fresh instead of ~daily? The script is
  source-agnostic — swap `SOURCE`/parsing for TheSportsDB (`eventsday.php`) or
  football-data.org and the rest stays the same. Ask and I'll add it.
