import { X, BookOpen, ShieldCheck, TrendingUp, AlertCircle, DollarSign } from 'lucide-react';
import { useState } from 'react';

export default function TutorialModal({ onClose }) {
  const [activeTab, setActiveTab] = useState('basics');

  const tabs = [
    { id: 'basics', label: '期权基础' },
    { id: 'protective-put', label: '保护性认沽' },
    { id: 'covered-call', label: '备兑认购' },
    { id: 'cash-secured-put', label: '现金担保认沽' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div 
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-5 border-b border-slate-800 bg-slate-900/80 sticky top-0 z-10">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <BookOpen size={24} className="text-indigo-400" />
            期权交易策略指南
          </h2>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors bg-slate-800 hover:bg-slate-700 p-2 rounded-lg"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex border-b border-slate-800 bg-slate-800/30">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                activeTab === tab.id 
                  ? 'text-indigo-400 border-b-2 border-indigo-400 bg-indigo-500/10' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/30'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6 overflow-y-auto space-y-6 text-slate-300">
          {activeTab === 'basics' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 shadow-md">
                <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                  <span className="bg-indigo-500/20 text-indigo-400 p-1.5 rounded-lg">🤔</span> 什么是期权？
                </h3>
                <p className="mb-4 leading-relaxed">
                  期权是一种合约，赋予持有人在特定日期（到期日）或之前，以特定价格（行权价）买入或卖出特定数量标的资产（如股票）的权利（但不是义务）。
                </p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="bg-emerald-900/20 border border-emerald-900/50 p-4 rounded-lg">
                    <h4 className="font-bold text-emerald-400 mb-2">认购期权 (Call)</h4>
                    <p className="text-sm">预期股票会上涨。买入认购期权让你有权以锁定低价买入股票。</p>
                  </div>
                  <div className="bg-rose-900/20 border border-rose-900/50 p-4 rounded-lg">
                    <h4 className="font-bold text-rose-400 mb-2">认沽期权 (Put)</h4>
                    <p className="text-sm">预期股票会下跌。买入认沽期权让你有权以锁定高价卖出股票（做空保护）。</p>
                  </div>
                </div>
              </div>

              <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 shadow-md">
                <h3 className="text-lg font-bold text-white mb-3">关键参数</h3>
                <ul className="space-y-3">
                  <li className="flex gap-3">
                    <span className="font-bold text-amber-400 shrink-0">行权价 (Strike):</span> 
                    <span>你可以买入或卖出股票的预定价格。</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-bold text-indigo-400 shrink-0">到期日 (Expiration):</span> 
                    <span>期权在这个日期之后作废。离到期越近，时间价值流失越快。</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-bold text-blue-400 shrink-0">隐含波动率 (IV):</span> 
                    <span>市场对未来波动的预期。突发事件会导致IV飙升，从而推高所有期权的价格。事件结束后IV会"崩塌" (IV Crush)，导致期权迅速贬值。</span>
                  </li>
                </ul>
              </div>

              <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 shadow-md">
                <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                  <span className="bg-rose-500/20 text-rose-400 p-1.5 rounded-lg">⚖️</span> 买方 vs 卖方 (权利与义务)
                </h3>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-bold text-emerald-400 mb-1">作为买方 (买入开仓):</h4>
                    <p className="text-sm">支付权利金，获得权利。如果股价对你有利，你可以行使权利获得收益；如果不利，你最多损失支付的全部权利金。</p>
                  </div>
                  <div>
                    <h4 className="font-bold text-rose-400 mb-1">作为卖方 (卖出开仓):</h4>
                    <p className="text-sm mb-2">收取权利金，<strong className="text-white">承担义务</strong>。如果买方要求行权，你必须履行合约：</p>
                    <ul className="list-disc list-inside space-y-1 text-xs text-slate-400 pl-2">
                      <li><strong className="text-slate-200 font-semibold">卖出认购 (Short Call)</strong>: 你有义务以行权价<strong className="text-rose-300">卖出</strong>股票。</li>
                      <li><strong className="text-slate-200 font-semibold">卖出认沽 (Short Put)</strong>: 你有义务以行权价<strong className="text-emerald-300">买入</strong>股票。</li>
                    </ul>
                    <p className="text-xs text-slate-400 mt-2 italic">※ 卖方风险通常高于买方，因为你处于被动接受行权的一方。</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'protective-put' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 shadow-md">
                <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                  <ShieldCheck className="text-emerald-400" /> 保护性认沽期权 (Protective Put)
                </h3>
                <p className="mb-4 leading-relaxed">
                  相当于为你的股票买一份“保险”。当你持有股票，但担心市场即将暴跌（例如财报发布、地缘冲突前夕），你可以买入认沽期权来对冲风险。
                </p>
                <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 mb-4">
                  <h4 className="font-bold text-slate-200 mb-2">🎓 策略组成</h4>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li><span className="text-emerald-400">买入正股</span> (Long Stock)</li>
                    <li><span className="text-rose-400">买入认沽期权</span> (Long Put)</li>
                  </ul>
                </div>
                
                <h4 className="font-bold text-slate-200 mb-2">📈 收益特征</h4>
                <ul className="space-y-2 text-sm">
                  <li className="flex gap-2">
                    <span className="text-rose-400 font-bold shrink-0">最大亏损:</span> 有限。最多亏损等于 (股票买入价 - 期权行权价) + 期权费。股价哪怕跌到0，你都可以按照行权价把股票卖出（点击投资组合中的"提前行权"）。
                  </li>
                  <li className="flex gap-2">
                    <span className="text-emerald-400 font-bold shrink-0">最大盈利:</span> 无限。如果股价暴涨，你可以放弃行权期权（损失一点期权费），充分享受股票上涨的红利。
                  </li>
                </ul>
              </div>
              
              <div className="bg-blue-900/20 border border-blue-800/50 p-4 rounded-lg flex items-start gap-3">
                <AlertCircle className="text-blue-400 mt-0.5 shrink-0" size={18} />
                <p className="text-sm text-blue-200">
                  <strong>实战提示：</strong> 在地缘冲突前夕，市场恐慌情绪上升，会推高期权的隐匿波动率（期权变贵）。如果你已经持有股票，购买认沽期权可以完美避开暴跌，你可以随时点击“提前行权”锁定卖出价。
                </p>
              </div>
            </div>
          )}

          {activeTab === 'covered-call' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 shadow-md">
                <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                  <TrendingUp className="text-indigo-400" /> 备兑认购开仓 (Covered Call)
                </h3>
                <p className="mb-4 leading-relaxed">
                  这是一种在横盘或温和牛市中增加收益的策略。当你持有股票，且认为短期内不会暴涨，你可以卖出认购期权（收取权利金/期权费），作为额外的“股息”收入。
                </p>
                <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 mb-4">
                  <h4 className="font-bold text-slate-200 mb-2">🎓 策略组成</h4>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li><span className="text-emerald-400">买入正股</span> (Long Stock) - 至少100股</li>
                    <li><span className="text-rose-400">卖出认购期权</span> (Short Call) - 收取期权费</li>
                  </ul>
                </div>
                
                <h4 className="font-bold text-slate-200 mb-2">📉 收益特征</h4>
                <ul className="space-y-2 text-sm">
                  <li className="flex gap-2">
                    <span className="text-emerald-400 font-bold shrink-0">额外收入:</span> 立即获得卖出期权的现金。如果到期时股价没有超过行权价，期权作废，你白赚这笔钱。
                  </li>
                  <li className="flex gap-2">
                    <span className="text-rose-400 font-bold shrink-0">风险/代价:</span> 限制了股价暴涨的收益上限（Upside Cap）。如果股价暴涨，超过行权价，你持有的股票会被以行权价强制买走（被行权），你无法享受超出行权价部分的利润。
                  </li>
                </ul>
              </div>

              <div className="bg-amber-900/20 border border-amber-800/50 p-4 rounded-lg flex items-start gap-3">
                <AlertCircle className="text-amber-400 mt-0.5 shrink-0" size={18} />
                <p className="text-sm text-amber-200">
                  <strong>实战提示：</strong> 在模拟器中，如果你卖出（做空）了一张认购期权，你无需点击“行权”，因为你是卖方，行权权在买方。如果到期日股价高于行权价，系统会自动以行权价卖出你的股票进行结算。如果你不想被强制卖出股票，可以在到期前"买入"相同的认购期权平仓 (Buy to Close)。
                </p>
              </div>
            </div>
          )}

          {activeTab === 'cash-secured-put' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 shadow-md">
                <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                  <DollarSign className="text-emerald-400" /> 现金担保认沽期权 (Cash-Secured Put)
                </h3>
                <p className="mb-4 leading-relaxed">
                  这是一种“低价买入”或“赚取收益”的双重策略。你通过卖出认沽期权并保留足够的现金，来承诺在未来的某个行权价买入股票。
                </p>
                <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 mb-4">
                  <h4 className="font-bold text-slate-200 mb-2">🎓 策略组成</h4>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li><span className="text-emerald-400">保留现金</span> (Cash) - 足够以行权价买入股票</li>
                    <li><span className="text-rose-400">卖出认沽期权</span> (Short Put) - 收取期权费</li>
                  </ul>
                </div>
                
                <h4 className="font-bold text-slate-200 mb-2">📉 收益特征</h4>
                <ul className="space-y-2 text-sm">
                  <li className="flex gap-2">
                    <span className="text-emerald-400 font-bold shrink-0">主要目标:</span> 获取期权费收入，或以比当前市价更低的价格（行权价 - 已收期权费）买入标的股票。
                  </li>
                  <li className="flex gap-2">
                    <span className="text-rose-400 font-bold shrink-0">风险:</span> 如果股价跌破行权价，你必须以行权价买入股票。这类似于你原本就打算在那个价格买入股票，但期权费降低了你的实际持仓成本。
                  </li>
                </ul>
              </div>

              <div className="bg-indigo-900/20 border border-indigo-800/50 p-4 rounded-lg flex items-start gap-3">
                <AlertCircle className="text-indigo-400 mt-0.5 shrink-0" size={18} />
                <p className="text-sm text-indigo-200">
                  <strong>实战提示：</strong> 这是著名的“轮式策略 (Wheel Strategy)”的第一步。如果被行权拿到了股票，下一步通常是针对这些股票进行“备兑认购 (Covered Call)”操作。
                </p>
              </div>
            </div>
          )}
        </div>
        
        <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-end">
          <button 
            onClick={onClose}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg transition-colors"
          >
            知道了，去实战
          </button>
        </div>
      </div>
    </div>
  );
}
