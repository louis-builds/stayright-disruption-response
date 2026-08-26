# Kakapo — StayRight NZ Disruption Agent (MVP: Detect + Identify)

Given a weather anomaly, automatically produce the list of bookings it
affects — no human in the loop. See [../CLAUDE.md](../CLAUDE.md) for the
full spec and scope boundaries; this README is just "how do I run it."

This is the Python sub-project, a sibling of [../backend/](../backend/)
(C#) and [../frontend/](../frontend/) (React). Everything below assumes
your shell is `cd`'d into this `detect/` directory unless noted otherwise.
`docker-compose.yml` and `.env`/`.env.example` are shared infra and live
one level up, at the repo root.

**Identify queries the real C# backend's database directly** (`hotels`/
`bookings` in the shared `travel_disruption` database, the same Postgres
the backend uses) — not a separate toy dataset. `guest_id`/`booking_id` in
the output are real ids the rest of the system (case lookup, cancellation
policy, etc.) already understands. This means the `hotels`/`bookings`
tables need to actually have data in them, which only happens once the C#
backend has been run at least once (`dotnet run` under `backend/`
auto-migrates and seeds on startup) — see "Running against a real local
Postgres" below.

## What's here

```
src/
  detect/
    models.py      # DisruptionEvent pydantic schema (the contract every source normalises to)
    open_meteo.py   # polls Open-Meteo, classifies risk, builds DisruptionEvents
  identify/
    geo.py          # haversine distance (pure Python, no DB)
    db.py            # Postgres connection helper (direct connect, no RDS Proxy yet)
    matcher.py        # SQL date-overlap query + Python distance filter -> affected bookings, against the real hotels/bookings tables
tests/
  test_detect.py    # schema validation + classify()/detect_events() unit tests
  test_identify.py  # geo + matcher unit tests (mocked DB); optional live-Postgres integration test
scripts/
  run_local_e2e.py  # manual detect -> identify run against real Open-Meteo + local Postgres
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

## Running the test suite

No network access or live database required — `open_meteo.py` is tested
against stubbed fetch functions, and `matcher.py` is tested against a
mocked DB connection.

```powershell
.venv\Scripts\python -m pytest
```

## Running against a real local Postgres

From the repo root (one level up):
```powershell
docker compose up -d
copy .env.example .env
```

The `hotels`/`bookings` tables identify queries only exist once the C#
backend has seeded them — run it at least once first:
```powershell
cd ..\backend
dotnet run
```
(Ctrl+C once it's up and logging — you just need it to have migrated +
seeded; it doesn't need to keep running for the Python side.)

Then from `detect/`:
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

MVP scope only: detect (weather anomalies -> `DisruptionEvent`) and
identify (affected bookings). No agent reasoning, no notifications, no
AWS deployment yet — see ../CLAUDE.md's "不要做的事" section.
