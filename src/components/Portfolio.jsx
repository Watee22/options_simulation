import { useTradingStore } from '../store/useTradingStore';
import { calculateBlackScholes } from '../utils/mathUtils';
import { CONFIG } from '../constants/config';
import { formatCurrency, formatGreeks, calculateTimeInYears, getDaysToExpiration } from '../utils/formatters';
import { calculateOptionQuote, calculateReservedCash, getOptionIntrinsicValue, OPTION_MULTIPLIER, roundMoney } from '../utils/tradingUtils';
import { getTermVolatility } from '../utils/optionPricing';
import { MACRO_EVENTS } from '../constants/eventsConfig';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Briefcase, DollarSign, PieChart, ReceiptText, ShieldAlert, ShieldCheck, X } from 'lucide-react';

function buildScoreCard(series, transactionLog) {
  let peak = -Infinity;
  let maxDrawdown = 0;
  series.forEach(p => {
    if (p.netWorth > peak) peak = p.netWorth;
    if (peak > 0) {
      const dd = (peak - p.netWorth) / peak;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
  });
  const last = series.length > 0 ? series[series.length - 1].netWorth : 0;
  const totalReturn = last - CONFIG.INITIAL_CASH;
  const fees = transactionLog.reduce((s, t) => s + (t.fees || 0), 0);
  const eventRows = Object.keys(MACRO_EVENTS)
    .map(key => {
      const idx = series.findIndex(p => p.date === key);
      if (idx <= 0) return null;
      return {
        name: MACRO_EVENTS[key].name,
        dayChange: roundMoney(series[idx].netWorth - series[idx - 1].netWorth),
      };
    })
    .filter(Boolean);
  return {
    totalReturn,
    totalReturnPct: (totalReturn / CONFIG.INITIAL_CASH) * 100,
    maxDrawdown: maxDrawdown * 100,
    fees,
    trades: transactionLog.length,
    eventRows,
    grade: gradeRun(totalReturn, maxDrawdown),
  };
}

function gradeRun(totalReturn, maxDrawdown) {
  if (totalReturn <= 0) {
    return { tone: 'review', text: '本轮亏损。建议复盘：持仓卡上的当日归因（股价 / 时间 / 波动率）会告诉你钱亏在哪里；事件前后的 IV 变化常是主要因素。' };
  }
  const roi = totalReturn / CONFIG.INITIAL_CASH;
  if (roi > 0.15 && maxDrawdown < 0.10) return { tone: 'excellent', text: '收益可观且回撤可控——风险收益比优秀，仓位与对冲纪律良好。' };
  if (roi > 0.15) return { tone: 'aggressive', text: '收益高但回撤较大。检查是否仓位过度集中、裸卖期权或未对冲事件风险。' };
  return { tone: 'steady', text: '正收益且波动温和。可尝试轮式策略（卖认沽 → 接货 → 备兑）或事件对冲来提升效率。' };
}

const dayStart = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const signedCurrency = (value) => (value >= 0 ? '+' : '') + formatCurrency(value);
const signClass = (value) => (value >= 0 ? 'text-emerald-400' : 'text-rose-400');

function SensRow({ label, value }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-slate-400">{label}</span>
      <span className={`font-semibold ${signClass(value)}`}>{signedCurrency(value)}</span>
    </div>
  );
}

