import { useTradingStore } from '../store/useTradingStore';
import { ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Label } from 'recharts';
import { TrendingUp, TrendingDown, Info, ShieldAlert, Cpu, Award } from 'lucide-react';
import { formatCurrency } from '../utils/formatters';
import { useRef, useEffect, useState } from 'react';

// Custom shape for candlestick chart matching Recharts API
const Candlestick = (props) => {
  const {
    x, y, width, height, payload,
  } = props;
  
  const { open, close, high, low } = payload;
  const isGrowing = close >= open;
  const color = isGrowing ? '#10b981' : '#f43f5e'; // emerald-500, rose-500
  
  // y and height are calculated for [open, close] based on y-axis scale automatically when using data array
  // We just need to draw the wick from high to low manually
  const halfWidth = width / 2;
  
  // To draw the wick, we need to locate the high and low on the Y axis, 
  // but Recharts already gives us the scaled bounding box of the body (y and y+height)
  // We can calculate scale using the body values
  const priceDiff = Math.abs(open - close);
  const pixelsPerDollar = priceDiff > 0 ? height / priceDiff : 0;
  
  const highY = y - (high - Math.max(open, close)) * pixelsPerDollar;
  const lowY = y + height + (Math.min(open, close) - low) * pixelsPerDollar;

  return (
    <g stroke={color} fill={isGrowing ? 'transparent' : color} strokeWidth="2">
      <path d={`M${x + halfWidth},${highY} L${x + halfWidth},${lowY}`} />
      <rect x={x} y={height < 0 ? y + height : y} width={width} height={Math.abs(height) || 1} />
    </g>
  );
};

