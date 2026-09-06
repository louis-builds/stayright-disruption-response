from datetime import datetime, timedelta, timezone

from src.detect.events import build_event
from src.detect.models import EventSource, Severity
from src.runtimes.lambda_volcano_collector import handler, ingest_disruption

NOW = datetime(2026, 8, 25, tzinfo=timezone.utc)


def _volcano_event():
    return build_event(
        source=EventSource.VOLCANO,
        event_type="volcanic_eruption",
        severity=Severity.HIGH,
        window_start=NOW,
        window_end=NOW + timedelta(days=7),
        center_lat=-39.28,
        center_lng=175.57,
        radius_km=90.0,
        raw_payload={
            "source_api": "geonet/volcano/val",
            "volcano_id": "ruapehu",
            "volcano_title": "Ruapehu",
            "alert_level": 3,
            "aviation_colour_code": "Orange",
            "activity": "Minor eruptive activity.",
            "hazards": "Ashfall.",
        },
        detected_at=NOW,
    )


def _fake_cfg(key: str) -> str:
    assert key == "API_BASE_URL"
    return "https://api.example.test"


def _fake_secret(name: str) -> str:
    assert name == "ingest/shared-key"
    return "test-shared-key"


class TestIngestDisruption:
    def test_posts_disruption_shaped_payload_to_ingest_endpoint(self, mocker):
        mocker.patch("src.runtimes.lambda_volcano_collector.cfg", _fake_cfg)
        mocker.patch("src.runtimes.lambda_volcano_collector.secret", _fake_secret)
        mock_post = mocker.patch("src.runtimes.lambda_volcano_collector.requests.post")
        mock_post.return_value.raise_for_status = mocker.Mock()

        ingest_disruption(_volcano_event())

        mock_post.assert_called_once()
        _, kwargs = mock_post.call_args
        assert kwargs["headers"] == {"X-Ingest-Key": "test-shared-key"}
        payload = kwargs["json"]
        assert payload["type"] == "volcano"
        assert payload["region"] == "Ruapehu"
        assert "VAL 3" in payload["title"]
        assert payload["startAt"] == NOW.isoformat()
        mock_post.return_value.raise_for_status.assert_called_once()

    def test_raises_when_ingest_endpoint_rejects_the_request(self, mocker):
        mocker.patch("src.runtimes.lambda_volcano_collector.cfg", _fake_cfg)
        mocker.patch("src.runtimes.lambda_volcano_collector.secret", _fake_secret)
        mock_post = mocker.patch("src.runtimes.lambda_volcano_collector.requests.post")
        mock_post.return_value.raise_for_status.side_effect = RuntimeError("boom")

        try:
            ingest_disruption(_volcano_event())
            assert False, "expected raise_for_status failure to propagate"
        except RuntimeError:
            pass


class TestHandler:
    def test_skips_when_no_volcano_is_disruptive(self, mocker):
        mocker.patch("src.runtimes.lambda_volcano_collector.detect_volcano_events", return_value=[])
        mock_ingest = mocker.patch("src.runtimes.lambda_volcano_collector.ingest_disruption")

        result = handler({}, None)

        mock_ingest.assert_not_called()
        assert result == {"ingested": 0}

    def test_ingests_each_detected_event(self, mocker):
        mocker.patch(
            "src.runtimes.lambda_volcano_collector.detect_volcano_events",
            return_value=[_volcano_event()],
        )
        mock_ingest = mocker.patch("src.runtimes.lambda_volcano_collector.ingest_disruption")

        result = handler({}, None)

        assert result == {"ingested": 1}
        mock_ingest.assert_called_once()
