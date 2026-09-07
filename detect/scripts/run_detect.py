"""Poll the disruption sources and print, for each one, the raw API
response and the DisruptionEvent(s) it normalises to. Detect only -- no
database, no identify step -- so you can eyeball what each API returns
and what the adapter makes of it.

Usage:
    python -m scripts.run_detect                  # every source, live
    python -m scripts.run_detect --source volcano  # just GeoNet (no key needed)
    python -m scripts.run_detect --source flight   # AeroDataBox (needs RAPIDAPI_KEY)
    python -m scripts.run_detect --source road     # NZTA TREIS (no key needed)
    python -m scripts.run_detect --no-raw          # skip the raw dump, events only
    python -m scripts.run_detect --simulate        # feed canned "disrupted" readings, no API/key

GeoNet and NZTA TREIS need no key and work straight away. The flight feed
needs RAPIDAPI_KEY in the environment; its request/response mapping is
best-effort against AeroDataBox's docs -- if it errors, the message is
printed and the run moves on. Use --simulate to see a full event printed
for every source without any network call.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

from src.detect.flight_status import (
    FLIGHT_LOOKAHEAD_HOURS,
    MONITORED_AIRPORTS,
    aerodatabox_departures,
    detect_flight_events,
    fetch_flight_status,
)
from src.detect.geonet_volcano import detect_volcano_events, fetch_volcano_alerts
from src.detect.nzta_road import detect_road_events, fetch_road_events
from src.detect.open_meteo import DEFAULT_LOCATIONS, detect_events, fetch_forecast

SOURCE_CHOICES = ["weather", "volcano", "flight", "road", "all"]


def _sim_forecast(lat, lng):
    hours = [(datetime.now(timezone.utc) + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00") for h in range(6)]
    # weather_code: 3=overcast, 63=moderate rain, 95=thunderstorm, 82=violent showers.
    # Only the 95 / 82 hours clear SEVERE_WEATHER_CODES.
    return {
        "hourly": {
            "time": hours,
            "weather_code": [3, 63, 95, 95, 82, 3],
            "precipitation": [0, 2, 5, 8, 12, 1],
            "snowfall": [0, 0, 0, 0, 0, 0],
        }
    }


def _sim_volcano_alerts():
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [175.563, -39.281]},
                "properties": {
                    "volcanoID": "ruapehu", "volcanoTitle": "Ruapehu", "level": 4,
                    "acc": "Orange", "activity": "Minor eruptive activity.", "hazards": "Ashfall, lahar.",
                },
            }
        ],
    }


def _sim_flight_status(airport_iata, *, lookahead_hours, api_key):
    now = datetime.now(timezone.utc)
    if airport_iata != "AKL":
        return [{"flight_iata": f"NZ{i}", "scheduled_time": now + timedelta(minutes=15 * i + 10), "status": "on time"} for i in range(20)]
    out = [{"flight_iata": f"NZ{i:03d}", "scheduled_time": now + timedelta(minutes=12 * i + 10), "status": "cancelled"} for i in range(15)]
    out += [{"flight_iata": f"JQ{i:03d}", "scheduled_time": now + timedelta(minutes=9 * i + 5), "status": "on time"} for i in range(4)]
    return out


def _sim_road_events():
    return [
        {
            "event_type": "Road Closed", "road_number": "SH94", "name": "Homer Tunnel",
            "location_area": "Milford Sound Road", "impact": "Road Closed",
            "start_date": None, "end_date": None, "lat": -44.76, "lng": 168.02, "detour_available": False,
        }
    ]


def _dump(value: object, *, limit: int = 4000) -> str:
    text = json.dumps(value, indent=2, default=str, ensure_ascii=False)
    if len(text) > limit:
        text = text[:limit] + f"\n... [truncated, {len(text)} chars total]"
    return text


def _print_events(events: list) -> None:
    print(f"--- detected events ({len(events)}) ---")
    if not events:
        print("  (none cleared the regional-scale gate)")
        return
    for event in events:
        print(event.model_dump_json(indent=2))


def _run_weather(show_raw: bool, simulate: bool) -> None:
    print("\n===== WEATHER (Open-Meteo) =====")
    if simulate:
        print("--- simulated forecast (weather_code 95/82: thunderstorm + violent rain showers) ---")
        _print_events(detect_events(fetch=_sim_forecast))
        return
    if show_raw:
        loc = DEFAULT_LOCATIONS[0]
        print(f"--- raw forecast for {loc.name} ---")
        print(_dump(fetch_forecast(loc.lat, loc.lng)))
    _print_events(detect_events())


def _run_volcano(show_raw: bool, simulate: bool) -> None:
    print("\n===== VOLCANO (GeoNet /volcano/val) =====")
    if simulate:
        print("--- simulated: Ruapehu at VAL 4, aviation Orange ---")
        _print_events(detect_volcano_events(fetch=_sim_volcano_alerts))
        return
    if show_raw:
        print("--- raw response ---")
        print(_dump(fetch_volcano_alerts()))
    _print_events(detect_volcano_events())


def _run_flight(show_raw: bool, simulate: bool) -> None:
    print("\n===== FLIGHT (AeroDataBox airport FIDS) =====")
    if simulate:
        print("--- simulated: 15 of ~19 AKL departures cancelled ---")
        _print_events(detect_flight_events(fetch=_sim_flight_status))
        return
    key = os.environ.get("RAPIDAPI_KEY")
    if not key:
        print("  skipped: RAPIDAPI_KEY is not set (use --simulate to see a sample event)")
        return
    try:
        if show_raw:
            sample = MONITORED_AIRPORTS[0]
            print(f"--- raw AeroDataBox response for {sample.iata} (untouched, first ~2.5KB) ---")
            print(_dump(aerodatabox_departures(sample.iata, api_key=key), limit=2500))
        _print_events(detect_flight_events(api_key=key))
    except Exception as exc:  # noqa: BLE001 - manual tool, surface and continue
        print(f"  error polling AeroDataBox: {exc!r}")


def _run_road(show_raw: bool, simulate: bool) -> None:
    print("\n===== ROAD (NZTA traffic events) =====")
    if simulate:
        print("--- simulated: SH94 to Milford closed, no detour, open-ended ---")
        _print_events(detect_road_events(fetch=_sim_road_events))
        return
    try:
        if show_raw:
            print("--- raw feed (first 5) ---")
            events = fetch_road_events()
            print(f"  {len(events)} traffic events in the feed")
            print(_dump(events[:5]))
        _print_events(detect_road_events())
    except Exception as exc:  # noqa: BLE001 - manual tool, surface and continue
        print(f"  error polling NZTA TREIS: {exc!r}")


RUNNERS = {
    "weather": _run_weather,
    "volcano": _run_volcano,
    "flight": _run_flight,
    "road": _run_road,
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", choices=SOURCE_CHOICES, default="all", help="which source(s) to poll (default: all)")
    parser.add_argument("--no-raw", dest="raw", action="store_false", help="print only the normalised events")
    parser.add_argument("--simulate", action="store_true", help="feed canned disrupted readings instead of calling the APIs")
    parser.add_argument("--rapidapi-key", help="AeroDataBox / RapidAPI key (else read from RAPIDAPI_KEY env or .env)")
    args = parser.parse_args()

    # A .env in the repo, an exported var, or --rapidapi-key all work.
    load_dotenv()
    if args.rapidapi_key:
        os.environ["RAPIDAPI_KEY"] = args.rapidapi_key

    mode = "simulate" if args.simulate else "live"
    print(f"run_detect ({mode}) at {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    wanted = list(RUNNERS) if args.source == "all" else [args.source]
    for name in wanted:
        RUNNERS[name](args.raw, args.simulate)


if __name__ == "__main__":
    main()
