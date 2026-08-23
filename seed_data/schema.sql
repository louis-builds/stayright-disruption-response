-- Minimal local schema for the identify module.
-- Field set matches CLAUDE.md exactly; extend only with a matching update there.

CREATE TABLE IF NOT EXISTS properties (
    property_id TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    lat         DOUBLE PRECISION NOT NULL,
    lng         DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
    booking_id  TEXT PRIMARY KEY,
    property_id TEXT NOT NULL REFERENCES properties(property_id),
    guest_id    TEXT NOT NULL,
    check_in    DATE NOT NULL,
    check_out   DATE NOT NULL
);
