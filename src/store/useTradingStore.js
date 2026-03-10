// src/store/useTradingStore.js
import { create } from 'zustand';
import { CONFIG } from '../constants/config';
import { generateHistoricalData } from '../utils/mathUtils';

const PAST_DAYS_TO_GENERATE = 30;

// Helper to init history
function buildInitialHistory() {
  const pastDate = new Date(CONFIG.START_DATE);
  pastDate.setDate(pastDate.getDate() - PAST_DAYS_TO_GENERATE);
  return generateHistoricalData(
    pastDate, 
    PAST_DAYS_TO_GENERATE, 
    CONFIG.INITIAL_STOCK_PRICE * 0.95, // Start a bit lower 30 days ago for some variance
    CONFIG.RISK_FREE_RATE, 
    CONFIG.INITIAL_VOLATILITY
  );
}

const initialHistory = buildInitialHistory();
const initialStockPrice = initialHistory[initialHistory.length - 1].close;

export const useTradingStore = create((set, get) => ({
  // History of runs in this session window
  historyRuns: [],

  // Time state
  currentDate: new Date(CONFIG.START_DATE),
  isExpired: false, // True when reached END_DATE

  // Market state
  currentStockPrice: initialStockPrice,
  riskFreeRate: CONFIG.RISK_FREE_RATE, // Dynamic store state for interest rate
  priceHistory: initialHistory,
  volatility: CONFIG.INITIAL_VOLATILITY,
  
  // Multi-day Shock state
  activeShockDelay: 0, // Days remaining in Phase A (Expansion) 
  activeCrushDelay: 0, // Days remaining in Phase B (Contraction)
  
  // Portfolio state
  cash: CONFIG.INITIAL_CASH,
  positions: {
    stock: 0, // Number of shares (positive for long, negative for short)
    options: [] // Array of option position objects: { id, type (CALL/PUT), strike, quantity, averagePrice }
  },
  
  // Actions
  advanceDay: (ohlc, newVolatility) => set((state) => {
    const nextDate = new Date(state.currentDate);
    nextDate.setDate(nextDate.getDate() + 1);
    const END_DATE_OBJ = new Date(CONFIG.END_DATE);
    const isExpired = nextDate >= END_DATE_OBJ;
    // Advanced Day Settlement check (only when nextDate crosses END_DATE, or later for weekly options)
    // For now we'll handle the overall simulation expiration the same way, but options chain expiration will be handled separately.
    if (nextDate > END_DATE_OBJ) {
      return state;
    }

    const priceHistory = [
      ...state.priceHistory,
      { 
        date: nextDate.toLocaleDateString(), 
        price: ohlc.close,
        open: ohlc.open,
        high: ohlc.high,
        low: ohlc.low,
        close: ohlc.close,
        volume: ohlc.volume
      }
    ];

    let currentOptions = [...state.positions.options];
    let dailyFinalCash = state.cash;

    // Process individual option expirations
    const activeOptions = [];
    currentOptions.forEach(opt => {
      // Re-parse the option expiration
      const optExpDate = new Date(opt.expiration);
      
      if (nextDate > optExpDate) {
         // Option expired naturally today or yesterday
         let intrinsicValue = 0;
         if (opt.type === 'CALL') {
           intrinsicValue = Math.max(0, ohlc.close - opt.strike);
         } else {
           intrinsicValue = Math.max(0, opt.strike - ohlc.close);
         }
         // Assignment / Settlement Cash impact
         dailyFinalCash += intrinsicValue * opt.quantity * 100;
      } else {
         activeOptions.push(opt);
      }
    });

    if (isExpired) {
       // Auto settle EVERYTHING remaining at simulation end
       let finalCash = dailyFinalCash;
       activeOptions.forEach(opt => {
         let intrinsicValue = 0;
         if (opt.type === 'CALL') {
           intrinsicValue = Math.max(0, ohlc.close - opt.strike);
         } else {
           intrinsicValue = Math.max(0, opt.strike - ohlc.close);
         }
         finalCash += intrinsicValue * opt.quantity * 100;
       });

       finalCash += state.positions.stock * ohlc.close;

       return {
          currentDate: nextDate,
          isExpired,
          currentStockPrice: ohlc.close,
          volatility: newVolatility !== undefined ? newVolatility : state.volatility,
          priceHistory,
          cash: finalCash,
          positions: { stock: 0, options: [] }
       };
    }

    return {
      currentDate: nextDate,
      isExpired,
      currentStockPrice: ohlc.close,
      volatility: newVolatility !== undefined ? newVolatility : state.volatility,
      riskFreeRate: state.riskFreeRate, // Defaults to existing
      priceHistory,
      cash: dailyFinalCash,
      positions: {
         ...state.positions,
         options: activeOptions
      }
    };
  }),

  // Trading actions
  tradeStock: (quantity, price) => set((state) => {
    const cost = quantity * price;
    // Check if enough cash for buying
    if (quantity > 0 && state.cash < cost) {
      alert('Not enough cash to buy stock.');
      return state;
    }
    // Simple margin check for shorting: require cash >= sort value
    if (quantity < 0 && state.cash < Math.abs(cost)) {
      alert('Not enough margin to short stock.');
      return state;
    }

    return {
      cash: state.cash - cost,
      positions: {
        ...state.positions,
        stock: state.positions.stock + quantity
      }
    };
  }),

  tradeOption: (optionDetails) => set((state) => {
    const { type, strike, quantity, price, expiration } = optionDetails; 
    // quantity > 0 means buy to open/cover, < 0 means sell to open/close
    // Options contract size is 100 multiplier
    const cost = quantity * price * 100;

    const newOptions = [...state.positions.options];
    const existingIndex = newOptions.findIndex(o => o.type === type && o.strike === strike && o.expiration === expiration);
    
    // Margin Check Logic
    if (quantity > 0 && state.cash < cost) {
      alert('现金不足，无法进行期权交易。');
      return state;
    }

    if (quantity < 0) {
      // Selling options. Are we selling to close (we have a long position) or selling to open (naked short)?
      let isSellToOpen = true;
      if (existingIndex >= 0) {
        const existingQty = newOptions[existingIndex].quantity;
        if (existingQty > 0) {
          isSellToOpen = false; // We are closing an existing long position
          // Technically, if they sell MORE than they have long, the excess is "Sell to Open", but we'll keep it simple:
          // If selling to close, margin is not required.
        }
      }

      if (isSellToOpen && state.cash < Math.abs(cost)) {
        alert('保证金不足，无法卖出期权开仓。');
        return state;
      }
    }

    if (existingIndex >= 0) {
      const existing = newOptions[existingIndex];
      const newQuantity = existing.quantity + quantity;
      
      if (newQuantity === 0) {
        // Position closed
        newOptions.splice(existingIndex, 1);
      } else {
        // Average price calculation (simplified)
        let newAvgPrice = existing.averagePrice;
        if ((existing.quantity > 0 && quantity > 0) || (existing.quantity < 0 && quantity < 0)) {
           // Adding to position
           newAvgPrice = (existing.averagePrice * existing.quantity + price * quantity) / newQuantity;
        }
        
        newOptions[existingIndex] = {
          ...existing,
          quantity: newQuantity,
          averagePrice: newAvgPrice
        };
      }
    } else {
      // New position
      newOptions.push({
        id: `${type}-${strike}-${expiration}`,
        type,
        strike,
        expiration,
        quantity,
        averagePrice: price // Average price remains per-share price for display and PnL calc
      });
    }

    return {
      cash: state.cash - cost,
      positions: {
        ...state.positions,
        options: newOptions
      }
    };
  }),

  // trading handlers
  resetSimulation: () => set((state) => {
    // Save current attempt to history
    const finalNetLiq = state.cash + (state.positions.stock * state.currentStockPrice) + 
      // Simplified: intrinsic of options. If expired, it's already in cash. 
      // If reset mid-way, just taking cash + stock for simplified history logic
      0; 

    // We'll calculate a crude "final portfolio value" to save in history
    let optionsValue = 0;
    state.positions.options.forEach(opt => {
         let currentOptPrice = 0;
         if (opt.type === 'CALL') {
           currentOptPrice = Math.max(0, state.currentStockPrice - opt.strike);
         } else {
           currentOptPrice = Math.max(0, opt.strike - state.currentStockPrice);
         }
         optionsValue += currentOptPrice * opt.quantity * 100;
    });

    const runValue = state.cash + (state.positions.stock * state.currentStockPrice) + optionsValue;

    const newHistory = [...state.historyRuns, {
      date: new Date().toLocaleString(),
      finalValue: runValue,
      profit: runValue - CONFIG.INITIAL_CASH
    }];

    const refreshedHistory = buildInitialHistory();
    const refreshedPrice = refreshedHistory[refreshedHistory.length - 1].close;

    return {
      historyRuns: newHistory,
      currentDate: new Date(CONFIG.START_DATE),
      isExpired: false,
      currentStockPrice: refreshedPrice,
      priceHistory: refreshedHistory,
      volatility: CONFIG.INITIAL_VOLATILITY,
      activeShockDelay: 0,
      activeCrushDelay: 0,
      riskFreeRate: CONFIG.RISK_FREE_RATE,
      cash: CONFIG.INITIAL_CASH,
      positions: {
        stock: 0,
        options: []
      }
    };
  }),

  // Expose explicit risk-free rate update
  updateRiskFreeRate: (newRate) => set({ riskFreeRate: newRate }),
  
  // Method to patch the last history record with an event marker
  tagEventToCurrentDate: (eventLabel, color) => set((state) => {
    if (state.priceHistory.length === 0) return state;
    const history = [...state.priceHistory];
    history[history.length - 1] = {
      ...history[history.length - 1],
      event: eventLabel,
      eventColor: color
    };
    return { priceHistory: history };
  }),

  // Manage Shock states
  setShockState: (shockDays, crushDays) => set({
     activeShockDelay: shockDays || 0,
     activeCrushDelay: crushDays || 0
  }),
  
  decrementShockState: () => set((state) => {
     if (state.activeShockDelay > 0) {
        return { activeShockDelay: state.activeShockDelay - 1 };
     } else if (state.activeCrushDelay > 0) {
        return { activeCrushDelay: state.activeCrushDelay - 1 };
     }
     return state;
  })
}));
