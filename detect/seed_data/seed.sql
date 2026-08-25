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
    ('booking-0006', 'prop-chc-1', 'guest-006', '2026-08-26', '2026-08-30'),
    -- guest-001 and guest-002 repeat here with a second stay, at a different
    -- time, in a different city, to exercise the "same guest, multiple
    -- cities/dates" case.
    ('booking-0007', 'prop-akl-1', 'guest-001', '2026-09-05', '2026-09-08'),
    ('booking-0008', 'prop-chc-1', 'guest-002', '2026-09-10', '2026-09-12'),
    ('booking-0009', 'prop-qtn-1', 'guest-007', '2026-08-29', '2026-09-02'),
    ('booking-0010', 'prop-qtn-2', 'guest-008', '2026-09-01', '2026-09-04'),
    ('booking-0011', 'prop-akl-1', 'guest-009', '2026-08-30', '2026-09-01'),
    ('booking-0012', 'prop-wgn-1', 'guest-010', '2026-09-03', '2026-09-06'),
    ('booking-0013', 'prop-chc-1', 'guest-011', '2026-09-07', '2026-09-09'),
    ('booking-0014', 'prop-qtn-1', 'guest-012', '2026-09-15', '2026-09-18'),
    ('booking-0015', 'prop-akl-1', 'guest-013', '2026-09-12', '2026-09-14'),
    ('booking-0016', 'prop-wgn-1', 'guest-014', '2026-09-20', '2026-09-23'),
    ('booking-0017', 'prop-chc-1', 'guest-015', '2026-09-18', '2026-09-20'),
    ('booking-0018', 'prop-qtn-2', 'guest-016', '2026-09-25', '2026-09-28'),
    ('booking-0019', 'prop-akl-1', 'guest-017', '2026-09-22', '2026-09-25'),
    ('booking-0020', 'prop-wgn-1', 'guest-018', '2026-10-01', '2026-10-03'),
    ('booking-0021', 'prop-chc-1', 'guest-019', '2026-09-28', '2026-09-30'),
    ('booking-0022', 'prop-qtn-1', 'guest-020', '2026-10-05', '2026-10-08'),
    ('booking-0023', 'prop-akl-1', 'guest-021', '2026-10-02', '2026-10-04'),
    ('booking-0024', 'prop-wgn-1', 'guest-022', '2026-10-10', '2026-10-12'),
    ('booking-0025', 'prop-chc-1', 'guest-023', '2026-10-08', '2026-10-10'),
    ('booking-0026', 'prop-qtn-2', 'guest-024', '2026-10-15', '2026-10-18')
ON CONFLICT (booking_id) DO NOTHING;
