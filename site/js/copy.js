// Every visitor-facing string. Rendered with textContent only, never as HTML.

export const VARIANTS = {
  // A/B test: which promise on the landing page gets more people to a recommendation.
  control: { // savings message (baseline)
    headline: 'Could an EV save you money?',
    subhead: 'Enter your ZIP code for a one-minute, personalized check: what you would spend on charging versus gas, and whether charging near you fits your life.',
    firstStop: 'fuel', // the stop promoted to second on the results route
  },
  adventure: { // adventure message (test)
    headline: 'Can an EV keep up with your adventures?',
    subhead: 'Enter your ZIP code for a one-minute, personalized check: charging near the parks you would drive to, and whether an EV fits your everyday driving.',
    firstStop: 'parks',
  },
};

export const QUESTION_COPY = {
  dailyMiles: {
    legend: 'On a typical day, how far do you drive?',
    hint: 'Include commuting, errands, and school runs. A rough guess is fine.',
    options: {
      under20: 'Under 20 miles',
      '20to40': '20 to 40 miles',
      '40to70': '40 to 70 miles',
      '70to100': '70 to 100 miles',
      over100: 'Over 100 miles',
    },
  },
  homeCharging: {
    legend: 'Could you charge where you park overnight?',
    hint: 'A regular outlet or a charger in a garage, driveway, or assigned spot counts.',
    options: {
      yes: 'Yes, there is an outlet or charger I can use',
      install: 'Not yet, but I own my place and could install one',
      ask: 'Maybe: I rent and could ask my landlord or building',
      no: 'No, I park on the street or in shared parking',
    },
  },
  workCharging: {
    legend: 'Is there charging where your car sits for hours during the day?',
    hint: 'For example at work, school, or a park-and-ride. Many renters charge this way.',
    options: {
      yes: 'Yes, or I could likely get access',
      no: 'No, or I don’t know of any',
    },
  },
  longTrips: {
    legend: 'How often do you take long drives?',
    hint: 'Trips of about 200 miles or more, round trip.',
    options: {
      rarely: 'Rarely or never',
      few: 'A few times a year',
      monthly: 'About once a month',
      weekly: 'Most weeks',
    },
  },
  outdoor: {
    legend: 'How often do you head to trailheads, parks, or campgrounds?',
    hint: 'Day trips and weekends both count.',
    options: {
      rarely: 'Rarely',
      few: 'A few times a year',
      monthly: 'Once a month or more',
    },
  },
};

export const TIER_COPY = {
  strong: 'An EV fits how you live and drive.',
  good: 'An EV can work well for you with a little planning.',
  maybe: 'An EV could work, but there are real tradeoffs to plan around.',
  notyet: 'An EV would be hard to live with right now. A hybrid may fit better today.',
};

const usd = (n) => `$${Math.abs(Math.round(n / 10) * 10).toLocaleString('en-US')}`;

// Reason ids come from logic.js reasonsFor(). `v` is the reason's value.
export const REASON_COPY = {
  'home-yes': () => 'You can charge at home. That matters most: you start most days full, and home electricity is the cheapest way to charge.',
  'home-install': () => 'You could add a home charger. Get an electrician’s quote first; installation cost depends on your electrical panel and where you park.',
  'home-no-dense': () => 'No home charging, but there is a lot of public charging near you. It can work if charging becomes part of your routine, like a weekly fast charge or charging at work.',
  'home-no-sparse': () => 'No home charging, and public charging near you is thin. That is the hardest setup to live with day to day.',
  'home-ask': () => 'You might be able to charge at home if your landlord agrees. Ask early: some states have “right to charge” rules that help renters, and even a regular outdoor outlet covers most daily driving.',
  'work-yes': () => 'You can charge where your car sits during the day. For many renters, that stands in for home charging on most days.',
  'home-unknown': (v) => `We don’t know yet whether you can charge at home. About ${v}% of homes in your ZIP are single-family, so we assumed a ${v}% chance. Answering that question sharpens this result the most.`,
  'range-easy': (v) => `Your driving needs about ${v} miles between charges, including a buffer for winter and a reserve. Nearly every EV on sale covers that.`,
  'range-some': (v) => `Your driving needs about ${v} miles between charges. Some EVs cover that, so check rated range carefully.`,
  'range-hard': (v) => `Your driving needs about ${v} miles between charges, more than most EVs offer today.`,
  'local-strong': (v) => `There is more public fast charging near you than in ${v}% of U.S. ZIP codes.`,
  'local-ok': () => 'There is some public charging near you, but not a lot.',
  'local-weak': () => 'Public charging near you is sparse.',
  'trips-ok': () => 'Fast chargers are close to home, which makes frequent long drives easier.',
  'trips-hard': () => 'Frequent long drives plus distant fast charging means more planning on the road.',
  'savings-yes': (v) => `You would likely save about ${usd(v)} a year on fuel.`,
  'savings-small': (v) => `Fuel savings would be small, about ${usd(v)} a year, mostly because public charging costs more than charging at home.`,
  'savings-none': (v) => `Fuel would likely cost about ${usd(v)} more a year than gas, because you would rely on public fast charging.`,
  'blocker-no-charging-access': () => 'No home charging and no public chargers close by. Until that changes, an EV would be hard to live with.',
  'blocker-range-exceeds-lineup': () => 'Your daily driving is more than the rated range of every EV on sale today.',
};

export const ASSUMED_COPY = {
  dailyMiles: (inp) => `Daily driving: about ${inp.dailyMiles} miles, scaled from the average commute in your ZIP (Census ACS).`,
  workCharging: () => 'Daytime charging (work, school): assumed not available.',
  homeCharging: (inp) => `Home charging: a ${Math.round(inp.homeChargeOdds * 100)}% chance, from the share of single-family homes in your ZIP (Census ACS).`,
  longTrips: () => 'Long drives: a few times a year.',
  outdoor: () => 'Outdoor trips: a few times a year.',
};

