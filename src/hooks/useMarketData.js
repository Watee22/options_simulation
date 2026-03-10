import { useCallback } from 'react';
import { useTradingStore } from '../store/useTradingStore';
import { CONFIG } from '../constants/config';
import { generateNextDayPrice, generateBridgeNextDayPrice } from '../utils/mathUtils';
import { MACRO_EVENTS, getDateStringMD, getUpcomingEventVolatilityImpact } from '../constants/eventsConfig';

export function useMarketData() {
  const currentStockPrice = useTradingStore(state => state.currentStockPrice);
  const volatility = useTradingStore(state => state.volatility);
  const riskFreeRate = useTradingStore(state => state.riskFreeRate);
  const advanceDay = useTradingStore(state => state.advanceDay);
  const isExpired = useTradingStore(state => state.isExpired);
  const currentDate = useTradingStore(state => state.currentDate);
  const updateRiskFreeRate = useTradingStore(state => state.updateRiskFreeRate);
  const tagEventToCurrentDate = useTradingStore(state => state.tagEventToCurrentDate);
  
  // Multi-day state hooks
  const activeShockDelay = useTradingStore(state => state.activeShockDelay);
  const activeCrushDelay = useTradingStore(state => state.activeCrushDelay);
  const setShockState = useTradingStore(state => state.setShockState);
  const decrementShockState = useTradingStore(state => state.decrementShockState);

  const simulateNextDay = useCallback(() => {
    if (isExpired) return null; // Return null instead of just undefined

    const nextDate = new Date(currentDate);
    nextDate.setDate(nextDate.getDate() + 1);
    const mdDateStr = getDateStringMD(nextDate);
    
    let isRandomShock = Math.random() < 0.10;
    let r = riskFreeRate;
    let v = volatility;
    let eventMessage = null;
    let priceJumpMultiplier = 1.0;

    // Check for fixed Macro Event on the NEXT day
    const macroEvent = MACRO_EVENTS[mdDateStr];
    
    if (macroEvent) {
      // It's an event day!
      // 1. Pick a random result
      const resultObj = macroEvent.results[Math.floor(Math.random() * macroEvent.results.length)];
      eventMessage = `【${macroEvent.name}】 ${resultObj.desc}`;
      
      // 2. Apply Jump (Gap up/down)
      priceJumpMultiplier = resultObj.priceObj.jump;
      
      // 3. Volatility Crush
      v = Math.max(0.1, v - resultObj.volCrush);

      // 4. Rate change if applicable
      if (resultObj.rateChange) {
         r += resultObj.rateChange;
         updateRiskFreeRate(r);
      }

      // 5. Trigger multi-day IV shock if applicable
      // e.g. Geopolitical Conflict: Phase A (2 days expansion), Phase B (5 days contraction)
      if (macroEvent.isMultiDayShock) {
         setShockState(2, 5); // 2 days of shock, followed by 5 days of crush
         // Day 1 immediate spike
         v = Math.min(1.5, v + 0.40); 
      }
    } else {
      // Normal day or ongoing multi-day event logic
      if (activeShockDelay > 0) {
        // Phase A: Geopolitical fear is high, pump volatility
        v = Math.min(1.5, v + 0.15); // Add 15% IV each day of Phase A
        isRandomShock = true; // High chance of large swings
        decrementShockState();
      } else if (activeCrushDelay > 0) {
        // Phase B: Fear subsides, volatility steadily crushes
        v = Math.max(0.15, v - 0.10); // Minus 10% IV each day of Phase B
        decrementShockState();
      } else {
        // Regular Pre-event volatility expansion (up to 3 days out)
        const upcomingImpact = getUpcomingEventVolatilityImpact(nextDate);
        if (upcomingImpact > 0) {
          // Pump IV slightly leading up to the event
          v = Math.min(1.2, v + upcomingImpact * 0.05);
        } else {
          // Minor random IV drift
          const volChange = (Math.random() - 0.5) * 0.05;
          v = Math.max(0.1, Math.min(1.0, v + volChange));
        }
      }
    }

    // Generate price baseline
    const anchorDate = new Date(CONFIG.ANCHOR_DATE);
    const timeDiff = anchorDate.getTime() - nextDate.getTime();
    const daysRemainingToAnchor = Math.ceil(timeDiff / (1000 * 3600 * 24));
    
    let ohlc;
    if (daysRemainingToAnchor >= 0) {
      ohlc = generateBridgeNextDayPrice(
        currentStockPrice,
        CONFIG.ANCHOR_PRICE,
        daysRemainingToAnchor,
        r,
        v,
        1 / 365,
        isRandomShock
      );
    } else {
      ohlc = generateNextDayPrice(
        currentStockPrice,
        r,
        v,
        1 / 365, // dt
        isRandomShock
      );
    }

    // Apply the macro event jump to the generated OHLC
    // We multiply open, high, low, close by the gap multiplier
    ohlc.open = Math.round(ohlc.open * priceJumpMultiplier * 100) / 100;
    ohlc.high = Math.round(ohlc.high * priceJumpMultiplier * 100) / 100;
    ohlc.low = Math.round(ohlc.low * priceJumpMultiplier * 100) / 100;
    ohlc.close = Math.round(ohlc.close * priceJumpMultiplier * 100) / 100;

    // Advance the store state
    advanceDay(ohlc, v);
    
    if (macroEvent) {
       // Tag the chart right after advancing
       tagEventToCurrentDate(macroEvent.name, macroEvent.color);
       return { type: 'MACRO', message: eventMessage };
    }

    if (isRandomShock) {
       return { type: 'SHOCK', message: '突发事件！市场剧烈波动！' };
    }

    return null;
  }, [
    currentStockPrice, volatility, riskFreeRate, advanceDay, isExpired, 
    currentDate, updateRiskFreeRate, tagEventToCurrentDate, 
    activeShockDelay, activeCrushDelay, setShockState, decrementShockState
  ]);

  return {
    simulateNextDay,
  };
}
