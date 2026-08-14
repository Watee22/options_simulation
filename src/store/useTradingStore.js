// src/store/useTradingStore.js
import { create } from 'zustand';
import { CONFIG } from '../constants/config';
import { generateHistoricalData, setRandomSeed } from '../utils/mathUtils';
import {
  OPTION_MULTIPLIER,
  STOCK_TICKET_FEE,
  OPTION_CONTRACT_FEE,
  calculateReservedCash,
  calculateStockPositionAfterTrade,
  getOptionIntrinsicValue,
  roundMoney,
} from '../utils/tradingUtils';

const PAST_DAYS_TO_GENERATE = 30;
const MAX_TRANSACTION_LOG = 40;

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

function buildInitialSeed() {
  return Math.floor(Math.random() * 0xFFFFFFFF);
}

// Seed the market path so the same seed always regenerates the same history.
const initialSeed = buildInitialSeed();
setRandomSeed(initialSeed);
const initialHistory = buildInitialHistory();
const initialStockPrice = initialHistory[initialHistory.length - 1].close;

function buildInitialPositions() {
  return {
    stock: 0,
    stockAveragePrice: 0,
    options: []
  };
}

function appendTransaction(transactions, currentDate, entry) {
  return [
    {
      id: `${currentDate.toISOString()}-${transactions.length}-${entry.type}`,
      date: currentDate.toLocaleDateString('zh-CN'),
      ...entry
    },
    ...transactions
  ].slice(0, MAX_TRANSACTION_LOG);
}

function applyOptionTrade(options, optionDetails) {
  const { type, strike, quantity, price, expiration } = optionDetails;
  const newOptions = [...options];
  const existingIndex = newOptions.findIndex(o => o.type === type && o.strike === strike && o.expiration === expiration);
  let realizedPnl = 0;

  if (existingIndex >= 0) {
    const existing = newOptions[existingIndex];
    const newQuantity = existing.quantity + quantity;

    if (Math.sign(existing.quantity) !== Math.sign(quantity)) {
      const closedContracts = Math.min(Math.abs(existing.quantity), Math.abs(quantity));
      realizedPnl = closedContracts * (price - existing.averagePrice) * OPTION_MULTIPLIER * Math.sign(existing.quantity);
    }

    if (newQuantity === 0) {
      newOptions.splice(existingIndex, 1);
    } else {
      let newAvgPrice = existing.averagePrice;
      if (Math.sign(existing.quantity) === Math.sign(quantity)) {
        newAvgPrice = (
          (Math.abs(existing.quantity) * existing.averagePrice) +
          (Math.abs(quantity) * price)
        ) / Math.abs(newQuantity);
      } else if (Math.sign(newQuantity) !== Math.sign(existing.quantity)) {
        newAvgPrice = price;
      }

      newOptions[existingIndex] = {
        ...existing,
        quantity: newQuantity,
        averagePrice: roundMoney(newAvgPrice)
      };
    }
  } else {
    newOptions.push({
      id: `${type}-${strike}-${expiration}`,
      type,
      strike,
      expiration,
      quantity,
      averagePrice: price
    });
  }

  return { options: newOptions, realizedPnl: roundMoney(realizedPnl) };
}

function applyPhysicalStockSettlement({ stock, stockAveragePrice, cash, tradeQuantity, cashPrice, effectivePrice }) {
  const stockResult = calculateStockPositionAfterTrade(stock, stockAveragePrice, tradeQuantity, effectivePrice);
  return {
    cash: roundMoney(cash - tradeQuantity * cashPrice),
    stock: stockResult.quantity,
    stockAveragePrice: stockResult.averagePrice,
    realizedPnl: stockResult.realizedPnl,
  };
}

function toDateOnly(date) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

