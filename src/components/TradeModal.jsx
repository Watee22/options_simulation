import { useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip } from 'recharts';
import { useTradingStore } from '../store/useTradingStore';
import { formatCurrency } from '../utils/formatters';
import {
  OPTION_MULTIPLIER,
  OPTION_CONTRACT_FEE,
  STOCK_TICKET_FEE,
  buildExpirationPnlCurve,
  calculateOptionAveragePrice,
  calculateOptionMarginPerContract,
} from '../utils/tradingUtils';
import { X, TrendingUp, TrendingDown, Lightbulb, CheckCircle2 } from 'lucide-react';

// Deterministic depth model: the same order must always produce the same
// outcome, otherwise a "partial fill" can change between the first click
// (which only shows the message) and the confirming second click.
// Realistic shape: the ATM strike is the most liquid; both deep OTM and
// deep ITM are thin (the old model was inverted - it treated the deepest
// ITM, highest-delta contracts as the most liquid).
function getMaxVolumeLimit(distanceToStrike) {
  const d = Math.abs(distanceToStrike);
  if (d <= 0.02) return 500; // ATM
  if (d <= 0.05) return 200;
  if (d <= 0.10) return 50;
  if (d <= 0.20) return 10;
  return 3; // deep OTM / deep ITM
}

// Deterministic pseudo-random per contract (seeded by strike), so the same
// deep-OTM sell order is always accepted or always rejected, regardless of
// how many times the user clicks confirm.
function seededRandom(seed) {
  let t = (Math.abs(seed) >>> 0) + 0x6D2B79F5;
  let x = t;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}

function shouldRejectThinMarketSell(absDelta, strike) {
  const probability = Math.max(0, 1 - (1 / (absDelta * 100)));
  if (probability <= 0) return true;
  return seededRandom(strike) > probability;
}

// Builds a short teaching explanation for a filled order.
function buildTradeExplanation(summary, { isStock, tradeDetails, positions, pnlCurve }) {
  const money = formatCurrency(summary.price);
  const qty = Math.abs(summary.quantity);
  const cashAfter = formatCurrency(summary.cashAfter);
  if (isStock) {
    return summary.action === '买入'
      ? `你以 ${money} 买入 ${qty} 股 ${summary.symbol}，成交后现金 ${cashAfter}。持有股票的最大亏损 = 全部买入金额，最大收益无限；可用止损或买入认沽对冲下跌风险。`
      : `你以 ${money} 卖出 ${qty} 股 ${summary.symbol}，成交后现金 ${cashAfter}。${positions.stock < 0 ? '做空：最大收益有限（股价最多跌到 0），最大亏损无限，且需承担借券成本。' : '卖出后持仓减少；若为平仓，已实现盈亏已计入账本。'}`;
  }
  const label = `${tradeDetails.type === 'CALL' ? '认购' : '认沽'} ${tradeDetails.strike}`;
  const premiumTotal = formatCurrency(qty * summary.price * OPTION_MULTIPLIER);
  const be = pnlCurve && !pnlCurve.flat && pnlCurve.breakEvens.length
    ? formatCurrency(pnlCurve.breakEvens[0]) : '—';
  const maxGain = pnlCurve && !pnlCurve.flat
    ? (pnlCurve.maxGain === Infinity ? '无限' : formatCurrency(pnlCurve.maxGain)) : '—';
  const maxLoss = pnlCurve && !pnlCurve.flat
    ? (pnlCurve.maxLoss === -Infinity ? '无限' : formatCurrency(pnlCurve.maxLoss)) : '—';
  if (summary.action === '买入') {
    return tradeDetails.type === 'CALL'
      ? `你买入 ${qty} 张 ${label}，支付权利金 ${premiumTotal}（最大亏损）。看涨观点：盈亏平衡点 ${be}，到期未超过则亏损全部权利金；时间衰减（Theta）每天都在侵蚀价值。`
      : `你买入 ${qty} 张 ${label}，支付权利金 ${premiumTotal}（最大亏损）。看跌或对冲：盈亏平衡点 ${be}；若持有正股，这就是"保险"——下跌有保护，上涨只损失保费。`;
  }
  return tradeDetails.type === 'CALL'
    ? `你卖出 ${qty} 张 ${label}，收取权利金 ${premiumTotal}（最大收益 ${maxGain}）。看跌或看平：${positions.stock >= 100 ? '已由正股覆盖（备兑）：收益封顶，股票可能被以行权价买走，超出行权价的涨幅不再属于你。' : '裸卖：若股价大涨，亏损无限，且需占用保证金。'}`
    : `你卖出 ${qty} 张 ${label}，收取权利金 ${premiumTotal}。看涨或看平：若到期股价跌破行权价，你有义务以行权价买入股票（有效成本 = 行权价 − 权利金）；最大亏损 ${maxLoss}，需占用保证金。`;
}

