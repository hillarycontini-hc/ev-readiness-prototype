import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayName } from '../site/js/names.js';

test('all-caps station names get title case, keeping initials and codes', () => {
  assert.equal(displayName('BVSD MAPLETON ECE1'), 'BVSD Mapleton ECE1');
  assert.equal(displayName('MUNICIPAL SC 1100WALNUT1'), 'Municipal SC 1100Walnut1');
  assert.equal(displayName('GEORGIA POWER COLUMBUS DC1'), 'Georgia Power Columbus DC1');
  assert.equal(displayName('STADIUM LOFTS EV CHARGER 01'), 'Stadium Lofts EV Charger 01');
  assert.equal(displayName('BMW CL DC250 1'), 'BMW CL DC250 1');
  assert.equal(displayName('AISD CENTRAL OFFICE2'), 'AISD Central Office2');
  assert.equal(displayName('TUHSD RHS EV1'), 'TUHSD RHS EV1');
  assert.equal(displayName('CCS FAST CHARGER NY 7'), 'CCS Fast Charger NY 7');
});

test('joining words, abbreviations, ordinals, and names with apostrophes read naturally', () => {
  assert.equal(displayName('CITY OF OAKLAND STATION 3'), 'City of Oakland Station 3');
  assert.equal(displayName('THE BLAKE LEVEL 1 STN 1'), 'The Blake Level 1 Stn 1');
  assert.equal(displayName('EV STATION AT TOWN HALL 1'), 'EV Station at Town Hall 1');
  assert.equal(displayName('AT HOME'), 'At Home');
  assert.equal(displayName('HUDSON GATEWAY BLDG 2 UNIT 3'), 'Hudson Gateway Bldg 2 Unit 3');
  assert.equal(displayName('ONE BOULDER PLZ 1301'), 'One Boulder Plz 1301');
  assert.equal(displayName("MCDONALD'S 2ND ST"), "McDonald's 2nd St");
  assert.equal(displayName("O'BRIEN HALL"), "O'Brien Hall");
  assert.equal(displayName('MEMORIAL CITY MCKINLEY'), 'Memorial City McKinley');
  assert.equal(displayName('WENDY’S 1'), 'Wendy’s 1');
  assert.equal(displayName('O’KEEFE PLAZA'), 'O’Keefe Plaza');
  assert.equal(displayName('METRO NASHVILLE SE LIBRARY 2'), 'Metro Nashville SE Library 2');
  assert.equal(displayName('SFO LOT D'), 'SFO Lot D');
  assert.equal(displayName('HAMPTON INN HAMPTON IN'), 'Hampton Inn Hampton In');
});

test('initials joined by an ampersand and single letters stay as written', () => {
  assert.equal(displayName('AT&T PARK'), 'AT&T Park');
  assert.equal(displayName('EVERGY @B&V ENG -302D'), 'Evergy @B&V Eng -302D');
  assert.equal(displayName('BEDROCK Z DECK 2-1'), 'Bedrock Z Deck 2-1');
  assert.equal(displayName('7-ELEVEN 32625 FRSNO DC2'), '7-Eleven 32625 Frsno DC2');
});

test('names that already use lowercase, and empty or non-letter names, are untouched', () => {
  assert.equal(displayName('Tesla Supercharger'), 'Tesla Supercharger');
  assert.equal(displayName('NOT A PUBLIC SITE - IONNA Customer Experience Center'), 'NOT A PUBLIC SITE - IONNA Customer Experience Center');
  assert.equal(displayName('Boulder, CO'), 'Boulder, CO');
  assert.equal(displayName('1285 2'), '1285 2');
  assert.equal(displayName(''), '');
  assert.equal(displayName(null), '');
  assert.equal(displayName(undefined), '');
});
