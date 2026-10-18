-- =============================================================================
-- CMIRS Baseline Seed Data Script (Option A: Generic Testing Fixtures)
-- File: supabase/seed.sql
-- Prerequisites: Migrations 1-6 applied.
-- Target: xyirfifvcntuzceivtho (Supabase Cloud)
-- Status: APPROVED BY OWNER FOR DEVELOPMENT AND TESTING (2026-10-18)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Seed Baseline Categories (Idempotent upsert via deterministic UUIDs)
-- -----------------------------------------------------------------------------
INSERT INTO public.categories (id, name, description, is_active)
VALUES
  ('c0000000-0000-4000-a000-000000000001', 'Electrical & Lighting', 'Power outlets, lighting fixtures, circuit breakers, and switches', true),
  ('c0000000-0000-4000-a000-000000000002', 'Plumbing & Water', 'Leaks, pipe blockages, faucets, toilets, and water supply issues', true),
  ('c0000000-0000-4000-a000-000000000003', 'HVAC & Ventilation', 'Air conditioning, heating, ventilation fans, and temperature control', true),
  ('c0000000-0000-4000-a000-000000000004', 'Structural & Carpentry', 'Doors, windows, locks, walls, ceiling tiles, and structural damage', true),
  ('c0000000-0000-4000-a000-000000000005', 'General Maintenance', 'Furniture, painting, groundskeeping, and miscellaneous facility repairs', true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active;

-- -----------------------------------------------------------------------------
-- 2. Seed Baseline Campus Locations (Idempotent upsert via deterministic UUIDs)
-- -----------------------------------------------------------------------------
INSERT INTO public.locations (id, building_name, floor, room, description, is_active)
VALUES
  ('d0000000-0000-4000-b000-000000000001', 'Main Academic Building', '1', '101', 'Main Lecture Hall', true),
  ('d0000000-0000-4000-b000-000000000002', 'Main Academic Building', '2', '204', 'Computer Laboratory', true),
  ('d0000000-0000-4000-b000-000000000003', 'Administration Wing', '1', '110', 'Administrative Office', true),
  ('d0000000-0000-4000-b000-000000000004', 'University Library', '1', 'Reading Area', 'Main Library Reading Room', true),
  ('d0000000-0000-4000-b000-000000000005', 'Student Union Building', 'Ground', 'Cafeteria', 'Dining and Kitchen Area', true)
ON CONFLICT (id) DO UPDATE SET
  building_name = EXCLUDED.building_name,
  floor = EXCLUDED.floor,
  room = EXCLUDED.room,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active;

COMMIT;
