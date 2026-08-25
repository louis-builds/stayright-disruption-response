"""Pydantic schema for the unified DisruptionEvent contract.

Every data source (weather today, flight/road later) must normalise its
output into this shape before it reaches the identify module. Do not let
downstream code branch on `source` — if a new source needs special
handling, that handling belongs in its own detect adapter, not here.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


class EventSource(str, Enum):
    WEATHER = "weather"
    FLIGHT = "flight"
    ROAD = "road"


class Severity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class GeoType(str, Enum):
    POINT = "point"
    POLYGON = "polygon"


class GeoPoint(BaseModel):
    lat: float
    lng: float


class Geo(BaseModel):
    type: GeoType
    center: GeoPoint
    radius_km: float = Field(ge=0)

    @model_validator(mode="after")
    def _polygon_not_yet_supported(self) -> "Geo":
        if self.type is GeoType.POLYGON:
            raise ValueError(
                "geo.type='polygon' is not implemented yet; only 'point' "
                "is supported by the current detect/identify modules"
            )
        return self


class TimeWindow(BaseModel):
    start: datetime
    end: datetime

    @field_validator("start", "end")
    @classmethod
    def _require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("datetime must be timezone-aware (UTC)")
        return value

    @model_validator(mode="after")
    def _start_before_end(self) -> "TimeWindow":
        if self.start >= self.end:
            raise ValueError("affects_window.start must be before affects_window.end")
        return self


class DisruptionEvent(BaseModel):
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    source: EventSource
    event_type: str
    severity: Severity
    detected_at: datetime
    affects_window: TimeWindow
    geo: Geo
    raw_payload: dict[str, Any] = Field(default_factory=dict)

    @field_validator("detected_at")
    @classmethod
    def _detected_at_has_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("detected_at must be timezone-aware (UTC)")
        return value

    model_config = {"extra": "forbid"}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
