import { useState } from 'react';
import { useTradingStore } from '../store/useTradingStore';
import { formatCurrency } from '../utils/formatters';
import { X, TrendingUp, TrendingDown } from 'lucide-react';

export default function TradeModal({ tradeDetails, onClose }) {
  const [quantity, setQuantity] = useState('');
  const [action, setAction] = useState('BUY'); // BUY or SELL
  const [limitMsg, setLimitMsg] = useState(null);
  const [fillRejection, setFillRejection] = useState(null);
  
  const currentStockPrice = useTradingStore(state => state.currentStockPrice);
  const currentDate = useTradingStore(state => state.currentDate);
  const tradeStock = useTradingStore(state => state.tradeStock);
  const tradeOption = useTradingStore(state => state.tradeOption);

  if (!tradeDetails) return null;

  const isStock = tradeDetails.type === 'STOCK';
  
  // Liquidity Engine Calculations
  let displayPrice = isStock ? currentStockPrice : tradeDetails.price;
  let isIlliquid = false;
  
  if (!isStock) {
    const strike = tradeDetails.strike;
    const distanceToStrike = Math.abs(currentStockPrice - strike) / currentStockPrice;
    
    // Parse expiration
    const expDate = new Date(tradeDetails.expiration);
    const daysToExpiry = Math.max(0, Math.ceil((expDate.getTime() - currentDate.getTime()) / (1000 * 3600 * 24)));
    
    // Bid = 0 Logic for deep OTM near-expiry
    if (distanceToStrike > 0.20 && daysToExpiry <= 2 && action === 'SELL') {
       displayPrice = 0; // The bid is effectively 0
       isIlliquid = true;
    }
    
    // Add artificial spread based on distance and action
    if (!isIlliquid && distanceToStrike > 0.10) {
       // Spread widens the deeper OTM it gets
       const spreadPadding = displayPrice * (distanceToStrike / 2);
       if (action === 'BUY') displayPrice += spreadPadding; // Ask is higher
       if (action === 'SELL') displayPrice = Math.max(0, displayPrice - spreadPadding); // Bid is lower
    }
  }

  // Cost calculation
  const multiplier = isStock ? 1 : 100;
  
  const handleTrade = () => {
    setFillRejection(null);
    setLimitMsg(null);
    
    let qty = parseInt(quantity, 10);
    if (!qty || isNaN(qty) || qty <= 0) {
       alert("请输入有效数量。");
       return;
    }

    if (!isStock) {
       const absDelta = Math.abs(tradeDetails.delta);
       
       // Volume Limit Simulation
       let maxVolumeLimit = 1000;
       if (absDelta < 0.10) maxVolumeLimit = Math.floor(10 + Math.random() * 40); // 10-50 max typical
       else if (absDelta < 0.30) maxVolumeLimit = Math.floor(50 + Math.random() * 200);
       
       // Partial fill logic
       if (qty > maxVolumeLimit) {
           setLimitMsg(`市场深度不足！部分成交：仅撮合 ${maxVolumeLimit} 张。剩余订单已撤销。`);
           qty = maxVolumeLimit;
           setQuantity(qty.toString());
           // Let user see the message before actually placing the trade next click
           return;
       }

       // Probability Engine (Delta based)
       if (absDelta < 0.05 && action === 'SELL') {
           // E.g., Delta 0.02 => Probability = 1 - (1/(0.02*100)) = 1 - (1/2) = 50% chance
           const probability = Math.max(0, 1 - (1 / (absDelta * 100)));
           if (Math.random() > probability) {
               setFillRejection("流动性枯竭：对手方不足！未找到愿意接盘的买家。");
               return; // Reject trade completely
           }
       }
    }

    const tradeQty = action === 'BUY' ? qty : -qty;

    if (isStock) {
      tradeStock(tradeQty, displayPrice);
    } else {
      tradeOption({
        type: tradeDetails.type,
        strike: tradeDetails.strike,
        quantity: tradeQty,
        price: displayPrice,
        expiration: tradeDetails.expiration
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center p-4 border-b border-slate-700 bg-slate-900/50">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            {isStock ? '交易股票' : `交易期权`}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>
        
        <div className="p-6 space-y-6">
          <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700 flex justify-between items-center">
            <div>
              <div className="text-sm text-slate-400 font-medium uppercase tracking-wider mb-1">交易标的</div>
              <div className="text-xl font-bold text-white">
                {isStock ? 'TOCK (正股)' : `行权价 ${tradeDetails.strike} ${tradeDetails.type === 'CALL' ? '认购' : '认沽'}`}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-slate-400 font-medium uppercase tracking-wider mb-1">
                 {isStock ? '单价' : (action === 'BUY' ? '卖出价 (Ask)' : '买入价 (Bid)')}
              </div>
              <div className={`text-2xl font-bold ${isIlliquid ? 'text-rose-500' : 'text-indigo-400'}`}>
                 {formatCurrency(displayPrice)}
                 {isIlliquid && <span className="text-xs ml-2 text-rose-500 block font-normal">无买盘</span>}
              </div>
            </div>
          </div>
          
          <div className="flex gap-2 p-1 bg-slate-900 rounded-lg">
            <button 
              className={`flex-1 py-2 px-4 rounded-md font-bold transition-colors ${action === 'BUY' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-slate-400 hover:text-white'}`}
              onClick={() => setAction('BUY')}
            >
              买入开仓 / 平仓
            </button>
            <button 
              className={`flex-1 py-2 px-4 rounded-md font-bold transition-colors ${action === 'SELL' ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20' : 'text-slate-400 hover:text-white'}`}
              onClick={() => setAction('SELL')}
            >
              卖出开仓 / 平仓
            </button>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">
              交易数量 {isStock ? '(股)' : '(张, 每张乘数 100)'}
            </label>
            <input 
              type="number" 
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium text-lg"
              placeholder="例如：10"
            />
          </div>

          <div className={`bg-slate-900/30 p-4 rounded-xl border flex justify-between items-center ${isIlliquid ? 'border-rose-500/50' : 'border-slate-700/50'}`}>
             <span className="text-slate-400 font-medium">预估总额</span>
             <span className="text-xl font-bold text-white">
               {quantity ? formatCurrency((parseFloat(quantity) || 0) * displayPrice * multiplier) : '$0.00'}
             </span>
          </div>
          
          {limitMsg && (
             <div className="text-amber-400 bg-amber-400/10 px-4 py-2 rounded-lg text-sm text-center animate-pulse">
                {limitMsg}
                <div className="text-xs text-amber-500/80 mt-1">请再次点击确认提交订单</div>
             </div>
          )}
          
          {fillRejection && (
             <div className="text-rose-400 bg-rose-400/10 px-4 py-2 rounded-lg text-sm text-center font-bold animate-pulse">
                {fillRejection}
             </div>
          )}
          
          <button 
            onClick={handleTrade}
            disabled={!quantity || quantity <= 0}
            className={`w-full py-4 rounded-xl font-bold text-lg transition-all flex justify-center items-center gap-2 ${
              !quantity || quantity <= 0
                ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                : action === 'BUY'
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 active:scale-[0.98]'
                  : 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20 active:scale-[0.98]'
            }`}
          >
            {action === 'BUY' ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
            确认 {action === 'BUY' ? '买入' : '卖出'}
          </button>
        </div>
      </div>
    </div>
  );
}