export const CHARGING_AT_PARK = {
  good: 'Good fast charging near the park',
  some: 'Some fast charging within 25 miles',
  sparse: 'Fast charging is sparse; plan ahead',
  none: 'No fast charging within 50 miles',
};

export const LEARN_MORE = [
  { id: 'stations', label: 'Find chargers near you', source: 'Alternative Fuels Data Center station locator', url: 'https://afdc.energy.gov/stations' },
  { id: 'home-charging', label: 'How home charging works', source: 'U.S. Department of Energy', url: 'https://afdc.energy.gov/fuels/electricity-charging-home' },
  { id: 'models', label: 'Compare EV range and efficiency', source: 'fueleconomy.gov', url: 'https://www.fueleconomy.gov/feg/evsbs.shtml' },
];

// "Get my EV plan": a fake-door test. It measures interest in a plan follow-up and
// collects nothing, then gives the visitor a real checklist built from their answers.
export const PLAN_CTA = {
  button: 'Get my EV plan',
  thanksTitle: 'Your EV plan',
  thanksBody: (n) => `${n} steps, built from your answers. Tick them off as you go. This is a prototype: there is no sign-up and nothing about you was collected; your click tells us a plan like this is worth building.`,
  print: 'Print or save as PDF',
  done: 'Done',
};

// Each plan step: a short action to scan, the detail underneath, and the route stop it belongs to
// (which sets its color on the line). The last step is always the loaded test drive.
export const PLAN_CATEGORY = {
  home: 'Where you charge',
  charger: 'Charging nearby',
  range: 'What to shop for',
  parks: 'Park trips',
  finish: 'Before you buy',
};

export const PLAN_STEPS = {
  'plan-install': { stop: 'home', title: () => 'Get an electrician’s quote', detail: () => 'For a Level 2 charger where you park. Ask whether your electrical panel has room.' },
  'plan-landlord': { stop: 'home', title: () => 'Ask your landlord about charging', detail: () => 'A dedicated outlet, a shared charger, or permission to install one. Check whether your state has a “right to charge” rule for renters.' },
  'plan-find-home': { stop: 'home', title: () => 'Find out if you can charge overnight', detail: () => 'Where you park overnight is the biggest factor in whether an EV is easy to live with.' },
  'plan-work': { stop: 'home', title: () => 'Confirm charging at work', detail: () => 'How many chargers there are, whether you need to move the car, and what it costs.' },
  'plan-public': {
    stop: 'charger',
    title: () => 'Scout your nearest chargers',
    detail: (v) => (v == null
      ? 'Find the closest public chargers to home, and a Level 2 station somewhere you already spend time, like a grocery store or gym.'
      : `Your nearest fast charger is about ${v} miles away. Find a Level 2 station somewhere you already spend time, like a grocery store or gym.`),
  },
  'plan-home-l2': { stop: 'home', title: () => 'Consider a Level 2 charger', detail: () => 'A regular outlet adds a few miles of range per hour. A Level 2 charger adds about 20 to 30.' },
  'plan-range': { stop: 'range', title: (v) => `Shop for ${v}+ miles of range`, detail: () => 'In an SUV, minivan, or pickup with the space you need.' },
  'plan-range-any': { stop: 'range', title: () => 'Shop on space, not range', detail: () => 'Every electric SUV, minivan, and pickup on sale covers your daily driving with room to spare. Compare space, comfort, and charging speed instead.' },
  'plan-park': { stop: 'parks', title: (v) => `Plan a charging stop for ${v}`, detail: () => 'Charging near the park is limited, so plan a fast-charging stop on the way.' },
  'plan-route': { stop: 'charger', title: () => 'Rehearse your longest drive', detail: () => 'Try your most common long drive in a charging route planner before you buy.' },
  'plan-test-drive': { stop: 'finish', title: () => 'Test-drive it fully loaded', detail: () => 'Bring the car seats, the dog’s crate, or your gear, and check that everything fits with the cargo area full.' },
};

// ---------- results route ----------

// One line under the verdict: the single answer or step that would change the result most.
export const FOCUS_COPY = {
  'blocker-no-charging-access': 'What stands in the way: there is nowhere to charge near you yet.',
  'blocker-range-exceeds-lineup': 'What stands in the way: your daily driving is beyond any EV on sale.',
  unknown: 'The answer that matters most: whether you can charge where you park overnight.',
  ask: 'The answer that matters most: ask your landlord about charging.',
  install: 'The step that matters most: an electrician’s quote for a home charger.',
  work: 'What makes this work: charging where your car sits during the day.',
  public: 'What makes this work: a charging routine near home, like a weekly fast charge.',
  yes: 'You can charge at home, and that matters most.',
};

// Visible tone words on each stop, so tone never rides on color alone.
export const TONE_COPY = {
  plus: { chip: 'Helps', sr: 'Works in your favor.' },
  check: { chip: 'Check', sr: 'Worth checking.' },
  minus: { chip: 'Hurts', sr: 'Works against you.' },
};

export const HOME_STOP = {
  yes: { figure: 'Yes', detail: 'You can charge where you park overnight.' },
  install: { figure: 'Install', detail: 'You own your place and could add a charger.' },
  ask: { figure: 'Ask', detail: 'You rent. Home charging is possible if your landlord agrees.' },
  'no-work': { figure: 'Work', detail: 'No home charging, but you can charge during the day.' },
  no: { figure: 'No', detail: 'No home charging. Public charging would carry you.' },
  unknown: { figure: 'Unknown', detail: (pct) => `Typical for your ZIP: ${pct}% of homes are single-family.` },
};
