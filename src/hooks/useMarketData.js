import { useCallback } from 'react';
import { useTradingStore } from '../store/useTradingStore';
import { CONFIG } from '../constants/config';
import { generateNextDayPrice, generateBridgeNextDayPrice, random } from '../utils/mathUtils';
import { MACRO_EVENTS, getDateStringMD, getUpcomingEventVolatilityImpact } from '../constants/eventsConfig';

export function useMarketData() {
  // The simulation reads the freshest state via getState(), so
  // simulateNextDay can be called several times in a row (jump-to-event)
  // without stale closures.
  const advanceDay = useTradingStore(state => state.advanceDay);
  const updateRiskFreeRate = useTradingStore(state => state.updateRiskFreeRate);
  const tagEventToCurrentDate = useTradingStore(state => state.tagEventToCurrentDate);
  const setShockState = useTradingStore(state => state.setShockState);
  const decrementShockState = useTradingStore(state => state.decrementShockState);

  const simulateNextDay = useCallback(() => {
    const s = useTradingStore.getState();
    if (s.isExpired) return null;

    const nextDate = new Date(s.currentDate);
    nextDate.setDate(nextDate.getDate() + 1);
    const mdDateStr = getDateStringMD(nextDate);

    let isRandomShock = random() < 0.10;
    let r = s.riskFreeRate;
    let v = s.volatility;
    let eventMessage = null;
    let priceJumpMultiplier = 1.0;

    // Fixed Macro Event on the NEXT day
    const macroEvent = MACRO_EVENTS[mdDateStr];

    if (macroEvent) {
      const resultObj = macroEvent.results[Math.floor(random() * macroEvent.results.length)];
      eventMessage = `【${macroEvent.name}】 ${resultObj.desc}`;

      // Gap up/down, volatility crush, rate change, multi-day IV shock
      priceJumpMultiplier = resultObj.priceObj.jump;
      v = Math.max(0.1, v - resultObj.volCrush);
      if (resultObj.rateChange) {
         r += resultObj.rateChange;
         updateRiskFreeRate(r);
      }
      if (macroEvent.isMultiDayShock) {
         setShockState(2, 5); // 2 days of expansion, then 5 days of crush
         v = Math.min(1.5, v + 0.40);
      }
    } else {
      // Normal day or ongoing multi-day event logic
      if (s.activeShockDelay > 0) {
        v = Math.min(1.5, v + 0.15);
        isRandomShock = true;
        decrementShockState();
      } else if (s.activeCrushDelay > 0) {
        v = Math.max(0.15, v - 0.10);
        decrementShockState();
      } else {
        // Pre-event volatility expansion (up to 3 days out)
        const upcomingImpact = getUpcomingEventVolatilityImpact(nextDate);
        if (upcomingImpact > 0) {
          // Visible IV ramp before macro events (e.g. ~+10% IV on the day
          // before earnings, tapering off 3 days out).
          v = Math.min(1.2, v + upcomingImpact * 0.4);
        } else {
          const volChange = (random() - 0.5) * 0.05;
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
        s.currentStockPrice,
        CONFIG.ANCHOR_PRICE,
        daysRemainingToAnchor,
        r,
        v,
        1 / 365,
        isRandomShock
      );
    } else {
      ohlc = generateNextDayPrice(
        s.currentStockPrice,
        r,
        v,
        1 / 365,
        isRandomShock
      );
    }

    // Apply the macro event gap to the generated OHLC
    ohlc.open = Math.round(ohlc.open * priceJumpMultiplier * 100) / 100;
    ohlc.high = Math.round(ohlc.high * priceJumpMultiplier * 100) / 100;
    ohlc.low = Math.round(ohlc.low * priceJumpMultiplier * 100) / 100;
    ohlc.close = Math.round(ohlc.close * priceJumpMultiplier * 100) / 100;

    advanceDay(ohlc, v);

    if (macroEvent) {
       tagEventToCurrentDate(macroEvent.name, macroEvent.color);
       return { type: 'MACRO', message: eventMessage };
    }

    if (isRandomShock) {
       return { type: 'SHOCK', message: '突发事件！市场剧烈波动！' };
    }

    return null;
  }, [advanceDay, updateRiskFreeRate, tagEventToCurrentDate, setShockState, decrementShockState]);

  return {
    simulateNextDay,
  };
}