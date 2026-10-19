// Public, client-side configuration. Nothing here is a secret.
//
// POSTHOG_KEY is a PostHog *project* API key (starts with "phc_"). It can only
// send events into the project; it cannot read data. PostHog designs it to sit
// in client code. Leave it empty to run with analytics fully off.
//
// If you switch to PostHog EU cloud, change POSTHOG_HOST to https://eu.i.posthog.com
// AND update connect-src in the Content-Security-Policy in both index.html and _headers.

export const POSTHOG_KEY = '';
export const POSTHOG_HOST = 'https://us.i.posthog.com';

// A/B test id. Must match the experiment's feature flag key in PostHog.
export const EXPERIMENT_KEY = 'landing-messaging';

export const APP_VERSION = '0.3.0';
