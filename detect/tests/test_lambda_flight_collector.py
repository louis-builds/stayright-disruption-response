from datetime import datetime, timedelta, timezone

from src.detect.events import build_event
from src.detect.models import EventSource, Severity
from src.runtimes.lambda_flight_collector import handler, ingest_disruption

NOW = datetime(2026, 8, 25, tzinfo=timezone.utc)


def _flight_event():
    return build_event(
        source=EventSource.FLIGHT,
        event_type="mass_flight_cancellation",
        severity=Severity.HIGH,
        window_start=NOW,
        window_end=NOW + timedelta(hours=12),
        center_lat=-37.0082,
        center_lng=174.7850,
        radius_km=40.0,
        raw_payload={
            "source_api": "aerodatabox/airport-fids",
            "airport_iata": "AKL",
            "scheduled_count": 40,
            "cancelled_count": 18,
            "cancelled_fraction": 0.45,
            "sample_cancelled_flights": ["NZ001", "NZ002"],
        },
        detected_at=NOW,
    )


def _fake_cfg(key: str) -> str:
    assert key == "API_BASE_URL"
    return "https://api.example.test"


def _fake_secret_ingest_only(name: str) -> str:
    assert name == "ingest/shared-key"
    return "test-shared-key"


class TestIngestDisruption:
    def test_posts_disruption_shaped_payload_to_ingest_endpoint(self, mocker):
        mocker.patch("src.runtimes.lambda_flight_collector.cfg", _fake_cfg)
        mocker.patch("src.runtimes.lambda_flight_collector.secret", _fake_secret_ingest_only)
        mock_post = mocker.patch("src.runtimes.lambda_flight_collector.requests.post")
        mock_post.return_value.raise_for_status = mocker.Mock()

        ingest_disruption(_flight_event())

        mock_post.assert_called_once()
        _, kwargs = mock_post.call_args
        assert kwargs["headers"] == {"X-Ingest-Key": "test-shared-key"}
        payload = kwargs["json"]
        assert payload["type"] == "flight"
        assert payload["region"] == "AKL"
        assert "AKL" in payload["title"]
        assert payload["startAt"] == NOW.isoformat()
        mock_post.return_value.raise_for_status.assert_called_once()

    def test_raises_when_ingest_endpoint_rejects_the_request(self, mocker):
        mocker.patch("src.runtimes.lambda_flight_collector.cfg", _fake_cfg)
        mocker.patch("src.runtimes.lambda_flight_collector.secret", _fake_secret_ingest_only)
        mock_post = mocker.patch("src.runtimes.lambda_flight_collector.requests.post")
        mock_post.return_value.raise_for_status.side_effect = RuntimeError("boom")

        try:
            ingest_disruption(_flight_event())
            assert False, "expected raise_for_status failure to propagate"
        except RuntimeError:
            pass


class TestHandler:
    def test_skips_without_touching_the_network_when_oag_key_is_empty(self, mocker):
        mocker.patch("src.runtimes.lambda_flight_collector.secret", return_value="")
        mock_detect = mocker.patch("src.runtimes.lambda_flight_collector.detect_flight_events")
        mock_ingest = mocker.patch("src.runtimes.lambda_flight_collector.ingest_disruption")

        result = handler({}, None)

        assert result == {"ingested": 0, "skipped": True}
        mock_detect.assert_not_called()
        mock_ingest.assert_not_called()

    def test_skips_when_no_airport_is_disrupted(self, mocker):
        mocker.patch("src.runtimes.lambda_flight_collector.secret", return_value="oag-key")
        mocker.patch("src.runtimes.lambda_flight_collector.detect_flight_events", return_value=[])
        mock_ingest = mocker.patch("src.runtimes.lambda_flight_collector.ingest_disruption")

        result = handler({}, None)

        mock_ingest.assert_not_called()
        assert result == {"ingested": 0}

    def test_ingests_each_detected_event(self, mocker):
        mocker.patch("src.runtimes.lambda_flight_collector.secret", return_value="oag-key")
        mocker.patch(
            "src.runtimes.lambda_flight_collector.detect_flight_events",
            return_value=[_flight_event()],
        )
        mock_ingest = mocker.patch("src.runtimes.lambda_flight_collector.ingest_disruption")

        result = handler({}, None)

        assert result == {"ingested": 1}
        mock_ingest.assert_called_once()