function settleExpiredOptions(state, nextDate, nextClose, forceAll = false) {
  let cash = state.cash;
  let stock = state.positions.stock;
  let stockAveragePrice = state.positions.stockAveragePrice;
  let realizedPnl = state.realizedPnl;
  let transactionLog = state.transactionLog;
  const activeOptions = [];
  const previousDay = toDateOnly(state.currentDate);
  const nextDay = toDateOnly(nextDate);

  state.positions.options.forEach((option) => {
    const expirationDay = toDateOnly(option.expiration);
    const isExpired = forceAll || expirationDay <= nextDay;

    if (!isExpired) {
      activeOptions.push(option);
      return;
    }

    const settlementPrice = expirationDay <= previousDay ? state.currentStockPrice : nextClose;
    const contracts = Math.abs(option.quantity);
    const shares = contracts * OPTION_MULTIPLIER;
    const intrinsicValue = getOptionIntrinsicValue(option.type, settlementPrice, option.strike);
    const isLong = option.quantity > 0;
    const optionName = `${option.type === 'CALL' ? '认购' : '认沽'} ${option.strike}`;

    if (intrinsicValue <= 0) {
      const optionPnl = (isLong ? -option.averagePrice : option.averagePrice) * shares;
      realizedPnl = roundMoney(realizedPnl + optionPnl);
      transactionLog = appendTransaction(transactionLog, nextDate, {
        type: 'EXPIRATION',
        action: '到期作废',
        symbol: optionName,
        quantity: option.quantity,
        price: 0,
        fees: 0,
        realizedPnl: roundMoney(optionPnl),
        note: '虚值期权到期归零'
      });
      return;
    }


    const tradeQuantity = option.type === 'CALL'
      ? (isLong ? shares : -shares)
      : (isLong ? -shares : shares);
    const effectivePrice = option.type === 'CALL'
      ? option.strike + option.averagePrice
      : option.strike - option.averagePrice;
    const result = applyPhysicalStockSettlement({
      stock,
      stockAveragePrice,
      cash,
      tradeQuantity,
      cashPrice: option.strike,
      effectivePrice,
    });

    cash = result.cash;
    stock = result.stock;
    stockAveragePrice = result.stockAveragePrice;
    realizedPnl = roundMoney(realizedPnl + result.realizedPnl);

    let settlementNote = '按行权价交割股票，期权成本已计入有效股票价格';
    if (isLong && option.type === 'CALL' && cash < 0) {
      settlementNote = '现金不足仍按行权价交割，行权后现金为负，触发追保（需卖出持仓补足）';
    } else if (isLong && option.type === 'PUT' && stock < 0) {
      settlementNote = '行权交付股票：持仓不足，已自动借券卖空，占用保证金';
    }

    transactionLog = appendTransaction(transactionLog, nextDate, {
      type: isLong ? 'EXERCISE' : 'ASSIGNMENT',
      action: isLong ? '到期行权' : '到期指派',
      symbol: optionName,
      quantity: tradeQuantity,
      price: option.strike,
      fees: 0,
      realizedPnl: result.realizedPnl,
      note: settlementNote
    });
  });

  return {
    cash,
    realizedPnl,
    transactionLog,
    positions: {
      ...state.positions,
      stock,
      stockAveragePrice,
      options: activeOptions
    }
  };
}