export default function MarketChart() {
  const priceHistory = useTradingStore(state => state.priceHistory);
  const currentPrice = useTradingStore(state => state.currentStockPrice);
  const startPrice = priceHistory[0]?.price || currentPrice;
  
  const priceChange = currentPrice - startPrice;
  const priceChangePercent = (priceChange / startPrice) * 100;
  const isPositive = priceChange >= 0;

  const [showLore, setShowLore] = useState(false);

  // Prepare data for composing candlestick and volume
  const chartData = priceHistory.map(d => ({
    ...d,
    ohlc: [d.open, d.close] // This gives Recharts the body bounds for the custom shape
  }));

  const scrollContainerRef = useRef(null);

  // Auto-scroll to the right whenever data changes
  useEffect(() => {
    if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollLeft = scrollContainerRef.current.scrollWidth;
    }
  }, [chartData.length]);

  // Make the chart width proportional to the number of days so that 30 days exactly fits the container view.
  const visibleDays = 30;
  const chartWidthPercent = Math.max(100, (chartData.length / visibleDays) * 100);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-slate-900 border border-slate-700 p-3 rounded-xl shadow-xl space-y-1">
          <p className="text-slate-400 text-sm mb-2">{label}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-slate-400">开盘价</span><span className="text-white font-medium">{formatCurrency(data.open)}</span>
            <span className="text-slate-400">最高价</span><span className="text-emerald-400 font-medium">{formatCurrency(data.high)}</span>
            <span className="text-slate-400">最低价</span><span className="text-rose-400 font-medium">{formatCurrency(data.low)}</span>
            <span className="text-slate-400">收盘价</span><span className="text-indigo-400 font-bold">{formatCurrency(data.close)}</span>
            <span className="text-slate-400 mt-1">成交量</span><span className="text-amber-400 font-medium mt-1">{(data.volume / 1000).toFixed(1)}k</span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg flex flex-col h-full w-full">
      <div className="flex justify-between items-start mb-6 relative">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 
              className="text-xl font-bold text-white flex items-center gap-2 cursor-pointer hover:text-indigo-300 transition-colors"
              onClick={() => setShowLore(!showLore)}
            >
              TOCK 实时走势
              <Info size={18} className={`${showLore ? 'text-indigo-400' : 'text-slate-400'}`} />
            </h2>
          </div>
          
          {showLore && (
            <div className="absolute top-8 left-0 z-50 w-[420px] bg-slate-900 border border-indigo-500/30 rounded-xl shadow-2xl p-5 mt-2 animate-in fade-in zoom-in-95 duration-200">
              <h3 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-emerald-400 mb-2 border-b border-slate-800 pb-2">
                TOCK (泰坦半导体动力科技)
              </h3>
              <p className="text-sm text-slate-300 mb-4 leading-relaxed">
                一家深耕下一代半导体晶圆制造与尖端消费电子组装的<strong className="text-white">顶尖高新科技企业</strong>。由于身处全球供应链的核心咽喉，其股价对宏观事件极其敏感。
              </p>
              
              <div className="space-y-3">
                <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-amber-400 mb-1"><Cpu size={16} /> 美联储利率 (FOMC)</h4>
                  <p className="text-xs text-slate-400">作为资本密集型科技股，TOCK的估值受利率严重压制。降息是强力催化剂，加息则重挫估值体系。</p>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-rose-400 mb-1"><ShieldAlert size={16} /> 地缘冲突与断供</h4>
                  <p className="text-xs text-slate-400">主营海外高端制造，对地缘冲突极为敏感。一旦出现断供风险，股价会遭受重缩并引发恐慌性期权抢筹 (IV极速扩张)。</p>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-emerald-400 mb-1"><Award size={16} /> 业绩与超大合同</h4>
                  <p className="text-xs text-slate-400">凭借核心技术壁垒，若斩获国家级超大订单或财报大超预期，能瞬间扭转颓势，带来极其暴力的向上跳空 (Gap-up)。</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-end gap-3 mt-2">
            <span className="text-3xl font-bold text-slate-100">{formatCurrency(currentPrice)}</span>
            <span className={`flex items-center text-sm font-semibold mb-1 ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isPositive ? <TrendingUp size={16} className="mr-1" /> : <TrendingDown size={16} className="mr-1" />}
              {isPositive ? '+' : ''}{formatCurrency(priceChange)} ({Math.abs(priceChangePercent).toFixed(2)}%)
            </span>
          </div>
        </div>
      </div>
      
      <div 
        ref={scrollContainerRef}
        className="flex-1 min-h-[300px] overflow-x-auto overflow-y-hidden custom-scrollbar"
      >
        <div style={{ width: `${chartWidthPercent}%`, minWidth: '100%', height: '100%' }} className="flex flex-col gap-1 relative pr-4">
          <ResponsiveContainer width="100%" height="80%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis 
                dataKey="date" 
                hide
              />
              <YAxis 
                stroke="#94a3b8" 
                tick={{ fill: '#94a3b8', fontSize: 12 }}
                domain={['dataMin - 5', 'dataMax + 5']}
                tickFormatter={(val) => `$${val}`}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#475569', strokeDasharray: '3 3' }} />
              <Bar dataKey="ohlc" shape={<Candlestick />} isAnimationActive={false} />
              
              {chartData.filter(d => d.event).map((d, index) => (
                 <ReferenceLine 
                   key={`event-${index}`} 
                   x={d.date} 
                   stroke={d.eventColor || '#f59e0b'} 
                   strokeDasharray="3 3"
                 >
                   <Label value={d.event} position="insideTopLeft" fill={d.eventColor || '#f59e0b'} offset={10} fontSize={12} />
                 </ReferenceLine>
              ))}
            </ComposedChart>
          </ResponsiveContainer>
          
          <ResponsiveContainer width="100%" height="20%">
             <ComposedChart data={chartData} margin={{ top: 0, right: 5, left: -20, bottom: 0 }}>
              <XAxis 
                dataKey="date" 
                stroke="#94a3b8" 
                tick={{ fill: '#94a3b8', fontSize: 12 }}
                tickFormatter={(val) => {
                  const date = new Date(val);
                  return `${date.getMonth() + 1}/${date.getDate()}`;
                }}
                minTickGap={20}
              />
              <YAxis hide domain={[0, 'auto']} />
              <Bar dataKey="volume" fill="#475569" isAnimationActive={false}>
              </Bar>
             </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
