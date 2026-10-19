// Car-cost math for the plan's car explorer. Pure functions; unit tested.
// Estimates only: taxes, registration, dealer fees, incentives, and negotiated prices are not included.

/** Monthly loan payment on (price + destination - down payment). */
export function loanPayment({ price, down = 0, aprPct, months }) {
  const principal = Math.max(0, price - down);
  if (principal === 0) return 0;
  const r = aprPct / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - (1 + r) ** -months);
}

/**
 * Rough monthly lease payment, the standard way leases are quoted:
 * depreciation ((capitalized cost - residual) / months) plus a finance charge
 * ((capitalized cost + residual) x money factor). Due-at-signing money reduces the capitalized cost.
 */
export function leasePayment({ msrp, price, dueAtSigning = 0, residualPct, moneyFactor, months }) {
  const capCost = Math.max(0, price - dueAtSigning);
  const residual = msrp * (residualPct / 100);
  const depreciation = Math.max(0, capCost - residual) / months;
  const finance = (capCost + residual) * moneyFactor;
  return depreciation + finance;
}

/** Money factor to the APR people usually see (money factor x 2400). */
export const moneyFactorToApr = (mf) => mf * 2400;
