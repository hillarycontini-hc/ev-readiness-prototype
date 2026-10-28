// Sorting, filters, and plain-language labels for the car explorer. Pure functions, unit tested.
//
// Neutrality: price (or the monthly estimate) is the default order, and every other sort breaks
// ties by that same budget order, then by name, so no brand is ever placed by hand. Missing data
// (not yet rated, no published cargo figure) always sorts last and is never treated as zero.

export const SORTS = {
  price: 'Lowest price',
  range: 'Longest range',
  seats: 'Most seats',
  cargo: 'Most cargo space',
  safety: 'Highest NHTSA rating',
  awards: 'Most awards (last 3 years)',
};

/** Awards won in the car's last three model years (this one and the two before). */
export const recentAwards = (v) => (v.awards || []).filter((w) => w.year >= v.modelYear - 2);

/** The sorts worth offering for this list: cargo and awards only once some car has the data. */
export function availableSorts(vehicles) {
  return Object.keys(SORTS).filter((k) => {
    if (k === 'cargo') return vehicles.some((v) => v.cargo);
    if (k === 'awards') return vehicles.some((v) => recentAwards(v).length);
    return true;
  });
}

/** Whether any car has an IIHS Top Safety Pick, so the filter is worth showing. */
export const hasIihs = (vehicles) => vehicles.some((v) => v.iihs);

// Higher is better for every non-price sort; null means "no data" and sorts last.
const VALUE = {
  range: (v) => v.rangeMax,
  seats: (v) => v.seats + (v.thirdRow ? 0.5 : 0),
  cargo: (v) => v.cargo?.value ?? null,
  safety: (v) => (v.nhtsa?.stars == null ? null : v.nhtsa.stars + v.nhtsa.starsMax / 10),
  awards: (v) => recentAwards(v).length || null,
};

/**
 * A comparator for `key`. `budget(a, b)` is the explorer's price or monthly order; it decides the
 * price sort and breaks every tie, then the name does.
 */
export function compareBy(key, budget) {
  const byName = (a, b) => `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`);
  const tie = (a, b) => budget(a, b) || byName(a, b);
  if (key === 'price' || !VALUE[key]) return tie;
  const val = VALUE[key];
  return (a, b) => {
    const x = val(a);
    const y = val(b);
    if (x == null && y == null) return tie(a, b);
    if (x == null) return 1;
    if (y == null) return -1;
    return y - x || tie(a, b);
  };
}

/** "NHTSA: 5-star overall", with a note when versions differ or some aren't rated yet. */
export function safetyText(v) {
  const r = v.nhtsa;
  if (!r || r.stars == null) return 'NHTSA: Not yet rated';
  const stars = r.stars === r.starsMax ? `${r.stars}-star overall` : `${r.stars} to ${r.starsMax} stars overall, by version`;
  const notes = [
    r.year && r.year !== v.modelYear ? `${r.year} model` : null,
    r.ratedVersions < r.versions ? `${r.ratedVersions} of ${r.versions} versions rated` : null,
  ].filter(Boolean);
  return `NHTSA: ${stars}${notes.length ? ` (${notes.join('; ')})` : ''}`;
}

export const iihsText = (v) => (v.iihs ? `IIHS ${v.iihs.award === 'TSP+' ? 'Top Safety Pick+' : 'Top Safety Pick'} ${v.iihs.year}${v.iihs.qualifier ? ` (${v.iihs.qualifier})` : ''}` : null);
export const cargoText = (v) => (v.cargo ? `${v.cargo.value} cu ft behind the 2nd row` : null);
