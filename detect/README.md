# Kakapo — StayRight NZ Disruption Agent (MVP: Detect + Identify)

Given a regional-scale disruption signal — a weather anomaly, a volcanic
alert, an airport-wide flight cancellation, or a state-highway closure
that cuts off a town — automatically produce the list of bookings it
affects, with no human in the loop. Signals that only hit individual
travellers are deliberately filtered out at the detect stage. See
[../CLAUDE.md](../CLAUDE.md) for the full spec and scope boundaries; this
README is just "how do I run it."

This is the Python sub-project, a sibling of [../backend/](../backend/)
(C#) and [../frontend/](../frontend/) (React). Everything below assumes
your shell is `cd`'d into this `detect/` directory unless noted otherwise.
`.env`/`.env.example` are shared infra and live one level up, at the repo
root.

**Identify queries the real C# backend's database directly** (`hotels`/
`bookings` in the shared remote `stayright` database on EC2, the same
Postgres the backend uses) — not a separate toy dataset. `guest_id`/`booking_id` in
the output are real ids the rest of the system (case lookup, cancellation
policy, etc.) already understands. The shared `stayright` DB is already
migrated and seeded (the deploy pipeline / `RUN_DB_MIGRATE=1` does that —
see [../docs/DATABASE_ACCESS.md](../docs/DATABASE_ACCESS.md) §5), so
`hotels`/`bookings` already have data — see "Running against the shared
database" below.

## What's here

```
src/
  detect/
    models.py         # DisruptionEvent pydantic schema (the contract every source normalises to)
    events.py         # build_event(): the one place a DisruptionEvent is assembled, shared by every source
    open_meteo.py     # weather: polls Open-Meteo, classifies risk, builds DisruptionEvents
    geonet_volcano.py  # volcano: GeoNet Volcanic Alert Level -> event when VAL >= 3 or aviation Orange/Red
    flight_status.py   # flight: airport FIDS (AeroDataBox now, OAG later) -> event on airport-wide mass cancellation (not single flights)
    nzta_road.py       # road: NZTA traffic feed -> event on a full state-highway closure that isolates a town
  identify/
    geo.py          # haversine distance (pure Python, no DB)
    db.py            # Postgres connection helper (direct connect, no RDS Proxy yet)
    matcher.py        # SQL date-overlap query + Python distance filter -> affected bookings, against the real hotels/bookings tables
tests/
  test_detect.py    # schema validation + classify()/detect_events() unit tests
  test_identify.py  # geo + matcher unit tests (mocked DB); optional live-Postgres integration test
scripts/
  run_detect.py     # detect only, no DB: print each source's raw API response + the DisruptionEvent(s) it produces
  run_local_e2e.py  # manual detect -> identify run against real Open-Meteo + the shared stayright DB
  run_demo.py       # continuous demo: polls real weather every N seconds, injects one mock storm reading, writes handoff JSON
output/             # scripts/run_demo.py's .jsonl handoff file lands here (gitignored)
```

## Setup

