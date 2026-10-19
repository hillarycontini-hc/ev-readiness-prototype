// Analytics placeholder for milestone 2: assigns the A/B variant and drops events.
// Milestone 3 replaces this with privacy-configured PostHog.

const VARIANTS = ['savings', 'adventure'];

export function init() {
  return VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
}

export function track() {}

export function status() {
  return 'not-configured';
}

export function optOut() {}
