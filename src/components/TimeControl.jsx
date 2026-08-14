import { useTradingStore } from '../store/useTradingStore';
import { useMarketData } from '../hooks/useMarketData';
import { CONFIG } from '../constants/config';
import { Play, FastForward, AlertTriangle, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import { MACRO_EVENTS, getDateStringMD } from '../constants/eventsConfig';

export default function TimeControl() {
  const currentDate = useTradingStore(state => state.currentDate);
  const isExpired = useTradingStore(state => state.isExpired);
  const { simulateNextDay } = useMarketData();
  const [eventMsg, setEventMsg] = useState('');

  const resetSimulation = useTradingStore(state => state.resetSimulation);
  const simulationSeed = useTradingStore(state => state.simulationSeed);

  const handleNextDay = () => {
    const isEvent = simulateNextDay();
    if (isEvent) {
      setEventMsg(isEvent.message || '突发事件！市场剧烈波动！');
      setTimeout(() => setEventMsg(''), 4000);
    }
  };

  // Nearest macro event from today (used by the fast-forward button)
  const nextEventInfo = useMemo(() => {
    const d = new Date(currentDate);
    for (let i = 1; i <= 40; i++) {
      d.setDate(d.getDate() + 1);
      const md = getDateStringMD(d);
      const evt = MACRO_EVENTS[md];
      if (evt) return { date: new Date(d), name: evt.name, days: i };
    }
    return null;
  }, [currentDate]);

  const handleJumpToNextEvent = () => {
    if (!nextEventInfo) return;
    const target = nextEventInfo.date;
    let guard = 0;
    while (guard < 62) {
      const ev = simulateNextDay();
      if (ev) {
        setEventMsg(ev.message || '突发事件！市场剧烈波动！');
      }
      const s = useTradingStore.getState();
      if (s.isExpired) break;
      const cur = s.currentDate;
      if (cur.getFullYear() === target.getFullYear() &&
          cur.getMonth() === target.getMonth() &&
          cur.getDate() === target.getDate()) break;
      guard++;
    }
  };

  const endDate = new Date(CONFIG.END_DATE);
  
  return (
    <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-col sm:flex-row justify-between items-center gap-4 mb-6 shadow-lg">
      <div className="flex items-center gap-6">
        <div>
          <h2 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">当前日期</h2>
          <div className="text-2xl font-bold text-white flex items-center gap-2">
            {currentDate.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric' })}
            {isExpired && <span className="text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded">已到期结算</span>}
          </div>
        </div>
        
        <div className="hidden sm:block h-10 w-px bg-slate-700"></div>
        
        <div>
          <h2 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">到期日</h2>
          <div className="text-lg font-medium text-slate-300">
            {endDate.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 w-full sm:w-auto">
        <span
          className="text-[11px] text-slate-500 hidden lg:inline"
          title="本局行情随机种子：重跑本局行情会复用此种子生成完全相同的价格路径"
        >
          种子 {simulationSeed}
        </span>
        {eventMsg && (
          <div className="flex items-center gap-2 text-amber-400 bg-amber-400/10 px-3 py-1.5 rounded-lg text-sm animate-pulse">
            <AlertTriangle size={16} />
            {eventMsg}
          </div>
        )}
        
        <button
          onClick={() => resetSimulation(false)}
          title="生成全新的随机行情路径"
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all shadow-md bg-slate-700 hover:bg-slate-600 text-white"
        >
          重新开始
        </button>
        <button
          onClick={() => resetSimulation(true)}
          title="使用相同种子重放完全相同的行情路径，用于对比不同策略"
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all shadow-md bg-slate-800 hover:bg-slate-600 text-slate-300 border border-slate-600"
        >
          重跑本局行情
        </button>

        {nextEventInfo && !isExpired && (
          <button
            onClick={handleJumpToNextEvent}
            title={`快进 ${nextEventInfo.days} 天至 ${nextEventInfo.name}（${nextEventInfo.date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}）`}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all shadow-md bg-slate-800 hover:bg-amber-600/80 hover:text-white text-amber-300 border border-amber-500/30"
          >
            <Zap size={16} />
            快进至{nextEventInfo.name}
          </button>
        )}

        <button
          onClick={handleNextDay}
          disabled={isExpired}
          className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all shadow-md ${
            isExpired 
              ? 'bg-slate-700 text-slate-500 cursor-not-allowed' 
              : 'bg-indigo-600 hover:bg-indigo-500 text-white hover:shadow-indigo-500/25 active:scale-95'
          }`}
        >
          {isExpired ? (
            <>模拟结束</>
          ) : (
            <>
              进入下一天 <FastForward size={18} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
