// Display rules for names from public data. These run at render time only: stored data, saved
// plans, and analytics keep the source's own text.

// Uppercase words that stay uppercase. Charging terms, common agencies and brands that are
// written as initials, and state codes that aren't also ordinary words (IN, OR, ME, HI, OH,
// OK, LA, CO, DE, AL, ID, and PA read as words in station names, so they get title case, and
// CT, FL, and MT are usually court, floor, and mount).
const ACRONYMS = new Set(`
  EV EVS EVC EVSE DC DCFC CCS NACS AC SC HQ USA US UC UCLA UCSD UCSF UCI USC NYU MIT ADA AAA
  IKEA BMW GM VW AMC HOA YMCA YWCA ATM PD FD ISD USD NPS BLM USPS DMV DOT VA ARCO AMZ OBE
  II III IV VI VII VIII IX XI XII
  AK AZ AR CA GA IA KS KY MA MI MN MO MS NC ND NE NH NJ NM NV NY RI SD TN TX UT VT WA WI WV WY
`.trim().split(/\s+/));

// Words without a vowel are almost always initials (BVSD, PCB), except these abbreviations.
const ABBREVIATIONS = new Set('ST DR RD LN CT PL PT SQ MT FT JR SR BLVD BLDG BLDGS PLZ STN CTR CNTR LVL FL FLR PKG GRG MGMT DPT'.split(' '));

// Short joining words stay lowercase inside a name.
const SMALL = new Set('OF THE AND AT IN ON FOR TO BY'.split(' '));

const cap = (w) => w.charAt(0) + w.slice(1).toLowerCase();

/** One all-letters word. `joining` is true when it stands between spaces, not first. */
function word(w, joining) {
  if (w.length === 1 || ACRONYMS.has(w)) return w;
  if (ABBREVIATIONS.has(w)) return cap(w);
  if (!/[AEIOUY]/.test(w)) return w; // BVSD, CSG
  if (/^[A-Z]{1,4}[IUHC]?SD$/.test(w)) return w; // school districts: AISD, TUHSD
  if (joining && SMALL.has(w)) return w.toLowerCase();
  if (/^MC[A-Z]{2,}/.test(w)) return `Mc${cap(w.slice(2))}`; // MCKINLEY → McKinley
  return cap(w);
}

/** A word run together with figures: 2ND → 2nd, OFFICE2 → Office2; short codes (DC1, ECE1) stay. */
function code(w) {
  if (/^\d+(ST|ND|RD|TH)$/.test(w)) return w.toLowerCase();
  return w.replace(/[A-Z]+/g, (run) => (run.length >= 4 ? word(run, false) : run));
}

/**
 * A station or place name as it should read. Names that already use lowercase letters were
 * written with care and are shown as they are. Names entirely in capitals (most NREL station
 * names) get title case, keeping initials, codes, and acronyms uppercase.
 */
export function displayName(name) {
  const s = String(name ?? '');
  if (!/[A-Z]/.test(s) || /[a-z]/.test(s)) return s;
  return s.replace(/[A-Z0-9]+(?:'[A-Z]+)?/g, (token, at) => {
    const before = s.charAt(at - 1);
    const after = s.charAt(at + token.length);
    if (before === '&' || after === '&') return token; // AT&T, F&M
    if (/\d/.test(token)) return code(token);
    const [base, tail] = token.split("'");
    const joining = at > 0 && before === ' ' && (after === '' || after === ' ');
    if (tail == null) return word(base, joining);
    // O'BRIEN → O'Brien; MCDONALD'S → McDonald's
    return base === 'O' ? `O'${cap(tail)}` : `${word(base, false)}'${tail.toLowerCase()}`;
  });
}
