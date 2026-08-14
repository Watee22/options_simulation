// src/utils/optionPricing.js
// Shared option pricing inputs so the options chain and the portfolio
// always value the same contract with the same model (single source of truth).

import { CONFIG } from '../constants/config';

/**
 * Implied volatility for a given maturity and strike:
 * 1. Term structure: 0-2 DTE aggressive crush, 3+ DTE exponential decay
 *    back to the long-run (initial) volatility, floored at INITIAL_VOLATILITY
 *    to prevent inverted term structure during shocks.
 * 2. Strike skew (equity style): OTM puts demand a premium (crash insurance)
 *    and OTM calls trade cheaper. The slope scales with the prevailing IV
 *    level, so panic periods (elevated IV) show a steeper smile.
 * @param {number} timeToMaturityYears T in years
 * @param {number} baseVolatility current IV state (store.volatility)
 * @param {number|null} spotPrice current underlying price (for skew)
 * @param {number|null} strike strike price (for skew)
 * @returns {number} adjusted IV for that maturity/strike
 */
export function getTermVolatility(timeToMaturityYears, baseVolatility, spotPrice = null, strike = null) {
  const T = Math.max(0, timeToMaturityYears);
  const daysToMaturity = T * 365;

  let termVolatility = baseVolatility;
  if (daysToMaturity < 3) {
    const crushFactor = Math.pow(Math.max(0.1, daysToMaturity) / 3, 0.5);
    termVolatility = termVolatility * crushFactor;
  } else {
    const timeVolAdjust = Math.exp(-(T - 3 / 365) * 2);
    termVolatility = CONFIG.INITIAL_VOLATILITY + (baseVolatility - CONFIG.INITIAL_VOLATILITY) * timeVolAdjust;
  }
  termVolatility = Math.max(termVolatility, CONFIG.INITIAL_VOLATILITY);

  if (spotPrice != null && strike != null && spotPrice > 0) {
    const moneyness = 1 - strike / spotPrice; // >0 for OTM puts, <0 for OTM calls
    const skewSlope = baseVolatility * 1.5;
    termVolatility += skewSlope * moneyness;
    termVolatility = Math.min(3, Math.max(0.05, termVolatility));
  }

  return termVolatility;
}