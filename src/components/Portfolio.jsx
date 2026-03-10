import { useTradingStore } from '../store/useTradingStore';
import { calculateBlackScholes } from '../utils/mathUtils';
import { CONFIG } from '../constants/config';
import { formatCurrency, calculateTimeInYears } from '../utils/formatters';
import { useMemo } from 'react';
import { Briefcase, DollarSign, PieChart } from 'lucide-react';

export default function Portfolio({ onTradeStockClick, onTradeOptionClick }) {
  const cash = useTradingStore(state => state.cash);
  const positions = useTradingStore(state => state.positions);
  const currentPrice = useTradingStore(state => state.currentStockPrice);
  const currentDate = useTradingStore(state => state.currentDate);
  const volatility = useTradingStore(state => state.volatility);

  // Calculate Unrealized PnL and Net Liq
  const pnlData = useMemo(() => {
    let stockValue = positions.stock * currentPrice;
    let stockCost = 0; // Simplified
    
    let optionsValue = 0;
    // Evaluate current option positions
    const evaluatedOptions = positions.options.map(opt => {
      const timeToExpiry = calculateTimeInYears(currentDate, opt.expiration);
      let currentOptPrice = 0;
      let optDelta = 0;

      if (timeToExpiry > 0) {
         const bs = calculateBlackScholes(currentPrice, opt.strike, timeToExpiry, CONFIG.RISK_FREE_RATE, volatility);
         currentOptPrice = opt.type === 'CALL' ? bs.callPrice : bs.putPrice;
         optDelta = opt.type === 'CALL' ? bs.callDelta : bs.putDelta;
      } else {
         // Expired state intrinsic value
         currentOptPrice = opt.type === 'CALL' 
            ? Math.max(0, currentPrice - opt.strike) 
            : Math.max(0, opt.strike - currentPrice);
         optDelta = opt.type === 'CALL' 
            ? (currentPrice > opt.strike ? 1 : 0)
            : (currentPrice < opt.strike ? -1 : 0);
      }
      
      const currentValue = currentOptPrice * opt.quantity * 100; // Multiplier is 100 for display
      const initialCost = opt.averagePrice * opt.quantity * 100;
      const unrealizedPnL = currentValue - initialCost;
      
      optionsValue += currentValue;
      
      return {
        ...opt,
        currentPrice: currentOptPrice,
        delta: optDelta,
        currentValue,
        unrealizedPnL
      };
    });
    
    const netLiq = cash + (positions.stock * currentPrice) + optionsValue; // Simplified stock account structure
    const totalUnrealized = netLiq - CONFIG.INITIAL_CASH;

    return { netLiq, totalUnrealized, evaluatedOptions };
  }, [positions, currentPrice, currentDate, volatility, cash]);

  // Get history runs from store
  const historyRuns = useTradingStore(state => state.historyRuns);

  return (
    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg h-full overflow-y-auto">
      <div className="flex justify-between items-center border-b border-slate-700 pb-4 mb-6">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Briefcase size={20} className="text-indigo-400" />
          投资组合
        </h2>
        <button 
          onClick={onTradeStockClick}
          className="px-4 py-1.5 bg-slate-700 hover:bg-indigo-600 text-white text-sm font-medium rounded-md transition-colors shadow-sm"
        >
          交易股票
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1 flex items-center gap-1">
            <PieChart size={14} /> 净资产 (Net Liq)
          </p>
          <div className="text-2xl font-bold text-white">{formatCurrency(pnlData.netLiq)}</div>
        </div>
        
        <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1 flex items-center gap-1">
            <DollarSign size={14} /> 可用现金
          </p>
          <div className="text-xl font-medium text-slate-200">{formatCurrency(cash)}</div>
        </div>

        <div className={`col-span-2 bg-slate-900/50 p-4 rounded-lg border border-slate-700 flex justify-between items-center`}>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1">总浮动盈亏 (PnL)</p>
          <div className={`text-xl font-bold ${pnlData.totalUnrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {pnlData.totalUnrealized >= 0 ? '+' : ''}{formatCurrency(pnlData.totalUnrealized)}
          </div>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3 border-b border-slate-700 pb-2">当前持仓</h3>
        
        {positions.stock === 0 && positions.options.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">
            暂无持仓。快去下单吧！
          </div>
        ) : (
          <div className="space-y-3">
            {/* Stock Position */}
            {positions.stock !== 0 && (
              <div className="bg-slate-700/30 p-3 rounded-lg flex justify-between items-center border border-slate-600/50">
                <div>
                  <div className="font-bold text-white">TOCK 正股</div>
                  <div className="text-xs text-slate-400">
                    持仓: {positions.stock} 股 @ {formatCurrency(currentPrice)}
                  </div>
                </div>
                <div className="text-right">
                   <div className="font-semibold text-slate-200">{formatCurrency(Math.abs(positions.stock) * currentPrice)}</div>
                </div>
              </div>
            )}

            {/* Option Positions */}
            {pnlData.evaluatedOptions.map((opt, idx) => {
              const pnlColor = opt.unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400';
              const typeColor = opt.type === 'CALL' ? 'text-emerald-400 bg-emerald-400/10' : 'text-rose-400 bg-rose-400/10';
              
              return (
                <div 
                  key={idx} 
                  onClick={() => onTradeOptionClick && onTradeOptionClick({ type: opt.type, strike: opt.strike, price: opt.currentPrice, expiration: opt.expiration, delta: opt.delta })}
                  className="bg-slate-700/30 p-3 rounded-lg flex justify-between items-center border border-slate-600/50 cursor-pointer hover:bg-slate-700/50 transition-colors"
                >
                  <div>
                    <div className="font-bold text-white flex items-center gap-2">
                       {opt.strike} 
                       <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${typeColor}`}>
                         {opt.type === 'CALL' ? '看涨' : '看跌'}
                       </span>
                       <span className="text-xs text-slate-400 font-normal">
                         到期: {new Date(opt.expiration).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                       </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {Math.abs(opt.quantity)} 张 {opt.quantity > 0 ? '做多' : '做空'} @ 成本 {formatCurrency(opt.averagePrice)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-slate-200">{formatCurrency(Math.abs(opt.currentValue))}</div>
                    <div className={`text-xs font-semibold ${pnlColor}`}>
                      {opt.unrealizedPnL >= 0 ? '+' : ''}{formatCurrency(opt.unrealizedPnL)} PnL
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {historyRuns.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3 border-b border-slate-700 pb-2">历史模拟记录</h3>
          <div className="space-y-3">
            {historyRuns.map((run, idx) => (
              <div key={idx} className="bg-slate-900/50 p-3 rounded-lg border border-slate-700 flex justify-between items-center">
                <div className="text-xs text-slate-400">{run.date}</div>
                <div className="text-right">
                  <div className="font-bold text-white">{formatCurrency(run.finalValue)}</div>
                  <div className={`text-xs font-semibold ${run.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                     {run.profit >= 0 ? '+' : ''}{formatCurrency(run.profit)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
