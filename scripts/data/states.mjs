// Static lookup tables for the data build.

export const FIPS_TO_STATE = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE',
  '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA',
  '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM',
  '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY',
};

export const STATE_NAME_TO_ABBR = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
  Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY',
  Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH',
  'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
  Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};

// EIA publishes weekly gasoline prices for nine states and for PADD regions.
// Each state uses the most specific area EIA reports, falling back to the U.S. average.
const P1A = 'New England (PADD 1A)';
const P1B = 'Central Atlantic (PADD 1B)';
const P1C = 'Lower Atlantic (PADD 1C)';
const P2 = 'Midwest (PADD 2)';
const P3 = 'Gulf Coast (PADD 3)';
const P4 = 'Rocky Mountain (PADD 4)';
const P5X = 'West Coast less California';
const US = 'U.S.';

export const STATE_TO_GAS_AREA = {
  CT: [P1A, US], ME: [P1A, US], MA: ['Massachusetts', P1A, US], NH: [P1A, US], RI: [P1A, US], VT: [P1A, US],
  DE: [P1B, US], DC: [P1B, US], MD: [P1B, US], NJ: [P1B, US], NY: ['New York', P1B, US], PA: [P1B, US],
  FL: ['Florida', P1C, US], GA: [P1C, US], NC: [P1C, US], SC: [P1C, US], VA: [P1C, US], WV: [P1C, US],
  IL: [P2, US], IN: [P2, US], IA: [P2, US], KS: [P2, US], KY: [P2, US], MI: [P2, US],
  MN: ['Minnesota', P2, US], MO: [P2, US], NE: [P2, US], ND: [P2, US], SD: [P2, US], OH: ['Ohio', P2, US],
  OK: [P2, US], TN: [P2, US], WI: [P2, US],
  AL: [P3, US], AR: [P3, US], LA: [P3, US], MS: [P3, US], NM: [P3, US], TX: ['Texas', P3, US],
  CO: ['Colorado', P4, US], ID: [P4, US], MT: [P4, US], UT: [P4, US], WY: [P4, US],
  AK: [P5X, US], AZ: [P5X, US], CA: ['California', US], HI: [P5X, US], NV: [P5X, US], OR: [P5X, US],
  WA: ['Washington', P5X, US],
};
