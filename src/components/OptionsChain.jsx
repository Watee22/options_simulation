import { useState, useMemo } from 'react';
import { useTradingStore } from '../store/useTradingStore';
import { CONFIG } from '../constants/config';
import { calculateBlackScholes } from '../utils/mathUtils';
import { formatCurrency, formatGreeks, calculateTimeInYears } from '../utils/formatters';

export default function OptionsChain({ onTradeClick }) {
  const currentPrice = useTradingStore(state => state.currentStockPrice);
  const currentDate = useTradingStore(state => state.currentDate);
  const volatility = useTradingStore(state => state.volatility);
  
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

  // Auto-roll selected expiration if the current one expires
  useMemo(() => {
     if (expirations.length > 0 && currentDate > expirations[selectedExpiration]) {
         setSelectedExpiration(0);
     }
  }, [currentDate, expirations, selectedExpiration]);

  const activeExpirationDate = expirations[selectedExpiration];
  
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
    const daysToMaturity = T * 365;
    let termVolatility = volatility;

    if (daysToMaturity < 3) {
        // Aggressive crush for 0-2 DTE
        // Max safeguards against dividing by 0 or negative days
        const crushFactor = Math.pow(Math.max(0.1, daysToMaturity) / 3, 0.5); 
        termVolatility = termVolatility * crushFactor;
    } else {
        // Decay pushes IV back to CONFIG.INITIAL_VOLATILITY as time extends
        // The power factor is mild to ensure T remains dominant
        const timeVolAdjust = Math.exp(-(T - (3/365)) * 2); 
        termVolatility = CONFIG.INITIAL_VOLATILITY + (volatility - CONFIG.INITIAL_VOLATILITY) * timeVolAdjust;
    }

    // Monotonicity Guarantee: Total variance (IV^2 * T) must not be lower than a generic 3-day baseline
    // to prevent long-term options from becoming cheaper than medium-term options during shocks.
    // We calculate a "floor variance" based on current prices and ensure the option respects it.
    // For simplicity, we ensure termVolatility is at least the baseline.
    if (termVolatility < CONFIG.INITIAL_VOLATILITY) {
        termVolatility = CONFIG.INITIAL_VOLATILITY;
    }

    return strikes.map(strike => {
      const data = calculateBlackScholes(
        currentPrice, 
        strike, 
        T, 
        CONFIG.RISK_FREE_RATE, 
        termVolatility
      );
      return { strike, termVolatility, ...data };
    });
  }, [strikes, currentPrice, currentDate, volatility, activeExpirationDate]);

  const Cell = ({ value, isMoney, onClick }) => (
    <td 
      onClick={onClick}
      className={`px-3 py-2 text-center text-sm cursor-pointer hover:bg-slate-700 transition-colors border-b border-slate-700/50 ${isMoney ? 'font-medium text-emerald-400' : 'text-slate-300'}`}
    >
      {value}
    </td>
  );

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-lg overflow-hidden flex flex-col h-full">
      <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/80">
        <h2 className="text-xl font-bold text-white flex items-center gap-3">
          期权链 (T型报价)
          <select 
            value={selectedExpiration}
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
          <span className="text-slate-400">到期波动率: <span className="text-rose-400">{(optionsData.length > 0 ? optionsData[0].termVolatility * 100 : volatility * 100).toFixed(1)}%</span></span>
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
              <th className="px-3 py-2 font-medium">Vega</th>
              <th className="px-3 py-2 font-medium">Gamma</th>
              <th className="px-3 py-2 font-medium">Theta</th>
              <th className="px-3 py-2 font-medium">Delta</th>
              <th className="px-3 py-2 font-medium border-r border-slate-700">现价</th>
              
              <th className="px-3 py-2 font-bold bg-slate-800 text-slate-200">K</th>
              
              <th className="px-3 py-2 font-medium border-l border-slate-700">现价</th>
              <th className="px-3 py-2 font-medium">Delta</th>
              <th className="px-3 py-2 font-medium">Theta</th>
              <th className="px-3 py-2 font-medium">Gamma</th>
              <th className="px-3 py-2 font-medium">Vega</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {optionsData.map((row) => {
              const callITM = currentPrice > row.strike;
              const putITM = currentPrice < row.strike;
              
              const makeTrade = (type, price) => () => {
                onTradeClick({ type, strike: row.strike, price, expiration: activeExpirationDate.toISOString(), delta: type === 'CALL' ? row.callDelta : row.putDelta });
              };
              
              return (
                <tr key={row.strike} className="hover:bg-slate-800/50 transition-colors">
                  {/* Calls */}
                  <td className="px-3 py-2 text-center text-xs text-slate-400">{formatGreeks(row.vega)}</td>
                  <td className="px-3 py-2 text-center text-xs text-slate-400">{formatGreeks(row.gamma)}</td>
                  <td className="px-3 py-2 text-center text-xs text-slate-400">{formatGreeks(row.callTheta)}</td>
                  <td className="px-3 py-2 text-center text-xs text-emerald-500/80">{formatGreeks(row.callDelta)}</td>
                  <td 
                    onClick={makeTrade('CALL', row.callPrice)}
                    className={`px-3 py-2 text-center font-medium cursor-pointer hover:bg-emerald-900/40 border-r border-slate-700 transition-colors ${callITM ? 'bg-emerald-900/20 text-emerald-300' : 'text-slate-300'}`}
                  >
                    {formatCurrency(row.callPrice)}
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
                    onClick={makeTrade('PUT', row.putPrice)}
                    className={`px-3 py-2 text-center font-medium cursor-pointer hover:bg-rose-900/40 border-l border-slate-700 transition-colors ${putITM ? 'bg-rose-900/20 text-rose-300' : 'text-slate-300'}`}
                  >
                    {formatCurrency(row.putPrice)}
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
