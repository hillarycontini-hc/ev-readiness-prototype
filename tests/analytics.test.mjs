import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeEvent, track, status } from '../site/js/analytics.js';

test('sanitizeEvent trims every URL to origin + path', () => {
  const e = sanitizeEvent({ properties: {
    $current_url: 'https://example.org/?zip=80302#results',
    $session_entry_url: 'https://example.org/page?utm_source=x',
    $referrer: 'https://www.linkedin.com/feed/update/123?trk=abc',
  } });
  assert.equal(e.properties.$current_url, 'https://example.org/');
  assert.equal(e.properties.$session_entry_url, 'https://example.org/page');
  assert.equal(e.properties.$referrer, 'https://www.linkedin.com/feed/update/123');
});

test('sanitizeEvent drops IP, raw user agent, timezone, and ad click ids', () => {
  const e = sanitizeEvent({ properties: {
    $ip: '203.0.113.9', $raw_user_agent: 'UA', $timezone: 'America/Denver', $timezone_offset: 360,
    fbclid: 'x', gclid: 'y', $session_entry_fbclid: 'z', $session_entry_gclid: 'w',
    $browser: 'Chrome',
  } });
  assert.deepEqual(Object.keys(e.properties), ['$browser']);
});

test('sanitizeEvent keeps only allowlisted custom properties', () => {
  const e = sanitizeEvent({ properties: {
    token: 't', distinct_id: 'd', tier: 'good', state: 'CO', utm_source: 'linkedin',
    zip: '80302', zip_code: '80302', email: 'a@b.c', lat: 40, lon: -105, anything_else: 1,
  } });
  assert.deepEqual(Object.keys(e.properties).sort(), ['distinct_id', 'state', 'tier', 'token', 'utm_source']);
});

test('without a configured key, analytics is off and track is a no-op', () => {
  assert.equal(status(), 'not-configured');
  assert.doesNotThrow(() => track('landing_viewed', { zip: '80302' }));
});