export const useTradingStore = create((set) => ({
  // History of runs in this session window
  historyRuns: [],

  // Time state
  currentDate: new Date(CONFIG.START_DATE),
  isExpired: false, // True when reached END_DATE

  // Market state
  simulationSeed: initialSeed, // seed driving the current market path
  currentStockPrice: initialStockPrice,
  riskFreeRate: CONFIG.RISK_FREE_RATE, // Dynamic store state for interest rate
  priceHistory: initialHistory,
  volatility: CONFIG.INITIAL_VOLATILITY,
  
  // Multi-day Shock state
  activeShockDelay: 0, // Days remaining in Phase A (Expansion) 
  activeCrushDelay: 0, // Days remaining in Phase B (Contraction)
  
  // Portfolio state
  cash: CONFIG.INITIAL_CASH,
  realizedPnl: 0,
  transactionLog: [],
  positions: buildInitialPositions(),
  isMarginCall: false, // True when cash can no longer cover margin requirements
  
  // Settings
  hintMode: false,
  
  // Actions
  toggleHintMode: () => set((state) => ({ hintMode: !state.hintMode })),
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

    const settledState = settleExpiredOptions(state, nextDate, ohlc.close, isExpired);

    if (isExpired) {
       let finalCash = settledState.cash;
       let finalRealizedPnl = settledState.realizedPnl;
       let finalTransactionLog = settledState.transactionLog;

       if (settledState.positions.stock !== 0) {
         const closingQuantity = -settledState.positions.stock;
         const stockResult = calculateStockPositionAfterTrade(
           settledState.positions.stock,
           settledState.positions.stockAveragePrice,
           closingQuantity,
           ohlc.close
         );
         finalCash = roundMoney(finalCash - closingQuantity * ohlc.close - STOCK_TICKET_FEE);
         finalRealizedPnl = roundMoney(finalRealizedPnl + stockResult.realizedPnl - STOCK_TICKET_FEE);
         finalTransactionLog = appendTransaction(finalTransactionLog, nextDate, {
           type: 'STOCK',
           action: '模拟结束平仓',
           symbol: CONFIG.STOCK_SYMBOL,
           quantity: closingQuantity,
           price: ohlc.close,
           fees: STOCK_TICKET_FEE,
           realizedPnl: roundMoney(stockResult.realizedPnl - STOCK_TICKET_FEE),
           note: '模拟到期自动清算正股'
         });
       }

       return {
          currentDate: nextDate,
          isExpired,
          currentStockPrice: ohlc.close,
          volatility: newVolatility !== undefined ? newVolatility : state.volatility,
          priceHistory,
          cash: finalCash,
          realizedPnl: finalRealizedPnl,
          transactionLog: finalTransactionLog,
          positions: buildInitialPositions(),
          isMarginCall: finalCash < 0
       };
    }

    const ivAfter = newVolatility !== undefined ? newVolatility : state.volatility;

    // Refresh each surviving position's valuation snapshot to the inputs of
    // the day that just ended, so the portfolio can attribute the next
    // period's PnL to price / time / volatility changes.
    const markBefore = { spot: state.currentStockPrice, iv: state.volatility, date: state.currentDate };
    const markedPositions = {
      ...settledState.positions,
      options: settledState.positions.options.map(o => ({ ...o, lastMark: markBefore }))
    };

    return {
      currentDate: nextDate,
      isExpired,
      currentStockPrice: ohlc.close,
      volatility: ivAfter,
      riskFreeRate: state.riskFreeRate, // Defaults to existing
      priceHistory,
      cash: settledState.cash,
      realizedPnl: settledState.realizedPnl,
      transactionLog: settledState.transactionLog,
      positions: markedPositions,
      isMarginCall: settledState.cash < calculateReservedCash(markedPositions, ohlc.close)
    };
  }),

  // Trading actions
  tradeStock: (quantity, price) => {
    let outcome = null;
    set((state) => {
      const cashAfterTrade = roundMoney(state.cash - quantity * price - STOCK_TICKET_FEE);
      const stockResult = calculateStockPositionAfterTrade(
        state.positions.stock,
        state.positions.stockAveragePrice,
        quantity,
        price
      );
      const nextPositions = {
        ...state.positions,
        stock: stockResult.quantity,
        stockAveragePrice: stockResult.averagePrice
      };
      const reservedCash = calculateReservedCash(nextPositions, price);

      // While in a margin call, only trades that reduce the position are allowed
      const isReducingStock = Math.abs(stockResult.quantity) < Math.abs(state.positions.stock);
      if (state.isMarginCall && !isReducingStock) {
        outcome = { ok: false, message: '追保中：仅允许减仓或平仓交易。请先卖出部分持仓或平仓期权，恢复偿付能力后再开仓。' };
        return state;
      }

      if (cashAfterTrade < reservedCash) {
        outcome = {
          ok: false,
          message: `可用资金不足：成交后现金 ${cashAfterTrade.toFixed(2)}，保证金占用 ${reservedCash.toFixed(2)}（差额 ${roundMoney(reservedCash - cashAfterTrade).toFixed(2)}）。备选：① 减少数量 ② 先卖出部分持仓释放保证金。`
        };
        return state;
      }

      const realizedTradePnl = roundMoney(stockResult.realizedPnl - STOCK_TICKET_FEE);

      outcome = {
        ok: true,
        summary: {
          type: 'STOCK',
          action: quantity > 0 ? '买入' : '卖出',
          symbol: CONFIG.STOCK_SYMBOL,
          quantity,
          price,
          fees: STOCK_TICKET_FEE,
          cashAfter: cashAfterTrade,
        },
      };

      return {
        cash: cashAfterTrade,
        realizedPnl: roundMoney(state.realizedPnl + realizedTradePnl),
        transactionLog: appendTransaction(state.transactionLog, state.currentDate, {
          type: 'STOCK',
          action: quantity > 0 ? '买入股票' : '卖出股票',
          symbol: CONFIG.STOCK_SYMBOL,
          quantity,
          price,
          fees: STOCK_TICKET_FEE,
          realizedPnl: realizedTradePnl,
          note: stockResult.realizedPnl !== 0 ? '平仓部分已计入已实现盈亏' : '调整正股持仓'
        }),
        positions: nextPositions,
        isMarginCall: cashAfterTrade < reservedCash
      };
    });
    return outcome;
  },

  tradeOption: (optionDetails) => {
    let outcome = null;
    set((state) => {
      const { type, strike, quantity, price } = optionDetails; 
      // quantity > 0 means buy to open/cover, < 0 means sell to open/close
      // Options contract size is 100 multiplier
      const premiumCashFlow = quantity * price * OPTION_MULTIPLIER;
      const fees = Math.abs(quantity) * OPTION_CONTRACT_FEE;
      const cashAfterTrade = roundMoney(state.cash - premiumCashFlow - fees);
      const optionResult = applyOptionTrade(state.positions.options, optionDetails);
      // Snapshot the valuation inputs now: the PnL attribution shown after the
      // next day-advance will measure from this moment on.
      const markNow = { spot: state.currentStockPrice, iv: state.volatility, date: state.currentDate };
      const markedOptions = optionResult.options.map(o =>
        o.type === type && o.strike === strike && o.expiration === optionDetails.expiration
          ? { ...o, lastMark: markNow }
          : o
      );
      const nextPositions = {
        ...state.positions,
        options: markedOptions
      };
      const reservedCash = calculateReservedCash(nextPositions, state.currentStockPrice);

      // While in a margin call, only trades that reduce the position are allowed
      const prevQty = state.positions.options.find(
        o => o.type === type && o.strike === strike && o.expiration === optionDetails.expiration
      )?.quantity || 0;
      const nextQty = optionResult.options.find(
        o => o.type === type && o.strike === strike && o.expiration === optionDetails.expiration
      )?.quantity || 0;
      const isReducingOption = Math.abs(nextQty) < Math.abs(prevQty);
      if (state.isMarginCall && !isReducingOption) {
        outcome = { ok: false, message: '追保中：仅允许减仓或平仓交易。请先平掉部分期权仓位，恢复偿付能力后再开仓。' };
        return state;
      }

      if (cashAfterTrade < reservedCash) {
        outcome = {
          ok: false,
          message: `保证金不足：成交后现金 ${cashAfterTrade.toFixed(2)}，保证金占用 ${reservedCash.toFixed(2)}（差额 ${roundMoney(reservedCash - cashAfterTrade).toFixed(2)}）。备选：① 减少张数 ② 平掉部分空头仓位 ③ 若卖出认沽，可买入低行权价认沽构建价差以降低保证金。`
        };
        return state;
      }

      const realizedTradePnl = roundMoney(optionResult.realizedPnl - fees);

      outcome = {
        ok: true,
        summary: {
          type: 'OPTION',
          optionType: type,
          strike,
          action: quantity > 0 ? '买入' : '卖出',
          quantity,
          price,
          fees: roundMoney(fees),
          cashAfter: cashAfterTrade,
        },
      };

      return {
        cash: cashAfterTrade,
        realizedPnl: roundMoney(state.realizedPnl + realizedTradePnl),
        transactionLog: appendTransaction(state.transactionLog, state.currentDate, {
          type: 'OPTION',
          action: quantity > 0 ? '买入期权' : '卖出期权',
          symbol: `${type === 'CALL' ? '认购' : '认沽'} ${strike}`,
          quantity,
          price,
          fees: roundMoney(fees),
          realizedPnl: realizedTradePnl,
          note: optionResult.realizedPnl !== 0 ? '平仓部分已计入已实现盈亏' : '调整期权持仓'
        }),
        positions: nextPositions,
        isMarginCall: cashAfterTrade < reservedCash
      };
    });
    return outcome;
  },

  // Exercise an option manually
  exerciseOption: (optionId) => {
    let outcome = null;
    set((state) => {
      const optionIndex = state.positions.options.findIndex(o => o.id === optionId);
      if (optionIndex === -1) {
        outcome = { ok: false, message: '未找到该期权持仓。' };
        return state;
      }

      const opt = state.positions.options[optionIndex];
      if (opt.quantity <= 0) {
        outcome = { ok: false, message: '只能对买方期权（持有数量大于0）行使权利。卖出期权的一方只有被指派的义务，没有行权的权利。' };
        return state;
      }

      if (state.isMarginCall) {
        outcome = { ok: false, message: '追保中：仅允许减仓或平仓交易，暂不能提前行权开仓。可先卖出期权平仓。' };
        return state;
      }

      const { type, strike, quantity, averagePrice } = opt;
      // 1 option contract = 100 shares
      const positionSize = quantity * OPTION_MULTIPLIER;

      const newOptions = [...state.positions.options];
      newOptions.splice(optionIndex, 1); // remove the exercised option
      const tradeQuantity = type === 'CALL' ? positionSize : -positionSize;
      const effectivePrice = type === 'CALL' ? strike + averagePrice : strike - averagePrice;
      const result = applyPhysicalStockSettlement({
        stock: state.positions.stock,
        stockAveragePrice: state.positions.stockAveragePrice,
        cash: state.cash,
        tradeQuantity,
        cashPrice: strike,
        effectivePrice,
      });
      const nextPositions = {
        ...state.positions,
        stock: result.stock,
        stockAveragePrice: result.stockAveragePrice,
        options: newOptions
      };
      const reservedCash = calculateReservedCash(nextPositions, state.currentStockPrice);

      if (result.cash < reservedCash) {
        outcome = { ok: false, message: `行权后保证金不足：现金 ${result.cash.toFixed(2)}，保证金占用 ${reservedCash.toFixed(2)}。备选：先卖出部分持仓，或改为卖出期权平仓。` };
        return state;
      }

      outcome = { ok: true };
      return {
        cash: result.cash,
        realizedPnl: roundMoney(state.realizedPnl + result.realizedPnl),
        transactionLog: appendTransaction(state.transactionLog, state.currentDate, {
          type: 'EXERCISE',
        action: '提前行权',
        symbol: `${type === 'CALL' ? '认购' : '认沽'} ${strike}`,
        quantity: tradeQuantity,
        price: strike,
        fees: 0,
        realizedPnl: result.realizedPnl,
        note: '期权成本已计入有效股票价格'
      }),
        positions: nextPositions,
        isMarginCall: result.cash < reservedCash
      };
    });
    return outcome;
  },

  // trading handlers
  // replaySamePath = true re-seeds the RNG with the current run's seed so
  // the exact same market path (pre-warm history, events, shocks) replays.
  resetSimulation: (replaySamePath = false) => set((state) => {
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

    const nextSeed = replaySamePath ? state.simulationSeed : buildInitialSeed();
    setRandomSeed(nextSeed);
    const refreshedHistory = buildInitialHistory();
    const refreshedPrice = refreshedHistory[refreshedHistory.length - 1].close;

    const newHistory = [...state.historyRuns, {
      date: new Date().toLocaleString(),
      finalValue: runValue,
      profit: runValue - CONFIG.INITIAL_CASH,
      realizedPnl: state.realizedPnl,
      seed: state.simulationSeed
    }];

    return {
      historyRuns: newHistory,
      simulationSeed: nextSeed,
      currentDate: new Date(CONFIG.START_DATE),
      isExpired: false,
      currentStockPrice: refreshedPrice,
      priceHistory: refreshedHistory,
      volatility: CONFIG.INITIAL_VOLATILITY,
      activeShockDelay: 0,
      activeCrushDelay: 0,
      riskFreeRate: CONFIG.RISK_FREE_RATE,
      cash: CONFIG.INITIAL_CASH,
      realizedPnl: 0,
      transactionLog: [],
      positions: buildInitialPositions(),
      isMarginCall: false
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
