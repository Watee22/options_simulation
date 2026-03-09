// src/store/useTradingStore.js
import { create } from 'zustand';
import { CONFIG } from '../constants/config';

export const useTradingStore = create((set, get) => ({
  // History of runs in this session window
  historyRuns: [],

  // Time state
  currentDate: new Date(CONFIG.START_DATE),
  isExpired: false, // True when reached END_DATE

  // Market state
  currentStockPrice: CONFIG.INITIAL_STOCK_PRICE,
  riskFreeRate: CONFIG.RISK_FREE_RATE, // Dynamic store state for interest rate
  priceHistory: [
    { 
      date: new Date(CONFIG.START_DATE).toLocaleDateString(), 
      price: CONFIG.INITIAL_STOCK_PRICE,
      open: CONFIG.INITIAL_STOCK_PRICE,
      high: CONFIG.INITIAL_STOCK_PRICE,
      low: CONFIG.INITIAL_STOCK_PRICE,
      close: CONFIG.INITIAL_STOCK_PRICE,
      volume: 0
    }
  ],
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
    const endDate = new Date(CONFIG.END_DATE);
    const isExpired = nextDate >= endDate;
    
    // Ensure we don't go past end date
    if (nextDate > endDate) {
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

    if (isExpired) {
       // Auto settle at expiration
       let finalCash = state.cash;
       state.positions.options.forEach(opt => {
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
      priceHistory
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
    const { type, strike, quantity, price } = optionDetails; 
    // quantity > 0 means buy to open/cover, < 0 means sell to open/close
    // Options contract size is 100 multiplier
    const cost = quantity * price * 100;

    if (quantity > 0 && state.cash < cost) {
      alert('现金不足，无法进行期权交易。');
      return state;
    }
    
    // For selling options, simple margin check
    if (quantity < 0 && state.cash < Math.abs(cost)) {
      alert('保证金不足，无法卖出期权。');
      return state;
    }

    const newOptions = [...state.positions.options];
    const existingIndex = newOptions.findIndex(o => o.type === type && o.strike === strike);

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
        id: `${type}-${strike}`,
        type,
        strike,
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

    return {
      historyRuns: newHistory,
      currentDate: new Date(CONFIG.START_DATE),
      isExpired: false,
      currentStockPrice: CONFIG.INITIAL_STOCK_PRICE,
      priceHistory: [
        { 
          date: new Date(CONFIG.START_DATE).toLocaleDateString(), 
          price: CONFIG.INITIAL_STOCK_PRICE,
          open: CONFIG.INITIAL_STOCK_PRICE,
          high: CONFIG.INITIAL_STOCK_PRICE,
          low: CONFIG.INITIAL_STOCK_PRICE,
          close: CONFIG.INITIAL_STOCK_PRICE,
          volume: 0,
          event: null
        }
      ],
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
