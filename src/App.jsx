import { useState } from 'react';
import TimeControl from './components/TimeControl';
import MarketChart from './components/MarketChart';
import OptionsChain from './components/OptionsChain';
import Portfolio from './components/Portfolio';
import TradeModal from './components/TradeModal';
import TutorialModal from './components/TutorialModal';
import { useTradingStore } from './store/useTradingStore';
import { Activity, BookOpen } from 'lucide-react';

function App() {
  const [tradeDetails, setTradeDetails] = useState(null);
  const [showTutorial, setShowTutorial] = useState(false);
  
  const handleOptionTradeClick = (details) => {
    setTradeDetails(details);
  };
  
  const handleStockTradeClick = () => {
    setTradeDetails({ type: 'STOCK' });
  };
  
  const closeTradeModal = () => {
    setTradeDetails(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 p-4 md:p-8 font-sans selection:bg-indigo-500/30">
      <div className="max-w-[1600px] mx-auto space-y-6">
        
        {/* Header */}
        <header className="flex items-center gap-3 mb-8 pb-4 border-b border-slate-800">
          <div className="bg-indigo-500 p-2.5 rounded-xl shadow-lg shadow-indigo-500/20">
            <Activity size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-emerald-400">
              期权与股票交易模拟器
            </h1>
            <p className="text-slate-400 text-sm font-medium">前沿量化教学实盘推演系统</p>
          </div>
          <div className="ml-auto">
            <button 
              onClick={() => setShowTutorial(true)}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-lg font-medium border border-slate-700 transition-colors shadow-sm"
            >
              <BookOpen size={18} className="text-indigo-400" />
              策略演练手册
            </button>
          </div>
        </header>

        {/* Top Controls */}
        <TimeControl />

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-6">
            <div className="h-[430px]">
              <MarketChart />
            </div>
            <div className="h-[500px]">
              <OptionsChain onTradeClick={handleOptionTradeClick} />
            </div>
          </div>
          
          <div className="lg:col-span-4 h-full min-h-[500px]">
            <Portfolio 
               onTradeStockClick={handleStockTradeClick} 
               onTradeOptionClick={handleOptionTradeClick} 
            />
          </div>
        </div>

      </div>

      {/* Modals */}
      {tradeDetails && (
        <TradeModal 
          tradeDetails={tradeDetails} 
          onClose={closeTradeModal} 
        />
      )}
      
      {showTutorial && (
        <TutorialModal onClose={() => setShowTutorial(false)} />
      )}
    </div>
  );
}

export default App;
