import { useTradingStore } from '../store/useTradingStore';
import { useMarketData } from '../hooks/useMarketData';
import { CONFIG } from '../constants/config';
import { Play, FastForward, AlertTriangle } from 'lucide-react';
import { useState } from 'react';

export default function TimeControl() {
  const currentDate = useTradingStore(state => state.currentDate);
  const isExpired = useTradingStore(state => state.isExpired);
  const { simulateNextDay } = useMarketData();
  const [eventMsg, setEventMsg] = useState('');

  const resetSimulation = useTradingStore(state => state.resetSimulation);

  const handleNextDay = () => {
    const isEvent = simulateNextDay();
    if (isEvent) {
      setEventMsg(isEvent.message || '突发事件！市场剧烈波动！');
      setTimeout(() => setEventMsg(''), 4000);
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
        {eventMsg && (
          <div className="flex items-center gap-2 text-amber-400 bg-amber-400/10 px-3 py-1.5 rounded-lg text-sm animate-pulse">
            <AlertTriangle size={16} />
            {eventMsg}
          </div>
        )}
        
        <button
          onClick={resetSimulation}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition-all shadow-md bg-slate-700 hover:bg-slate-600 text-white"
        >
          重新开始
        </button>

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
