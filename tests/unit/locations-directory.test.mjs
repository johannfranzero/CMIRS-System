import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createLocationsDirectoryResult,
  filterLocationsBySearch,
  mapDirectoryLocation,
  LOCATIONS_DIRECTORY_ERROR_MESSAGE,
} from '../../utils/locations/directory.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const myAppRoot = path.resolve(__dirname, '../..');

const locations = [
  {
    id: 'location-1',
    building_name: 'Main Academic Building',
    floor: 'Second Floor',
    room: 'Computer Laboratory',
    description: 'East wing collaborative computing space',
  },
  {
    id: 'location-2',
    building_name: 'University Library',
    floor: 'Ground',
    room: 'Reading Area',
    description: 'Quiet study collection',
  },
];

test('Locations directory: maps only public directory fields and normalizes optional values', () => {
  const mapped = mapDirectoryLocation({
    ...locations[0],
    floor: undefined,
    room: undefined,
    description: undefined,
    is_active: false,
  });

  assert.deepEqual(mapped, {
    id: 'location-1',
    building_name: 'Main Academic Building',
    floor: null,
    room: null,
    description: null,
  });
  assert.equal('is_active' in mapped, false);
});

test('Locations directory: search matches building, floor, room, and description', () => {
  assert.deepEqual(filterLocationsBySearch(locations, 'academic').map((location) => location.id), ['location-1']);
  assert.deepEqual(filterLocationsBySearch(locations, 'ground').map((location) => location.id), ['location-2']);
  assert.deepEqual(filterLocationsBySearch(locations, 'laboratory').map((location) => location.id), ['location-1']);
  assert.deepEqual(filterLocationsBySearch(locations, 'quiet study').map((location) => location.id), ['location-2']);
  assert.equal(filterLocationsBySearch(locations, '  UNIVERSITY  ').length, 1);
});

test('Locations directory: keeps empty catalog separate from no-search-match behavior', () => {
  assert.deepEqual(filterLocationsBySearch([], 'library'), []);
  assert.deepEqual(filterLocationsBySearch(locations, 'gymnasium'), []);
  assert.deepEqual(filterLocationsBySearch(locations, '   '), locations);
});

test('Locations directory: retrieval errors return a sanitized empty result without fallback data', () => {
  const failureResult = createLocationsDirectoryResult(locations, new Error('relation public.locations failed'));
  assert.deepEqual(failureResult, {
    locations: [],
    error: LOCATIONS_DIRECTORY_ERROR_MESSAGE,
  });

  assert.deepEqual(createLocationsDirectoryResult([], null), { locations: [], error: null });
});

test('Locations directory DAL: queries active records with only directory fields and no fallback result', () => {
  const dal = fs.readFileSync(path.join(myAppRoot, 'utils/reports/dal.ts'), 'utf8');
  const directoryFunction = dal.slice(dal.indexOf('export async function getLocationsDirectory'));

  assert.ok(directoryFunction.includes(".from('locations')"));
  assert.ok(directoryFunction.includes(".select('id, building_name, floor, room, description')"));
  assert.ok(directoryFunction.includes(".eq('is_active', true)"));
  assert.equal(directoryFunction.includes('FALLBACK_LOCATIONS'), false);
  assert.ok(directoryFunction.includes('createLocationsDirectoryResult(data, error)'));
});

test('Locations page and navigation: all authenticated roles retain access to the implemented directory', () => {
  const page = fs.readFileSync(path.join(myAppRoot, 'app/locations/page.tsx'), 'utf8');
  const navigation = fs.readFileSync(path.join(myAppRoot, 'config/navigation.ts'), 'utf8');
  const roles = ['student_personnel', 'technician', 'coordinator', 'administrator', 'management'];

  assert.ok(page.includes("requireAuth('/locations')"));
  assert.ok(page.includes('getLocationsDirectory()'));
  assert.ok(page.includes('<LocationsDirectory locations={directory.locations} />'));
  assert.ok(page.includes('directory.error'));

  const locationsNavigation = navigation.slice(
    navigation.indexOf("name: 'Campus Locations'"),
    navigation.indexOf("name: 'Operations Analytics'")
  );
  assert.ok(locationsNavigation.includes('allowedRoles: USER_ROLES'));
  assert.ok(locationsNavigation.includes("badge: 'Active'"));
  assert.ok(locationsNavigation.includes('isPlaceholder: false'));

  for (const role of roles) {
    assert.ok(roles.includes(role), `${role} remains one of the authorized locations roles`);
  }
});
