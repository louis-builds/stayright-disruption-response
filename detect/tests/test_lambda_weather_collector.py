from datetime import datetime, timedelta, timezone

from src.detect.open_meteo import DEFAULT_LOCATIONS, Classification, Location, build_disruption_event
from src.detect.models import Severity
from src.runtimes.lambda_weather_collector import handler, ingest_disruption

QUEENSTOWN = DEFAULT_LOCATIONS[0]

STORM_READING = {"wind_gusts_10m": 150, "precipitation": 0, "snowfall": 0}


def _hourly_forecast(times, gusts=None, precipitation=None, snowfall=None):
    n = len(times)
    return {
        "hourly": {
            "time": times,
            "wind_gusts_10m": gusts or [0] * n,
            "precipitation": precipitation or [0] * n,
            "snowfall": snowfall or [0] * n,
        }
    }


CALM_FORECAST = _hourly_forecast(["2026-08-25T00:00", "2026-08-25T01:00"], gusts=[5, 10])
STORM_FORECAST = _hourly_forecast(["2026-08-25T00:00", "2026-08-25T01:00"], gusts=[150, 100])


def _fake_cfg(key: str) -> str:
    assert key == "API_BASE_URL"
    return "https://api.example.test"


def _fake_secret(name: str) -> str:
    assert name == "ingest/shared-key"
    return "test-shared-key"


class TestIngestDisruption:
    def test_posts_disruption_shaped_payload_to_ingest_endpoint(self, mocker):
        mocker.patch("src.runtimes.lambda_weather_collector.cfg", _fake_cfg)
        mocker.patch("src.runtimes.lambda_weather_collector.secret", _fake_secret)
        mock_post = mocker.patch("src.runtimes.lambda_weather_collector.requests.post")
        mock_post.return_value.raise_for_status = mocker.Mock()

        now = datetime(2026, 8, 25, tzinfo=timezone.utc)
        end = now + timedelta(hours=1)
        classification = Classification(True, "storm", Severity.HIGH)
        event = build_disruption_event(QUEENSTOWN, classification, now, end, STORM_READING, detected_at=now)

        ingest_disruption(event, QUEENSTOWN, classification)

        mock_post.assert_called_once()
        _, kwargs = mock_post.call_args
        assert kwargs["headers"] == {"X-Ingest-Key": "test-shared-key"}
        payload = kwargs["json"]
        assert payload["type"] == "weather"
        assert payload["region"] == QUEENSTOWN.name
        assert "storm" in payload["rawSignalText"]
        assert payload["startAt"] == now.isoformat()
        mock_post.return_value.raise_for_status.assert_called_once()

    def test_raises_when_ingest_endpoint_rejects_the_request(self, mocker):
        mocker.patch("src.runtimes.lambda_weather_collector.cfg", _fake_cfg)
        mocker.patch("src.runtimes.lambda_weather_collector.secret", _fake_secret)
        mock_post = mocker.patch("src.runtimes.lambda_weather_collector.requests.post")
        mock_post.return_value.raise_for_status.side_effect = RuntimeError("boom")

        now = datetime(2026, 8, 25, tzinfo=timezone.utc)
        end = now + timedelta(hours=1)
        classification = Classification(True, "storm", Severity.HIGH)
        event = build_disruption_event(QUEENSTOWN, classification, now, end, STORM_READING, detected_at=now)

        try:
            ingest_disruption(event, QUEENSTOWN, classification)
            assert False, "expected raise_for_status failure to propagate"
        except RuntimeError:
            pass


class TestHandler:
    def test_skips_locations_with_calm_weather(self, mocker):
        mocker.patch(
            "src.runtimes.lambda_weather_collector.fetch_forecast",
            return_value=CALM_FORECAST,
        )
        mock_ingest = mocker.patch("src.runtimes.lambda_weather_collector.ingest_disruption")

        result = handler({}, None)

        mock_ingest.assert_not_called()
        assert result == {"ingested": 0}

    def test_ingests_only_the_risky_locations(self, mocker):
        def forecast_for(lat: float, lng: float):
            return STORM_FORECAST if (lat, lng) == (QUEENSTOWN.lat, QUEENSTOWN.lng) else CALM_FORECAST

        mocker.patch("src.runtimes.lambda_weather_collector.fetch_forecast", side_effect=forecast_for)
        mock_ingest = mocker.patch("src.runtimes.lambda_weather_collector.ingest_disruption")

        result = handler({}, None)

        assert result == {"ingested": 1}
        mock_ingest.assert_called_once()
        called_location = mock_ingest.call_args[0][1]
        assert called_location.name == QUEENSTOWN.name
