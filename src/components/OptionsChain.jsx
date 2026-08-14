import { useState, useMemo } from 'react';
import { useTradingStore } from '../store/useTradingStore';
import { CONFIG } from '../constants/config';
import { calculateBlackScholes } from '../utils/mathUtils';
import { formatCurrency, formatGreeks, calculateTimeInYears, getDaysToExpiration } from '../utils/formatters';
import { calculateOptionQuote } from '../utils/tradingUtils';
import { getTermVolatility } from '../utils/optionPricing';

export default function OptionsChain({ onTradeClick }) {
  const currentPrice = useTradingStore(state => state.currentStockPrice);
  const currentDate = useTradingStore(state => state.currentDate);
  const volatility = useTradingStore(state => state.volatility);
  const riskFreeRate = useTradingStore(state => state.riskFreeRate);
  
  // Calculate dynamic consecutive Friday expirations based on current date
  const expirations = useMemo(() => {
    const dates = [];
    const dateCursor = new Date(currentDate);
    // Find next Friday (0DTE if today is Friday)
    const dayOfWeek = dateCursor.getDay();
    const daysUntilFriday = (5 + 7 - dayOfWeek) % 7;
    dateCursor.setDate(dateCursor.getDate() + daysUntilFriday);
    
    // Add up to 3 weeks of expirations
    for (let i = 0; i < 3; i++) {
        const expDate = new Date(dateCursor);
        expDate.setDate(dateCursor.getDate() + (i * 7));
        dates.push(expDate);
    }

    // Add ultra-long term option (April 30th, end of simulation)
    const longTermExp = new Date(CONFIG.END_DATE);
    // Set time to 0 to avoid matching issues
    longTermExp.setHours(0,0,0,0);
    
    if (!dates.some(d => d.getTime() === longTermExp.getTime())) {
        dates.push(longTermExp);
    }

    // Filter out past ones and sort
    const validDates = dates.filter(d => {
        const d_day = new Date(d);
        d_day.setHours(0,0,0,0);
        const c_day = new Date(currentDate);
        c_day.setHours(0,0,0,0);
        return d_day >= c_day;
    });
    
    validDates.sort((a, b) => a - b);
    return validDates;
  }, [currentDate]);

  const [selectedExpiration, setSelectedExpiration] = useState(0);

  const selectedExpirationIndex = selectedExpiration < expirations.length ? selectedExpiration : 0;
  const activeExpirationDate = expirations[selectedExpirationIndex];
  
  // Generate strikes dynamically around current stock price
  const strikes = useMemo(() => {
    const list = [];
    const centerStrike = Math.floor(currentPrice / CONFIG.STRIKE_PRICE_STEP) * CONFIG.STRIKE_PRICE_STEP;
    // Show 10 strikes above and below
    for (let i = centerStrike - 10 * CONFIG.STRIKE_PRICE_STEP; i <= centerStrike + 10 * CONFIG.STRIKE_PRICE_STEP; i += CONFIG.STRIKE_PRICE_STEP) {
      if (i > 0) list.push(i);
    }
    return list;
  }, [currentPrice]);

  // Calculate pricing for all strikes
  const optionsData = useMemo(() => {
    if (!activeExpirationDate) return [];
    const T = calculateTimeInYears(currentDate, activeExpirationDate);
    
    // Term structure for implied volatility:
    // 1. Short-term options (Crush)
    // 2. Medium-term options (Event Volatility)
    // 3. Long-term options (Decay)
    // Term structure + strike skew IV, shared with Portfolio so positions
    // are always marked with the same inputs the options chain displays.

    return strikes.map(strike => {
      const termVolatility = getTermVolatility(T, volatility, currentPrice, strike);
      const data = calculateBlackScholes(
        currentPrice, 
        strike, 
        T, 
        riskFreeRate, 
        termVolatility
      );
      const daysToExpiration = getDaysToExpiration(currentDate, activeExpirationDate);
      return {
        strike,
        termVolatility,
        callQuote: calculateOptionQuote({
          theoreticalPrice: data.callPrice,
          strike,
          spotPrice: currentPrice,
          daysToExpiration,
          delta: data.callDelta,
          volatility: termVolatility,
        }),
        putQuote: calculateOptionQuote({
          theoreticalPrice: data.putPrice,
          strike,
          spotPrice: currentPrice,
          daysToExpiration,
          delta: data.putDelta,
          volatility: termVolatility,
        }),
        ...data
      };
    });
  }, [strikes, currentPrice, currentDate, volatility, riskFreeRate, activeExpirationDate]);

  // ATM term IV for the header (skew makes per-strike IV differ)
  const atmTermVol = optionsData.length > 0
    ? (optionsData.find(r => Math.abs(r.strike - currentPrice) <= CONFIG.STRIKE_PRICE_STEP / 2) || optionsData[0]).termVolatility
    : volatility;

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-lg overflow-hidden flex flex-col h-full">
      <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/80">
        <h2 className="text-xl font-bold text-white flex items-center gap-3">
          期权链 (T型报价)
          <select 
            value={selectedExpirationIndex}
            onChange={(e) => setSelectedExpiration(Number(e.target.value))}
            className="ml-2 bg-slate-900 border border-slate-600 text-sm font-medium text-white px-3 py-1.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {expirations.map((exp, idx) => {
              const daysToExpiry = Math.max(0, Math.ceil((exp.getTime() - currentDate.getTime()) / (1000 * 3600 * 24)));
              return (
                <option key={idx} value={idx}>
                  {exp.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} ({daysToExpiry} DTE)
                </option>
              )
            })}
          </select>
        </h2>
        <div className="flex items-center gap-4 text-sm font-medium">
          <span className="text-slate-400">隐含波动率: <span className="text-amber-400">{(volatility * 100).toFixed(1)}%</span></span>
          <span className="text-slate-400">到期波动率(ATM): <span className="text-rose-400">{(atmTermVol * 100).toFixed(1)}%</span></span>
        </div>
      </div>
      
      <div className="overflow-x-auto flex-1 h-[400px]">
        <table className="w-full whitespace-nowrap">
          <thead className="bg-slate-900 border-b border-slate-700 sticky top-0 z-10">
            <tr>
              <th colSpan="5" className="px-4 py-2 text-center text-emerald-400 font-semibold border-r border-slate-700">认购期权 (CALL)</th>
              <th className="px-4 py-2 text-center text-white font-bold bg-slate-800">行权价</th>
              <th colSpan="5" className="px-4 py-2 text-center text-rose-400 font-semibold border-l border-slate-700">认沽期权 (PUT)</th>
            </tr>
            <tr className="text-xs text-slate-400 uppercase tracking-wider bg-slate-800/50">
              <th title="Vega：隐含波动率每变动 1%，期权价值的变化量" className="px-3 py-2 font-medium cursor-help">Vega</th>
              <th title="Gamma：股价每变动 $1，Delta 的变化量（凸性）" className="px-3 py-2 font-medium cursor-help">Gamma</th>
              <th title="Theta：每流逝 1 天，期权价值的变化量（时间衰减，买方通常为负）" className="px-3 py-2 font-medium cursor-help">Theta</th>
              <th title="Delta：股价每变动 $1，期权价值的变化量；认购为正，认沽为负" className="px-3 py-2 font-medium cursor-help">Delta</th>
              <th title="Bid / Ask：买入按 Ask 成交，卖出按 Bid 成交；价差即交易成本" className="px-3 py-2 font-medium border-r border-slate-700 cursor-help">Bid / Ask</th>
              
              <th className="px-3 py-2 font-bold bg-slate-800 text-slate-200">K</th>
              
              <th title="Bid / Ask：买入按 Ask 成交，卖出按 Bid 成交；价差即交易成本" className="px-3 py-2 font-medium border-l border-slate-700 cursor-help">Bid / Ask</th>
              <th title="Delta：股价每变动 $1，期权价值的变化量；认购为正，认沽为负" className="px-3 py-2 font-medium cursor-help">Delta</th>
              <th title="Theta：每流逝 1 天，期权价值的变化量（时间衰减，买方通常为负）" className="px-3 py-2 font-medium cursor-help">Theta</th>
              <th title="Gamma：股价每变动 $1，Delta 的变化量（凸性）" className="px-3 py-2 font-medium cursor-help">Gamma</th>
              <th title="Vega：隐含波动率每变动 1%，期权价值的变化量" className="px-3 py-2 font-medium cursor-help">Vega</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {optionsData.map((row) => {
              const callITM = currentPrice > row.strike;
              const putITM = currentPrice < row.strike;
              
              const makeTrade = (type, price, quote) => () => {
                onTradeClick({
                  type,
                  strike: row.strike,
                  price,
                  quote,
                  expiration: activeExpirationDate.toISOString(),
                  delta: type === 'CALL' ? row.callDelta : row.putDelta
                });
              };
              
              return (
                <tr key={row.strike} className="hover:bg-slate-800/50 transition-colors">
                  {/* Calls */}
                  <td className="px-3 py-2 text-center text-xs text-slate-400">{formatGreeks(row.vega)}</td>
                  <td className="px-3 py-2 text-center text-xs text-slate-400">{formatGreeks(row.gamma)}</td>
                  <td className="px-3 py-2 text-center text-xs text-slate-400">{formatGreeks(row.callTheta)}</td>
                  <td className="px-3 py-2 text-center text-xs text-emerald-500/80">{formatGreeks(row.callDelta)}</td>
                  <td 
                    onClick={makeTrade('CALL', row.callQuote.mid, row.callQuote)}
                    className={`px-3 py-2 text-center font-medium cursor-pointer hover:bg-emerald-900/40 border-r border-slate-700 transition-colors ${callITM ? 'bg-emerald-900/20 text-emerald-300' : 'text-slate-300'}`}
                  >
                    <div className="text-xs text-slate-400">{formatCurrency(row.callQuote.bid)}</div>
                    <div className="text-sm text-emerald-300">{formatCurrency(row.callQuote.ask)}</div>
                  </td>
                  
                  {/* Strike */}
                  <td className="px-4 py-2 text-center font-bold text-white bg-slate-800 border-x border-slate-700 shadow-sm relative z-0">
                    {/* Visual indicator for current price level */}
                    {Math.abs(currentPrice - row.strike) <= (CONFIG.STRIKE_PRICE_STEP / 2) && (
                      <div className="absolute inset-y-0 left-0 w-1 bg-indigo-500" />
                    )}
                    {row.strike}
                  </td>
                  
                  {/* Puts */}
                  <td 
                    onClick={makeTrade('PUT', row.putQuote.mid, row.putQuote)}
                    className={`px-3 py-2 text-center font-medium cursor-pointer hover:bg-rose-900/40 border-l border-slate-700 transition-colors ${putITM ? 'bg-rose-900/20 text-rose-300' : 'text-slate-300'}`}
                  >
                    <div className="text-xs text-slate-400">{formatCurrency(row.putQuote.bid)}</div>
                    <div className="text-sm text-rose-300">{formatCurrency(row.putQuote.ask)}</div>
                  </td>
                  <td className="px-3 py-2 text-center text-xs text-rose-500/80">{formatGreeks(row.putDelta)}</td>
                  <td className="px-3 py-2 text-center text-xs text-slate-400">{formatGreeks(row.putTheta)}</td>
                  <td className="px-3 py-2 text-center text-xs text-slate-400">{formatGreeks(row.gamma)}</td>
                  <td className="px-3 py-2 text-center text-xs text-slate-400">{formatGreeks(row.vega)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
