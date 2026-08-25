-- Runs automatically ONLY the first time the Postgres container initializes
-- an empty data directory (see docker-compose.yml's volume mounts) --
-- creates the separate `kakapo` database used by the Python detect/identify
-- prototype (kept apart from the C# backend's `travel_disruption` database
-- so table names like `bookings` never collide) and loads its schema/seed
-- data from seed_data/, mounted read-only at /seed_data.
--
-- If your Postgres volume already existed before this file was added, this
-- won't run for you automatically -- either `docker compose down -v` for a
-- fresh volume, or run `python -m scripts.run_local_e2e --seed` once by hand.

CREATE DATABASE kakapo OWNER app;

\c kakapo

\i /seed_data/schema.sql
\i /seed_data/seed.sql