```powershell
cd detect
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

Requires Python 3.12 per CLAUDE.md; this environment only has 3.13
available, which the code was developed and tested against — install
3.12 if you need to match the pinned version exactly.

### API keys — almost nothing to configure

| Source | Key needed? |
|---|---|
| Weather (Open-Meteo) | No |
| Volcano (GeoNet) | No |
| Road (NZTA TREIS) | No |
| Flight (AeroDataBox) | One free key, and only for **live** flight data |

So three of the four sources work the moment `pip install` finishes.
With no flight key the flight source just prints `skipped` and the run
continues — nothing breaks.

For live flight data, either use `--simulate` (canned sample, no key), or
get a key. **Everyone subscribes their own — don't share one key.** The
AeroDataBox free tier's call quota is per RapidAPI account, so a shared
key runs out and then fails for the whole team.

1. Sign up at [rapidapi.com](https://rapidapi.com).
2. Open the **AeroDataBox** API → **Subscribe** → **Basic** (free) plan.
3. Copy your `X-RapidAPI-Key`.
4. `copy ..\.env.example ..\.env` (once), then set `RAPIDAPI_KEY=<your key>` in that `..\.env`.

`scripts/run_detect.py` and the identify scripts both load `../.env`
automatically, so that is the only step — no `$env:` exporting needed.

## Running the test suite

No network access or live database required — `open_meteo.py` is tested
against stubbed fetch functions, and `matcher.py` is tested against a
mocked DB connection.

```powershell
.venv\Scripts\python -m pytest
```

## Seeing what each source produces (no database)

`scripts/run_detect.py` polls the sources and prints, per source, the
raw API response and the `DisruptionEvent`(s) it normalises to. No
Postgres, no identify step.

```powershell
.venv\Scripts\python -m scripts.run_detect                     # all four, live
.venv\Scripts\python -m scripts.run_detect --source volcano    # live GeoNet, no key
.venv\Scripts\python -m scripts.run_detect --simulate          # canned "disrupted" readings for every source, no network
$env:RAPIDAPI_KEY = "..."                                       # for --source flight only
.venv\Scripts\python -m scripts.run_detect --source flight
```

Weather (Open-Meteo), volcano (GeoNet) and road (NZTA TREIS) need no key.
Flight uses AeroDataBox via RapidAPI — set `RAPIDAPI_KEY`; production is
meant to swap to OAG (`oag/api-key`), and only `fetch_flight_status`
changes. `--simulate` shows a full event for all four with no network
call. The flight/road field mappings are best-effort against the live
docs — verify against a real response and tighten if a provider shifts
its schema.

## Running against the shared database

There is no local Postgres any more. `identify` connects to the shared
remote `stayright` DB on EC2 through an SSM port-forward tunnel — see
[../docs/DATABASE_ACCESS.md](../docs/DATABASE_ACCESS.md) for the tunnel
command and how to get IAM access / the DB password.

1. Open the tunnel in a terminal you leave running (maps `localhost:15432`).
2. From the repo root: `copy .env.example .env` (the DB vars already point
   at `127.0.0.1:15432` / `stayright`).

The `hotels`/`bookings` tables are already migrated and seeded on the
shared DB, so nothing else is needed. Then from `detect/`:
```powershell
.venv\Scripts\python -m scripts.run_local_e2e --simulate
```

- `--simulate` uses a canned high-severity storm event over Queenstown
  (matching the real Queenstown Lakeview Hotel's coordinates) instead of
  polling Open-Meteo, so you can see a full detect -> identify match
  without waiting for real weather. Drop it to poll Open-Meteo for real
  and only run identify if something is actually risky right now.

## Demo mode

Continuously polls one location's real weather every 10 seconds, running
the full detect -> identify pipeline on every tick. Since real weather
rarely cooperates on demo day, one designated iteration (the 3rd, by
default) substitutes a canned high-severity storm reading for the real
Open-Meteo call instead of a real API response — everything downstream
(`classify`, `DisruptionEvent`, `find_affected_bookings`) runs exactly
the same code path either way. That mocked tick also narrows its window
to exactly `MOCK_TARGET_BOOKING_ID`'s check-in day (a constant near the
top of `scripts/run_demo.py`, currently Test Guest QQ's earliest Auckland
booking) instead of the wide window a real tick uses, so the demo
reliably shows that one booking as affected — any other booking that
genuinely overlaps the same day still shows up too, flagged as such.

```powershell
.venv\Scripts\python -m scripts.run_demo
```

Every detected event is written to `output/handoff.jsonl` (one JSON
message per line: the `disruption_event` once, then one
`affected_customer` message per matched booking, referencing the event by
id — see the module docstring in `scripts/run_demo.py` for the exact
format) for another system to read. Each write replaces the file's prior
contents — it always holds only the most recently detected event.

Ctrl+C to stop, or pass `--iterations N` to stop automatically after N
polls. Useful flags:

- `--location` — which of the 4 fixed locations to poll (default: Auckland — matches real seeded hotels, including the Test Guest QQ scenario)
- `--interval` — seconds between polls (default: 10)
- `--mock-at` — which 1-indexed iteration gets the mock storm reading; `0` disables mocking entirely
- `--output` — where to write the handoff JSON, replacing prior contents (default: `output/handoff.jsonl`)

## Targeting one specific booking

`scripts/simulate_targeted_event.py` builds a DisruptionEvent narrowed to
exactly one booking's check-in day (weather affecting the check-in day
counts as affecting the booking), runs identify, and writes the result to
the same handoff file. Useful for demoing/testing "what does the JSON
look like for exactly this one customer" without waiting for real weather
or wading through a wide-radius/wide-window mock's whole affected list:

```powershell
.venv\Scripts\python -m scripts.simulate_targeted_event --guest testguestqq@example.com
.venv\Scripts\python -m scripts.simulate_targeted_event --booking-id <uuid>
```

If another booking at a hotel within radius genuinely overlaps that same
day, it's swept in too and reported explicitly (not a bug) — pick a
different `--booking-id` if you need strict isolation to just one
booking.

With a live, seeded Postgres running, `pytest` will additionally pick up
the integration test in `tests/test_identify.py`
(`TestFindAffectedBookingsIntegration`), which picks one real hotel and
checks that identify matches exactly its non-cancelled bookings and
nothing from the other hotels; it skips itself automatically when no
database is reachable or the backend hasn't seeded it yet.

## Status

MVP scope only: detect (weather / volcano / flight / road signals ->
`DisruptionEvent`) and identify (affected bookings). No agent reasoning,
no notifications, no AWS deployment yet — see ../CLAUDE.md's "不要做的事"
section. The flight source needs a `RAPIDAPI_KEY` in the environment to
poll live (AeroDataBox); weather, volcano and road are keyless. The
`fetch_*` functions are the only place a key is read, and every test
stubs them out.
