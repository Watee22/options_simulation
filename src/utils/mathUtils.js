/**
 * src/utils/mathUtils.js
 * Pure functions for Black-Scholes options pricing and Geometric Brownian Motion (GBM).
 * No external dependencies.
 */

/**
 * Helper: Standard Normal Cumulative Distribution Function (CDF)
 * Used to calculate N(d1) and N(d2) for Black-Scholes
 */
function normCDF(x) {
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const c = 0.39894228;

  if (x < 0) {
    return 1 - normCDF(-x);
  }
  
  const t = 1 / (1 + p * x);
  return 1 - c * Math.exp(-x * x / 2) * t * (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1);
}

/**
 * Helper: Standard Normal Probability Density Function (PDF)
 * Used to calculate Theta, Gamma, Vega
 */
function normPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Core 1: Black-Scholes Options Pricing and Greeks Calculation
 * @param {number} S Current stock price (Spot Price)
 * @param {number} K Strike Price
 * @param {number} T Time to Maturity in years
 * @param {number} r Risk-free Rate (default 0.05)
 * @param {number} v Volatility (default 0.30)
 * @returns {object} Theoretical Prices, Delta, Theta (daily), Gamma, Vega
 */
export function calculateBlackScholes(S, K, T, r, v) {
  // Handle expiration (time depleted)
  if (T <= 0 || T < (1 / 365)) {
    return {
      callPrice: Math.max(0, S - K),
      putPrice: Math.max(0, K - S),
      callDelta: S > K ? 1 : (S < K ? 0 : 0.5),
      putDelta: S < K ? -1 : (S > K ? 0 : -0.5),
      callTheta: 0,
      putTheta: 0,
      gamma: 0,
      vega: 0
    };
  }

  const d1 = (Math.log(S / K) + (r + 0.5 * v * v) * T) / (v * Math.sqrt(T));
  const d2 = d1 - v * Math.sqrt(T);

  // Cumulative distribution N(d1), N(d2)
  const Nd1 = normCDF(d1);
  const Nd2 = normCDF(d2);
  const N_minus_d1 = normCDF(-d1);
  const N_minus_d2 = normCDF(-d2);

  // Prices
  const callPrice = S * Nd1 - K * Math.exp(-r * T) * Nd2;
  const putPrice = K * Math.exp(-r * T) * N_minus_d2 - S * N_minus_d1;

  // Delta: Option price sensitivity to underlying price changes
  const callDelta = Nd1;
  const putDelta = Nd1 - 1;

  const pdf_d1 = normPDF(d1);

  // Theta: Option price sensitivity to time decay
  const term1 = -(S * pdf_d1 * v) / (2 * Math.sqrt(T));
  const term2_call = r * K * Math.exp(-r * T) * Nd2;
  const term2_put = r * K * Math.exp(-r * T) * N_minus_d2;

  const annualCallTheta = term1 - term2_call;
  const annualPutTheta = term1 + term2_put;

  // Gamma: Delta sensitivity to underlying price changes (Same for Call/Put)
  const gamma = pdf_d1 / (S * v * Math.sqrt(T));

  // Vega: Option price sensitivity to volatility changes (Same for Call/Put)
  // Usually returned as change per 1% change in vol (so divide by 100)
  const vega = (S * Math.sqrt(T) * pdf_d1) / 100;

  return { 
    callPrice, 
    putPrice, 
    callDelta, 
    putDelta, 
    callTheta: annualCallTheta / 365, // Daily decay
    putTheta: annualPutTheta / 365, 
    gamma,
    vega
  };
}

/**
 * Helper: Box-Muller transform to generate standard normal random variables
 */
function randomNormal() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Core 2: Geometric Brownian Motion (GBM) for next-day stock price
 * @param {number} currentPrice Current closing price
 * @param {number} r Drift / Risk-free rate
 * @param {number} v Volatility
 * @param {number} dt Time step (default 1/365 years)
 * @param {boolean} isEvent Flag for extreme events triggering high volatility
 * @returns {object} Next day OHLCV data
 */
export function generateNextDayPrice(currentPrice, r, v, dt = 1/365, isEvent = false) {
  // Increase volatility by 2.5-3x during shock events
  const shockV = isEvent ? v * 2.8 : v;
  
  // Normal random variable Z
  const Z = randomNormal();
  
  // GBM Formula for close: S_t = S_0 * exp((r - (v^2) / 2) * dt + v * sqrt(dt) * Z)
  const drift = (r - 0.5 * shockV * shockV) * dt;
  const shock = shockV * Math.sqrt(dt) * Z;
  
  const nextPrice = currentPrice * Math.exp(drift + shock);
  const close = Math.round(nextPrice * 100) / 100;

  // Simulate Open, High, Low
  const gapZ = randomNormal();
  const openRaw = currentPrice * Math.exp((r - 0.5 * v * v)* Math.pow(dt, 2) + v * Math.abs(Math.pow(dt, 2)) * gapZ);
  const open = Math.round(openRaw * 100) / 100;

  const maxPrice = Math.max(open, close);
  const minPrice = Math.min(open, close);
  const highRaw = maxPrice + Math.abs(randomNormal() * shockV * currentPrice * Math.sqrt(dt) * 0.5);
  const lowRaw = minPrice - Math.abs(randomNormal() * shockV * currentPrice * Math.sqrt(dt) * 0.5);
  
  const high = Math.round(highRaw * 100) / 100;
  const low = Math.max(0.01, Math.round(lowRaw * 100) / 100);

  // Simulate Volume
  const baseVolume = 1000000;
  const volMult = isEvent ? (3 + Math.random() * 5) : (0.5 + Math.random() * 1.5);
  const volume = Math.floor(baseVolume * volMult);
  
  return { open, high, low, close, volume };
}