const PnlTooltip = ({ active, payload }) => {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-slate-900 border border-slate-700 px-2.5 py-1.5 rounded-lg shadow-xl text-xs">
      <div className="text-slate-400">{formatCurrency(d.s)}</div>
      <div className={"font-bold " + (d.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}>{formatCurrency(d.pnl)}</div>
    </div>
  );
};

export default function TradeModal({ tradeDetails, onClose }) {
  const [quantity, setQuantity] = useState('');
  const [action, setAction] = useState('BUY'); // BUY or SELL
  const [limitMsg, setLimitMsg] = useState(null);
  const [fillRejection, setFillRejection] = useState(null);
  const [tradeError, setTradeError] = useState(null);
  const [tradeResult, setTradeResult] = useState(null);
  
  const currentStockPrice = useTradingStore(state => state.currentStockPrice);
  const currentDate = useTradingStore(state => state.currentDate);
  const positions = useTradingStore(state => state.positions);
  const tradeStock = useTradingStore(state => state.tradeStock);
  const tradeOption = useTradingStore(state => state.tradeOption);
  const hintMode = useTradingStore(state => state.hintMode);

  const isStock = tradeDetails?.type === 'STOCK';

  // Liquidity Engine Calculations
  let displayPrice = isStock ? currentStockPrice : (tradeDetails ? tradeDetails.price : 0);
  let isIlliquid = false;

  if (tradeDetails && !isStock) {
    if (tradeDetails.quote) {
      displayPrice = action === 'BUY' ? tradeDetails.quote.ask : tradeDetails.quote.bid;
      isIlliquid = action === 'SELL' && tradeDetails.quote.bid <= 0;
    } else {
      const strike = tradeDetails.strike;
      const distanceToStrike = Math.abs(currentStockPrice - strike) / currentStockPrice;
      
      // Parse expiration
      const expDate = new Date(tradeDetails.expiration);
      const daysToExpiry = Math.max(0, Math.ceil((expDate.getTime() - currentDate.getTime()) / (1000 * 3600 * 24)));
      
      // Deep OTM near-expiry: quote at pennies instead of refusing a bid
      if (distanceToStrike > 0.20 && daysToExpiry <= 2 && action === 'SELL') {
         displayPrice = 0.01; // penny quote
         isIlliquid = false;
      }
      
      // Add artificial spread based on distance and action
      if (!isIlliquid && distanceToStrike > 0.10) {
         // Spread widens the deeper OTM it gets
         const spreadPadding = displayPrice * (distanceToStrike / 2);
         if (action === 'BUY') displayPrice += spreadPadding; // Ask is higher
         if (action === 'SELL') displayPrice = Math.max(0, displayPrice - spreadPadding); // Bid is lower
      }
    }
  }

  // Expiration PnL curve for the position that results from this trade
  // (existing same-series position + this order + the stock leg).
  const pnlCurve = useMemo(() => {
    if (!tradeDetails) return null;
    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0) return null;
    const tradeQty = action === 'BUY' ? qty : -qty;
    const fees = isStock ? STOCK_TICKET_FEE : Math.abs(tradeQty) * OPTION_CONTRACT_FEE;
    if (isStock) {
      return buildExpirationPnlCurve({
        type: null,
        spot: currentStockPrice,
        tradeQty,
        tradePrice: displayPrice,
        stockQty: positions.stock,
        stockAvg: positions.stockAveragePrice,
        fees,
      });
    }
    const existing = positions.options.find(o =>
      o.type === tradeDetails.type &&
      o.strike === tradeDetails.strike &&
      o.expiration === tradeDetails.expiration
    );
    return buildExpirationPnlCurve({
      type: tradeDetails.type,
      strike: tradeDetails.strike,
      existingQty: existing ? existing.quantity : 0,
      existingAvg: existing ? existing.averagePrice : 0,
      tradeQty,
      tradePrice: displayPrice,
      stockQty: positions.stock,
      stockAvg: positions.stockAveragePrice,
      spot: currentStockPrice,
      fees,
    });
  }, [quantity, action, isStock, displayPrice, currentStockPrice, positions, tradeDetails]);

  // Reg-T margin requirement for the resulting short position (if any)
  const marginInfo = useMemo(() => {
    if (isStock || !tradeDetails) return null;
    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0) return null;
    const tradeQty = action === 'BUY' ? qty : -qty;
    const existing = positions.options.find(o =>
      o.type === tradeDetails.type &&
      o.strike === tradeDetails.strike &&
      o.expiration === tradeDetails.expiration
    );
    const existingQty = existing ? existing.quantity : 0;
    const netQty = existingQty + tradeQty;
    if (netQty >= 0) return null; // long side pays premium, no margin
    const avg = calculateOptionAveragePrice(existingQty, existing ? existing.averagePrice : 0, tradeQty, displayPrice);
    const perContract = calculateOptionMarginPerContract(tradeDetails.type, tradeDetails.strike, currentStockPrice, avg);
    let covered = 0;
    if (tradeDetails.type === 'CALL' && positions.stock > 0) {
      covered = Math.min(Math.abs(netQty), Math.floor(positions.stock / OPTION_MULTIPLIER));
    }
    return {
      contracts: Math.abs(netQty),
      perContract,
      covered,
      type: tradeDetails.type,
      strike: tradeDetails.strike,
    };
  }, [isStock, tradeDetails, quantity, action, displayPrice, currentStockPrice, positions]);

  if (!tradeDetails) return null;

  // Cost calculation
  const multiplier = isStock ? 1 : 100;
  
  const handleTrade = () => {
    setFillRejection(null);
    setLimitMsg(null);
    setTradeError(null);

    let qty = parseInt(quantity, 10);
    if (!qty || isNaN(qty) || qty <= 0) {
       setTradeError('请输入有效数量（正整数）。');
       return;
    }

    if (!isStock && isIlliquid) {
       setFillRejection("当前没有有效买盘，卖单无法成交。");
       return;
    }

    if (!isStock) {
       const absDelta = Math.abs(tradeDetails.delta);

       // Volume Limit Simulation (depth peaks at the ATM strike)
       const maxVolumeLimit = getMaxVolumeLimit(
         Math.abs(currentStockPrice - tradeDetails.strike) / currentStockPrice
       );

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
           if (shouldRejectThinMarketSell(absDelta, tradeDetails.strike)) {
               setFillRejection("流动性枯竭：对手方不足！未找到愿意接盘的买家。");
               return; // Reject trade completely
           }
       }
    }

    const tradeQty = action === 'BUY' ? qty : -qty;
    const result = isStock
      ? tradeStock(tradeQty, displayPrice)
      : tradeOption({
          type: tradeDetails.type,
          strike: tradeDetails.strike,
          quantity: tradeQty,
          price: displayPrice,
          expiration: tradeDetails.expiration
        });

    if (!result || !result.ok) {
      setTradeError(result && result.message ? result.message : '交易失败，请重试。');
      return;
    }

    setTradeResult({
      ...result.summary,
      explanation: buildTradeExplanation(result.summary, {
        isStock,
        tradeDetails,
        positions,
        pnlCurve,
      }),
    });
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

        {tradeResult ? (
          <div className="p-6 space-y-4">
            <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-xl p-4">
              <div className="font-bold text-emerald-400 flex items-center gap-2">
                <CheckCircle2 size={18} /> 成交确认
              </div>
              <div className="text-sm text-slate-300 mt-1.5">
                {tradeResult.action} {Math.abs(tradeResult.quantity)} {isStock ? '股' : '张'}
                {isStock ? ` ${tradeResult.symbol}` : ` ${tradeResult.optionType === 'CALL' ? '认购' : '认沽'} ${tradeResult.strike}`}
                @ {formatCurrency(tradeResult.price)} · 费用 {formatCurrency(tradeResult.fees)}
              </div>
              <div className="text-xs text-slate-400 mt-1">成交后现金 {formatCurrency(tradeResult.cashAfter)}</div>
            </div>
            <div className="bg-indigo-900/20 border border-indigo-500/30 rounded-xl p-4 text-sm text-indigo-100 leading-relaxed">
              {tradeResult.explanation}
            </div>
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-bold text-white transition-all"
            >
              完成
            </button>
          </div>
        ) : (
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
              {!isStock && tradeDetails.quote && (
                <div className="text-xs text-slate-500 mt-1">
                  Bid {formatCurrency(tradeDetails.quote.bid)} / Ask {formatCurrency(tradeDetails.quote.ask)}
                </div>
              )}
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

          {!isStock && quantity > 0 && (
            <div className="bg-indigo-900/20 p-3 rounded-lg border border-indigo-500/30 flex justify-between items-center">
               <span className="text-indigo-300 text-sm font-medium">盈亏平衡点 (Break-even)</span>
               <span className="text-indigo-400 font-bold">
                 {tradeDetails.type === 'CALL' 
                   ? formatCurrency(tradeDetails.strike + displayPrice) 
                   : formatCurrency(tradeDetails.strike - displayPrice)}
               </span>
            </div>
          )}
          
          {isStock && quantity > 0 && (
            <div className="bg-indigo-900/20 p-3 rounded-lg border border-indigo-500/30 flex justify-between items-center">
               <span className="text-indigo-300 text-sm font-medium">当前成本价 (Cost Basis)</span>
               <span className="text-indigo-400 font-bold">
                 {formatCurrency(displayPrice)}
               </span>
            </div>
          )}

          {marginInfo && (
            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-700/50">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-slate-300">保证金要求 (Reg-T 近似)</span>
                <span className="text-sm font-bold text-amber-300">
                  {formatCurrency(marginInfo.perContract * (marginInfo.contracts - marginInfo.covered))} 占用
                </span>
              </div>
              <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                {marginInfo.covered > 0
                  ? marginInfo.covered + " 张已由正股覆盖（备兑），无额外保证金；剩余 " + (marginInfo.contracts - marginInfo.covered) + " 张裸卖每张 " + formatCurrency(marginInfo.perContract) + "。"
                  : "裸卖 " + marginInfo.contracts + " 张，每张 " + formatCurrency(marginInfo.perContract)
                    + "（" + (marginInfo.type === 'PUT' ? '20%×行权价 − 虚值 + 权利金' : '20%×股价 − 虚值 + 权利金') + "，下限 10%）。"}
              </div>
            </div>
          )}

          {pnlCurve && (
            <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-700/50">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-slate-300">
                  {isStock ? '股价盈亏图' : '到期盈亏图 (持有至到期)'}
                </span>
                {!isStock && positions.stock !== 0 && (
                  <span className="text-[11px] text-slate-500">已含正股 {positions.stock} 股</span>
                )}
              </div>
              {pnlCurve.flat ? (
                <div className="text-center text-sm py-4 text-slate-400">
                  该交易将完全平仓，无剩余敞口。
                  <div className={"mt-1 font-bold " + (pnlCurve.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                    已实现盈亏 ≈ {formatCurrency(pnlCurve.realizedPnl)}
                  </div>
                </div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={140}>
                    <AreaChart data={pnlCurve.points} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#818cf8" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#818cf8" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                      <XAxis dataKey="s" type="number" domain={['dataMin', 'dataMax']} hide />
                      <YAxis hide domain={['auto', 'auto']} />
                      <ReferenceLine y={0} stroke="#f43f5e" strokeDasharray="3 3" />
                      <ReferenceLine x={currentStockPrice} stroke="#94a3b8" strokeDasharray="3 3" />
                      {pnlCurve.breakEvens.map((be, i) => (
                        <ReferenceLine key={i} x={be} stroke="#fbbf24" strokeDasharray="4 4" />
                      ))}
                      <Area type="monotone" dataKey="pnl" stroke="#818cf8" strokeWidth={2} fill="url(#pnlFill)" isAnimationActive={false} />
                      <Tooltip content={<PnlTooltip />} />
                    </AreaChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[11px] text-slate-400">
                    <span>
                      盈亏平衡: {pnlCurve.breakEvens.length > 0
                        ? pnlCurve.breakEvens.map(s => formatCurrency(s)).join(' / ')
                        : '—'}
                    </span>
                    <span>最大盈利: {pnlCurve.maxGain === Infinity ? '无限' : formatCurrency(pnlCurve.maxGain)}</span>
                    <span>最大亏损: {pnlCurve.maxLoss === -Infinity ? '无限' : formatCurrency(pnlCurve.maxLoss)}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {hintMode && (
             <div className="bg-amber-900/20 border border-amber-500/30 p-4 rounded-xl relative overflow-hidden">
               <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
               <div className="flex items-start gap-3">
                 <Lightbulb className="text-amber-400 shrink-0 mt-0.5" size={18} />
                 <div className="text-sm text-amber-200/90 leading-relaxed font-medium">
                   {isStock ? (
                     action === 'BUY' ? '提示：您正在买入正股，预期股价上涨。最大亏损为买入金额，最大收益无限。' : '提示：您正在做空或卖出正股，预期股价下跌。注意裸做空风险极高。'
                   ) : (
                     tradeDetails.type === 'CALL' ? (
                       action === 'BUY' ? '提示：您正在买入认购期权。强烈看涨。如果到期未超过盈亏平衡点将产生亏损，最大亏损为全部权利金。' : '提示：您正在卖出认购期权。看跌或看平。您将获得权利金，但如果有正股，将会限制正股上涨带来的收益（备兑）；如果无正股（裸卖），风险无限大。'
                     ) : (
                       action === 'BUY' ? '提示：您正在买入认沽期权。强烈看跌。常用于对冲正股下跌风险（买保险），最大亏损为全部权利金。' : '提示：您正在卖出认沽期权。看涨或看平。您将获得权利金，但如果股价大跌，您有义务以比现价更高的行权价买入股票。'
                     )
                   )}
                 </div>
               </div>
             </div>
          )}
          
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
            disabled={!quantity || quantity <= 0 || isIlliquid}
            className={`w-full py-4 rounded-xl font-bold text-lg transition-all flex justify-center items-center gap-2 ${
              !quantity || quantity <= 0 || isIlliquid
                ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                : action === 'BUY'
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 active:scale-[0.98]'
                  : 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20 active:scale-[0.98]'
            }`}
          >
            {action === 'BUY' ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
            确认 {action === 'BUY' ? '买入' : '卖出'}
          </button>

          {tradeError && (
            <div className="text-rose-400 bg-rose-400/10 px-4 py-2.5 rounded-lg text-sm text-center font-bold leading-relaxed">
              {tradeError}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
