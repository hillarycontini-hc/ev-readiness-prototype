// Every visitor-facing string. Rendered with textContent only, never as HTML.

export const VARIANTS = {
  // A/B test: which promise on the landing page gets more people to a recommendation.
  savings: {
    headline: 'Could an EV save you money?',
    subhead: 'Enter your ZIP code for a one-minute, personalized check: what you would spend on charging versus gas, and whether charging near you fits your life.',
    firstCard: 'costs',
  },
  adventure: {
    headline: 'Can an EV keep up with your adventures?',
    subhead: 'Enter your ZIP code for a one-minute, personalized check: charging near the parks you would drive to, and whether an EV fits your everyday driving.',
    firstCard: 'outdoor',
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
      yes: 'Yes, there is an outlet or charger there',
      install: 'Not yet, but I could install one',
      no: 'No, I park on the street or in shared parking',
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
