import { useState } from 'react';
import { useTradingStore } from '../store/useTradingStore';
import { formatCurrency } from '../utils/formatters';
import { X, TrendingUp, TrendingDown } from 'lucide-react';

export default function TradeModal({ tradeDetails, onClose }) {
  const [quantity, setQuantity] = useState('');
  const [action, setAction] = useState('BUY'); // BUY or SELL
  
  const currentStockPrice = useTradingStore(state => state.currentStockPrice);
  const tradeStock = useTradingStore(state => state.tradeStock);
  const tradeOption = useTradingStore(state => state.tradeOption);

  if (!tradeDetails) return null;

  const isStock = tradeDetails.type === 'STOCK';
  const price = isStock ? currentStockPrice : tradeDetails.price;
  
  // For options, 1 contract is 100 shares. Total cost is price * quantity * 100
  const multiplier = isStock ? 1 : 100;
  
  const handleTrade = () => {
    const qty = parseInt(quantity, 10);
    if (!qty || isNaN(qty) || qty <= 0) {
       alert("Please enter a valid quantity.");
       return;
    }

    const tradeQty = action === 'BUY' ? qty : -qty;

    if (isStock) {
      tradeStock(tradeQty, price);
    } else {
      tradeOption({
        type: tradeDetails.type,
        strike: tradeDetails.strike,
        quantity: tradeQty,
        price: price
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
                {isStock ? 'TOCK (正股)' : `行权价 ${tradeDetails.strike} ${tradeDetails.type === 'CALL' ? '看涨' : '看跌'}`}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-slate-400 font-medium uppercase tracking-wider mb-1">单价</div>
              <div className="text-2xl font-bold text-indigo-400">{formatCurrency(price)}</div>
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

          <div className="bg-slate-900/30 p-4 rounded-xl border border-slate-700/50 flex justify-between items-center">
             <span className="text-slate-400 font-medium">预估总额</span>
             <span className="text-xl font-bold text-white">
               {quantity ? formatCurrency((parseFloat(quantity) || 0) * price * multiplier) : '$0.00'}
             </span>
          </div>
          
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