export default function Portfolio({ onTradeStockClick, onTradeOptionClick }) {
  const cash = useTradingStore(state => state.cash);
  const positions = useTradingStore(state => state.positions);
  const currentPrice = useTradingStore(state => state.currentStockPrice);
  const currentDate = useTradingStore(state => state.currentDate);
  const volatility = useTradingStore(state => state.volatility);
  const exerciseOption = useTradingStore(state => state.exerciseOption);
  const realizedPnl = useTradingStore(state => state.realizedPnl);
  const transactionLog = useTradingStore(state => state.transactionLog);
  const riskFreeRate = useTradingStore(state => state.riskFreeRate);
  const isMarginCall = useTradingStore(state => state.isMarginCall);
  const isExpired = useTradingStore(state => state.isExpired);

  // Calculate Unrealized PnL and Net Liq
  const pnlData = useMemo(() => {
    const reservedCash = calculateReservedCash(positions, currentPrice);
    const availableCash = cash - reservedCash;
    const stockValue = positions.stock * currentPrice;
    const stockUnrealized = positions.stock === 0
      ? 0
      : (currentPrice - positions.stockAveragePrice) * positions.stock;

    // Evaluate current option positions
    const evaluatedOptions = positions.options.map(opt => {
      const timeToExpiry = calculateTimeInYears(currentDate, opt.expiration);
      const daysToExpiration = getDaysToExpiration(currentDate, opt.expiration);
      let currentOptPrice = 0;
      let optDelta = 0;
      let optGamma = 0;
      let optTheta = 0;
      let optVega = 0;

      let termVol = volatility;
      if (timeToExpiry > 0) {
         termVol = getTermVolatility(timeToExpiry, volatility, currentPrice, opt.strike);
         const bs = calculateBlackScholes(currentPrice, opt.strike, timeToExpiry, riskFreeRate, termVol);
         currentOptPrice = opt.type === 'CALL' ? bs.callPrice : bs.putPrice;
         optDelta = opt.type === 'CALL' ? bs.callDelta : bs.putDelta;
         optGamma = bs.gamma;
         optTheta = opt.type === 'CALL' ? bs.callTheta : bs.putTheta;
         optVega = bs.vega;
      } else {
         // Expired state intrinsic value
         currentOptPrice = opt.type === 'CALL' 
            ? Math.max(0, currentPrice - opt.strike) 
            : Math.max(0, opt.strike - currentPrice);
         optDelta = opt.type === 'CALL' 
            ? (currentPrice > opt.strike ? 1 : 0)
            : (currentPrice < opt.strike ? -1 : 0);
      }
      
      const quote = calculateOptionQuote({
        theoreticalPrice: currentOptPrice,
        strike: opt.strike,
        spotPrice: currentPrice,
        daysToExpiration,
        delta: optDelta,
        volatility: termVol,
      });
      const markPrice = opt.quantity >= 0 ? quote.bid : quote.ask;
      const currentValue = markPrice * opt.quantity * OPTION_MULTIPLIER;
      const initialCost = opt.averagePrice * opt.quantity * OPTION_MULTIPLIER;
      const unrealizedPnL = currentValue - initialCost;

      // PnL attribution since the last snapshot (lastMark is refreshed by
      // the store on every trade and at every day-advance). First-order
      // decomposition: price (Delta x dS), time (Theta x days), vol (Vega x dIV).
      let attribution = null;
      if (opt.lastMark) {
        const prevT = calculateTimeInYears(opt.lastMark.date, opt.expiration);
        const prevTermVol = getTermVolatility(prevT, opt.lastMark.iv, opt.lastMark.spot, opt.strike);
        const prevBs = calculateBlackScholes(opt.lastMark.spot, opt.strike, prevT, riskFreeRate, prevTermVol);
        const prevTheo = opt.type === 'CALL' ? prevBs.callPrice : prevBs.putPrice;
        const prevQuote = calculateOptionQuote({
          theoreticalPrice: prevTheo,
          strike: opt.strike,
          spotPrice: opt.lastMark.spot,
          daysToExpiration: getDaysToExpiration(opt.lastMark.date, opt.expiration),
          delta: opt.type === 'CALL' ? prevBs.callDelta : prevBs.putDelta,
          volatility: prevTermVol,
        });
        const prevMark = opt.quantity >= 0 ? prevQuote.bid : prevQuote.ask;
        const prevValue = prevMark * opt.quantity * OPTION_MULTIPLIER;
        const daysElapsed = Math.round(
          (dayStart(currentDate).getTime() - dayStart(opt.lastMark.date).getTime()) / 86400000
        );
        const priceContrib = optDelta * (currentPrice - opt.lastMark.spot) * opt.quantity * OPTION_MULTIPLIER;
        const thetaContrib = optTheta * daysElapsed * opt.quantity * OPTION_MULTIPLIER;
        const vegaContrib = optVega * (volatility - opt.lastMark.iv) * 100 * opt.quantity * OPTION_MULTIPLIER;
        const totalChange = currentValue - prevValue;
        const residual = totalChange - (priceContrib + thetaContrib + vegaContrib);
        attribution = {
          priceContrib: roundMoney(priceContrib),
          thetaContrib: roundMoney(thetaContrib),
          vegaContrib: roundMoney(vegaContrib),
          residual: roundMoney(residual),
          total: roundMoney(totalChange),
        };
      }

      return {
        ...opt,
        theoreticalPrice: currentOptPrice,
        currentPrice: markPrice,
        quote,
        delta: optDelta,
        gamma: optGamma,
        theta: optTheta,
        vega: optVega,
        currentValue,
        unrealizedPnL,
        attribution
      };
    });

    const optionsValue = evaluatedOptions.reduce((total, opt) => total + opt.currentValue, 0);

    // Portfolio-level Greeks and first-order sensitivities (dollars)
    let portfolioDelta = positions.stock; // stock delta = shares
    let portfolioGamma = 0;
    let portfolioTheta = 0;
    let portfolioVega = 0;
    let attribPrice = 0;
    let attribTheta = 0;
    let attribVega = 0;
    let attribResidual = 0;
    evaluatedOptions.forEach(opt => {
      portfolioDelta += opt.delta * opt.quantity * OPTION_MULTIPLIER;
      portfolioGamma += opt.gamma * opt.quantity * OPTION_MULTIPLIER;
      portfolioTheta += opt.theta * opt.quantity * OPTION_MULTIPLIER;
      portfolioVega += opt.vega * opt.quantity * OPTION_MULTIPLIER;
      if (opt.attribution) {
        attribPrice += opt.attribution.priceContrib;
        attribTheta += opt.attribution.thetaContrib;
        attribVega += opt.attribution.vegaContrib;
        attribResidual += opt.attribution.residual;
      }
    });

    const dS = currentPrice * 0.01;
    const sensPrice = roundMoney(portfolioDelta * dS + 0.5 * portfolioGamma * dS * dS);
    const sensVol = roundMoney(portfolioVega * 5);
    const sensTime = roundMoney(portfolioTheta);
    const hasAttribution = Math.abs(attribPrice) + Math.abs(attribTheta) + Math.abs(attribVega) > 0.01;

    const netLiq = cash + stockValue + optionsValue;
    const totalUnrealized = netLiq - CONFIG.INITIAL_CASH;

    return {
      netLiq,
      totalUnrealized,
      stockValue,
      stockUnrealized,
      reservedCash,
      availableCash,
      evaluatedOptions,
      portfolioDelta,
      portfolioGamma,
      portfolioTheta,
      portfolioVega,
      sensPrice,
      sensVol,
      sensTime,
      attribPrice,
      attribTheta,
      attribVega,
      attribResidual,
      hasAttribution,
    };
  }, [positions, currentPrice, currentDate, volatility, riskFreeRate, cash]);

  // Get history runs from store
  const historyRuns = useTradingStore(state => state.historyRuns);

  // Scorecard state
  const [showScoreCard, setShowScoreCard] = useState(false);
  const [exerciseError, setExerciseError] = useState(null);

  // Equity curve for the scorecard (daily net-liq snapshots; reset-aware)
  const netWorthRef = useRef([]);
  const lastDateNumRef = useRef(null);
  useEffect(() => {
    const dateNum = currentDate.getMonth() * 100 + currentDate.getDate();
    if (lastDateNumRef.current != null && dateNum < lastDateNumRef.current) {
      netWorthRef.current = []; // simulation reset -> fresh equity curve
    }
    lastDateNumRef.current = dateNum;
    const key = `${currentDate.getMonth() + 1}/${currentDate.getDate()}`;
    const filtered = netWorthRef.current.filter(e => e.date !== key);
    filtered.push({ date: key, netWorth: pnlData.netLiq });
    netWorthRef.current = filtered;
  }, [currentDate, pnlData.netLiq]);
  const [scoreCard, setScoreCard] = useState(null);
  const openScoreCard = () => {
    setScoreCard(buildScoreCard(netWorthRef.current, transactionLog));
    setShowScoreCard(true);
  };

  // Early-exercise confirmation (shows the time-value cost vs selling)
  const [pendingExercise, setPendingExercise] = useState(null);
  const exerciseDetail = pendingExercise ? (() => {
    const exIntrinsic = getOptionIntrinsicValue(pendingExercise.type, currentPrice, pendingExercise.strike);
    const exTimeValue = Math.max(0, pendingExercise.theoreticalPrice - exIntrinsic);
    const exShares = pendingExercise.quantity * OPTION_MULTIPLIER;
    return {
      intrinsic: exIntrinsic,
      timeValue: exTimeValue,
      shares: exShares,
      strikeCash: roundMoney(pendingExercise.strike * exShares),
      lostByExercise: roundMoney(exTimeValue * pendingExercise.quantity * OPTION_MULTIPLIER),
      sellPnl: roundMoney((pendingExercise.currentPrice - pendingExercise.averagePrice)
        * pendingExercise.quantity * OPTION_MULTIPLIER),
    };
  })() : null;

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

      {isExpired && (
        <button
          onClick={openScoreCard}
          className="w-full mb-6 py-2.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 font-bold text-sm transition-colors"
        >
          📊 本轮模拟已结束 — 查看成绩单
        </button>
      )}

      {isMarginCall && (
        <div className="bg-rose-900/30 border border-rose-500/60 p-4 rounded-xl mb-6 flex items-start gap-3">
          <ShieldAlert size={20} className="text-rose-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-rose-300">追保警告 (Margin Call)</div>
            <div className="text-sm text-rose-200/90 mt-1">
              账户现金不足以覆盖保证金要求。当前仅允许减仓或平仓交易——请卖出部分持仓恢复偿付能力。
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1 flex items-center gap-1">
            <PieChart size={14} /> 净资产 (Net Liq)
          </p>
          <div className="text-2xl font-bold text-white">{formatCurrency(pnlData.netLiq)}</div>
        </div>
        
        <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1 flex items-center gap-1">
            <DollarSign size={14} /> 现金余额
          </p>
          <div className={`text-xl font-medium ${cash < 0 ? 'text-rose-400' : 'text-slate-200'}`}>{formatCurrency(cash)}</div>
        </div>

        <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1 flex items-center gap-1">
            <DollarSign size={14} /> 可用资金
          </p>
          <div className={`text-xl font-medium ${pnlData.availableCash >= 0 ? 'text-slate-200' : 'text-rose-400'}`}>
            {formatCurrency(pnlData.availableCash)}
          </div>
        </div>

        <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1 flex items-center gap-1">
            <ShieldCheck size={14} /> 保证金占用
          </p>
          <div className="text-xl font-medium text-amber-300">{formatCurrency(pnlData.reservedCash)}</div>
        </div>

        <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1 flex items-center gap-1">
            <ReceiptText size={14} /> 已实现盈亏
          </p>
          <div className={`text-xl font-bold ${realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {realizedPnl >= 0 ? '+' : ''}{formatCurrency(realizedPnl)}
          </div>
        </div>

        <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700 flex justify-between items-center">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1">总盈亏 (PnL)</p>
          <div className={`text-xl font-bold ${pnlData.totalUnrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {pnlData.totalUnrealized >= 0 ? '+' : ''}{formatCurrency(pnlData.totalUnrealized)}
          </div>
        </div>
      </div>

      {/* 组合风险 (Greeks) */}
      <div className="mb-8">
        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3 border-b border-slate-700 pb-2">组合风险 (Greeks)</h3>
        <div className="grid grid-cols-4 gap-2 mb-3">
          <div className="bg-slate-900/40 p-2.5 rounded-lg border border-slate-700/60 text-center">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Delta (股)</div>
            <div className="text-sm font-bold text-indigo-300">{formatGreeks(pnlData.portfolioDelta)}</div>
          </div>
          <div className="bg-slate-900/40 p-2.5 rounded-lg border border-slate-700/60 text-center">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Gamma</div>
            <div className="text-sm font-bold text-indigo-300">{formatGreeks(pnlData.portfolioGamma)}</div>
          </div>
          <div className="bg-slate-900/40 p-2.5 rounded-lg border border-slate-700/60 text-center">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Theta / 日</div>
            <div className="text-sm font-bold text-indigo-300">{formatGreeks(pnlData.portfolioTheta)}</div>
          </div>
          <div className="bg-slate-900/40 p-2.5 rounded-lg border border-slate-700/60 text-center">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Vega / 1%</div>
            <div className="text-sm font-bold text-indigo-300">{formatGreeks(pnlData.portfolioVega)}</div>
          </div>
        </div>
        <div className="bg-slate-900/30 border border-slate-700/60 rounded-lg p-3 space-y-2 text-sm">
          <SensRow label="股价 +1% 约" value={pnlData.sensPrice} />
          <SensRow label="IV +5% 约" value={pnlData.sensVol} />
          <SensRow label="持有 1 天约" value={pnlData.sensTime} />
          {pnlData.hasAttribution && (
            <div className="pt-2 mt-2 border-t border-slate-700/60">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1.5">今日持仓变动归因</div>
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-slate-400">股价 <span className={signClass(pnlData.attribPrice)}>{signedCurrency(pnlData.attribPrice)}</span></span>
                <span className="text-slate-400">时间 <span className={signClass(pnlData.attribTheta)}>{signedCurrency(pnlData.attribTheta)}</span></span>
                <span className="text-slate-400">波动率 <span className={signClass(pnlData.attribVega)}>{signedCurrency(pnlData.attribVega)}</span></span>
              </div>
              {Math.abs(pnlData.attribResidual) > 0.5 && (
                <div className="text-[11px] text-slate-600 mt-1">残差/高阶项 {signedCurrency(pnlData.attribResidual)}</div>
              )}
            </div>
          )}
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
                  <div className="text-xs text-slate-500">
                    成本: {formatCurrency(positions.stockAveragePrice)}
                  </div>
                </div>
                <div className="text-right">
                   <div className="font-semibold text-slate-200">{formatCurrency(Math.abs(positions.stock) * currentPrice)}</div>
                   <div className={`text-xs font-semibold ${pnlData.stockUnrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                     {pnlData.stockUnrealized >= 0 ? '+' : ''}{formatCurrency(pnlData.stockUnrealized)}
                   </div>
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
                  onClick={() => onTradeOptionClick && onTradeOptionClick({ type: opt.type, strike: opt.strike, price: opt.currentPrice, quote: opt.quote, expiration: opt.expiration, delta: opt.delta })}
                  className="bg-slate-700/30 p-3 rounded-lg flex justify-between items-center border border-slate-600/50 cursor-pointer hover:bg-slate-700/50 transition-colors"
                >
                  <div>
                    <div className="font-bold text-white flex items-center gap-2">
                       {opt.strike} 
                       <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${typeColor}`}>
                         {opt.type === 'CALL' ? '认购' : '认沽'}
                       </span>
                       <span className="text-xs text-slate-400 font-normal">
                         到期: {new Date(opt.expiration).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                       </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {Math.abs(opt.quantity)} 张 {opt.quantity > 0 ? '做多' : '做空'} @ 成本 {formatCurrency(opt.averagePrice)}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Bid {formatCurrency(opt.quote.bid)} / Ask {formatCurrency(opt.quote.ask)}
                    </div>
                    {opt.attribution && Math.abs(opt.attribution.total) > 0.005 && (
                      <div className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                        <span className="text-slate-500">当日归因 </span>
                        <span className={signClass(opt.attribution.priceContrib)}>股价 {signedCurrency(opt.attribution.priceContrib)}</span>
                        <span className="text-slate-600"> · </span>
                        <span className={signClass(opt.attribution.thetaContrib)}>时间 {signedCurrency(opt.attribution.thetaContrib)}</span>
                        <span className="text-slate-600"> · </span>
                        <span className={signClass(opt.attribution.vegaContrib)}>IV {signedCurrency(opt.attribution.vegaContrib)}</span>
                        {Math.abs(opt.attribution.residual) > 0.5 && (
                          <>
                            <span className="text-slate-600"> · </span>
                            <span className={signClass(opt.attribution.residual)}>高 {signedCurrency(opt.attribution.residual)}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex flex-col items-end gap-2">
                    <div>
                      <div className="font-semibold text-slate-200">{formatCurrency(Math.abs(opt.currentValue))}</div>
                      <div className="text-[11px] text-slate-500">Mark {formatCurrency(opt.currentPrice)}</div>
                      <div className={`text-xs font-semibold ${pnlColor}`}>
                        {opt.unrealizedPnL >= 0 ? '+' : ''}{formatCurrency(opt.unrealizedPnL)} PnL
                      </div>
                    </div>
                    {opt.quantity > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingExercise(opt);
                        }}
                        className="px-2 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors mt-1"
                      >
                        提前行权
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {transactionLog.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3 border-b border-slate-700 pb-2">最近交易流水</h3>
          <div className="space-y-2">
            {transactionLog.slice(0, 6).map((txn) => (
              <div key={txn.id} className="bg-slate-900/40 p-3 rounded-lg border border-slate-700/70">
                <div className="flex justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-200">{txn.action} · {txn.symbol}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {txn.date} · 数量 {txn.quantity} · 价格 {formatCurrency(txn.price)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-bold ${txn.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {txn.realizedPnl >= 0 ? '+' : ''}{formatCurrency(txn.realizedPnl)}
                    </div>
                    <div className="text-xs text-slate-500">费用 {formatCurrency(txn.fees)}</div>
                  </div>
                </div>
                {txn.note && <div className="text-xs text-slate-500 mt-2">{txn.note}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

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

      {showScoreCard && scoreCard && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowScoreCard(false)}
        >
          <div
            className="bg-slate-800 rounded-2xl border border-amber-500/30 w-full max-w-md shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-4 border-b border-slate-700 bg-slate-900/50">
              <h3 className="font-bold text-white flex items-center gap-2">
                <span className="text-lg">📊</span> 本轮成绩单
              </h3>
              <button onClick={() => setShowScoreCard(false)} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700 text-center">
                  <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">总盈亏</div>
                  <div className={"font-bold " + (scoreCard.totalReturn >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                    {signedCurrency(scoreCard.totalReturn)}
                    <span className="text-xs font-medium ml-1">({scoreCard.totalReturnPct >= 0 ? '+' : ''}{scoreCard.totalReturnPct.toFixed(2)}%)</span>
                  </div>
                </div>
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700 text-center">
                  <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">最大回撤</div>
                  <div className="font-bold text-rose-300">-{scoreCard.maxDrawdown.toFixed(2)}%</div>
                </div>
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700 text-center">
                  <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">交易笔数</div>
                  <div className="font-bold text-white">{scoreCard.trades}</div>
                </div>
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700 text-center">
                  <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">手续费合计</div>
                  <div className="font-bold text-white">{formatCurrency(scoreCard.fees)}</div>
                </div>
              </div>
              {scoreCard.eventRows.length > 0 && (
                <div>
                  <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1.5">事件日组合表现</div>
                  <div className="space-y-1">
                    {scoreCard.eventRows.map((e, i) => (
                      <div key={i} className="flex justify-between text-xs bg-slate-900/40 px-2.5 py-1.5 rounded-lg">
                        <span className="text-slate-300">{e.name}</span>
                        <span className={"font-semibold " + (e.dayChange >= 0 ? 'text-emerald-400' : 'text-rose-400')}>{signedCurrency(e.dayChange)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className={"p-3 rounded-lg text-sm leading-relaxed " + (scoreCard.grade.tone === 'excellent' ? 'bg-emerald-900/20 text-emerald-100 border border-emerald-500/30' : scoreCard.grade.tone === 'aggressive' ? 'bg-amber-900/20 text-amber-100 border border-amber-500/30' : scoreCard.grade.tone === 'steady' ? 'bg-indigo-900/20 text-indigo-100 border border-indigo-500/30' : 'bg-rose-900/20 text-rose-100 border border-rose-500/30')}>
                <span className="font-bold block mb-1">教练点评</span>
                {scoreCard.grade.text}
              </div>
              <button
                onClick={() => setShowScoreCard(false)}
                className="w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-bold text-white transition-colors"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingExercise && exerciseDetail && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPendingExercise(null)}
        >
          <div
            className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-md shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-4 border-b border-slate-700 bg-slate-900/50">
              <h3 className="font-bold text-white flex items-center gap-2">
                {pendingExercise.strike} {pendingExercise.type === 'CALL' ? '认购' : '认沽'} · 提前行权确认
              </h3>
              <button onClick={() => setPendingExercise(null)} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-slate-400">当前市价</span><span className="font-semibold text-white">{formatCurrency(currentPrice)}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">内在价值</span><span className="font-semibold text-white">{formatCurrency(exerciseDetail.intrinsic)}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">期权市价 (bid)</span><span className="font-semibold text-white">{formatCurrency(pendingExercise.currentPrice)}</span></div>
                <div className="flex justify-between"><span className="text-amber-300">其中时间价值</span><span className="font-bold text-amber-300">{formatCurrency(exerciseDetail.timeValue)}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">平仓收益 (按 bid)</span><span className={"font-bold " + (exerciseDetail.sellPnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}>{signedCurrency(exerciseDetail.sellPnl)}</span></div>
              </div>
              <div className="bg-indigo-900/20 border border-indigo-500/30 p-3 rounded-lg text-xs text-indigo-200 leading-relaxed">
                行权将以 {formatCurrency(pendingExercise.strike)} {pendingExercise.type === 'CALL' ? '买入' : '卖出'} {exerciseDetail.shares} 股
                （现金{pendingExercise.type === 'CALL' ? '流出' : '流入'} {formatCurrency(exerciseDetail.strikeCash)}），
                并<strong className="text-amber-300">立即损失时间价值 ≈ {formatCurrency(exerciseDetail.lostByExercise)}</strong>。
                期权到期前价值 = 内在价值 + 时间价值；提前行权只获得内在价值。
                除非急需股票本身，或深度实值且临近到期，否则<strong className="text-white">卖出平仓通常更优</strong>。
              </div>
              {exerciseError && (
                <div className="text-rose-400 bg-rose-400/10 px-3 py-2 rounded-lg text-xs font-bold text-center">
                  {exerciseError}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setPendingExercise(null)}
                  className="flex-1 py-3 rounded-lg bg-slate-700 hover:bg-slate-600 font-bold text-white transition-colors"
                >
                  取消（去平仓）
                </button>
                <button
                  onClick={() => {
                    const res = exerciseOption(pendingExercise.id);
                    if (res && !res.ok) {
                      setExerciseError(res.message);
                    } else {
                      setPendingExercise(null);
                      setExerciseError(null);
                    }
                  }}
                  className="flex-1 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-bold text-white transition-colors"
                >
                  确认行权
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
