import { useState, useMemo } from 'react';
import { useTradingStore } from '../store/useTradingStore';
import { CONFIG } from '../constants/config';
import { calculateBlackScholes } from '../utils/mathUtils';
import { formatCurrency, formatGreeks, calculateTimeInYears } from '../utils/formatters';

export default function OptionsChain({ onTradeClick }) {
  const currentPrice = useTradingStore(state => state.currentStockPrice);
  const currentDate = useTradingStore(state => state.currentDate);
  const volatility = useTradingStore(state => state.volatility);
  
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
    const T = calculateTimeInYears(currentDate, CONFIG.END_DATE);
    return strikes.map(strike => {
      const data = calculateBlackScholes(
        currentPrice, 
        strike, 
        T, 
        CONFIG.RISK_FREE_RATE, 
        volatility
      );
      return { strike, ...data };
    });
  }, [strikes, currentPrice, currentDate, volatility]);

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
        <h2 className="text-xl font-bold text-white">期权链 (T型报价)</h2>
        <div className="flex items-center gap-4 text-sm font-medium">
          <span className="text-slate-400">隐含波动率: <span className="text-amber-400">{(volatility * 100).toFixed(1)}%</span></span>
          <span className="text-slate-400">到期日: <span className="text-white">4月30日</span></span>
        </div>
      </div>
      
      <div className="overflow-x-auto flex-1 h-[400px]">
        <table className="w-full whitespace-nowrap">
          <thead className="bg-slate-900 border-b border-slate-700 sticky top-0 z-10">
            <tr>
              <th colSpan="5" className="px-4 py-2 text-center text-emerald-400 font-semibold border-r border-slate-700">看涨期权 (CALL)</th>
              <th className="px-4 py-2 text-center text-white font-bold bg-slate-800">行权价</th>
              <th colSpan="5" className="px-4 py-2 text-center text-rose-400 font-semibold border-l border-slate-700">看跌期权 (PUT)</th>
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
                onTradeClick({ type, strike: row.strike, price });
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
