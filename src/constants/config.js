// src/constants/config.js

export const CONFIG = {
  START_DATE: '2024-03-15',
  END_DATE: '2024-04-30',
  TOTAL_DAYS: 46, // From March 15 to April 30 inclusive
  INITIAL_CASH: 100000,
  
  // Market Data params
  STOCK_SYMBOL: 'TOCK',
  INITIAL_STOCK_PRICE: 100,
  RISK_FREE_RATE: 0.05,
  INITIAL_VOLATILITY: 0.30,
  
  // Options Chain params
  STRIKE_PRICE_MIN: 80,
  STRIKE_PRICE_MAX: 120,
  STRIKE_PRICE_STEP: 5,
};
