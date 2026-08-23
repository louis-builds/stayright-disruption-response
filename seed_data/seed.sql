-- Fixture data for local dev / demo.
--
-- Paired with the simulated storm event used in scripts/run_local_e2e.py
-- and tests/test_identify.py (center = Queenstown -45.0312,168.6626,
-- radius_km = 30, window = 2026-08-25T00:00Z .. 2026-08-26T00:00Z):
--   booking-0001 -> matches (same property as event center)
--   booking-0002 -> matches (Queenstown, ~5km away, dates overlap)
--   booking-0003 -> excluded: Queenstown but stay is outside the window
--   booking-0004 -> excluded: dates overlap but Auckland is too far away
--   booking-0005 -> excluded: Wellington, too far away and stay ends before the window starts
--   booking-0006 -> excluded: dates overlap but Christchurch is too far away

INSERT INTO properties (property_id, name, lat, lng) VALUES
    ('prop-qtn-1', 'Queenstown Lakefront Lodge', -45.0312, 168.6626),
    ('prop-qtn-2', 'Queenstown Ski Chalet',      -45.0500, 168.7000),
    ('prop-akl-1', 'Auckland CBD Apartment',     -36.8485, 174.7633),
    ('prop-wgn-1', 'Wellington Harbour View',    -41.2865, 174.7762),
    ('prop-chc-1', 'Christchurch Garden Suite',  -43.5321, 172.6362)
ON CONFLICT (property_id) DO NOTHING;

INSERT INTO bookings (booking_id, property_id, guest_id, check_in, check_out) VALUES
    ('booking-0001', 'prop-qtn-1', 'guest-001', '2026-08-25', '2026-08-28'),
    ('booking-0002', 'prop-qtn-2', 'guest-002', '2026-08-24', '2026-08-26'),
    ('booking-0003', 'prop-qtn-1', 'guest-003', '2026-09-10', '2026-09-15'),
    ('booking-0004', 'prop-akl-1', 'guest-004', '2026-08-25', '2026-08-27'),
    ('booking-0005', 'prop-wgn-1', 'guest-005', '2026-08-20', '2026-08-24'),
    ('booking-0006', 'prop-chc-1', 'guest-006', '2026-08-26', '2026-08-30')
ON CONFLICT (booking_id) DO NOTHING;
