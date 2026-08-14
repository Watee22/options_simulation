# 期权与股票交易模拟器

一个基于 React + Vite 的前端教学模拟器，用来演示股票价格路径、期权链报价、波动率变化、宏观事件冲击和基础期权策略。项目内置虚拟标的 `TOCK`，可在 2024-03-01 到 2024-04-30 的模拟窗口内逐日推进行情并进行股票、认购期权、认沽期权交易。

> 本项目仅用于教学和策略演练，不构成投资建议，也不模拟真实券商的完整保证金、撮合、结算和风控规则。

## 功能概览

- 股票价格模拟：使用几何布朗运动生成 OHLCV，并在前期用 Brownian Bridge 向锚定价格收敛。
- 期权定价：使用 Black-Scholes 计算认购/认沽价格与 Greeks，隐含波动率含期限结构与波动率微笑（Skew：OTM 认沽溢价，恐慌时倾斜加深）。
- 保证金模型：空头期权按 Reg-T 公式（20%×参考价 − 虚值 + 权利金，下限 10%）计算并展示明细，覆盖备兑认购。
- 可复现实验：行情由固定随机种子驱动，支持「重跑本局行情」重放完全相同的价格路径以对比不同策略。
- 动态期权链：按当前日期生成多个到期日，围绕现价动态生成行权价。
- 双边报价：期权链展示 bid / ask，买入按 ask 成交，卖出按 bid 成交。
- 宏观事件：内置合同、FOMC、CPI、财报、GDP、地缘冲突等事件，影响价格跳空、波动率和利率。
- 投资组合：展示现金余额、可用资金、保证金占用、净资产、PnL、股票持仓、期权持仓和历史模拟记录。
- 持仓账本：记录股票平均成本、期权平均权利金、已实现盈亏和最近交易流水。
- 交易弹窗：支持买入/卖出股票与期权，内置到期盈亏图（含现有同合约持仓与正股）、盈亏平衡点与最大盈亏，并模拟深度不足、价差和极端低 Delta 合约成交失败。
- 组合风险：组合级 Delta/Gamma/Theta/Vega 汇总、敏感性估算（股价 +1%、IV +5%、持有 1 天）与持仓 PnL 归因（股价/时间/波动率分解）。
- 到期处理：到期实值期权会进行股票交割，卖方可能被指派，虚值期权归零。
- 教学模式：提供提示模式和策略手册，覆盖保护性认沽、备兑认购、现金担保认沽等基础策略。
- 教学反馈：每笔成交后展示机制解释卡片（最大盈亏、盈亏平衡点、风险要点），拒绝成交时给出备选方案建议。
- 成绩单：模拟结束后生成本轮报告（总收益、最大回撤、手续费、事件日组合表现、教练点评）。
- 事件快进：一键快进至下一个宏观事件日，方便体验事件前后的 IV 变化。

## 技术栈

- React 19
- Vite 7
- Tailwind CSS 4
- Zustand
- Recharts
- lucide-react
- ESLint 9

## 快速开始

安装依赖：

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

项目配置了 GitHub Pages 子路径，开发环境默认访问：

```text
http://127.0.0.1:5173/options_simulation/
```

代码检查：

```bash
npm run lint
```

生产构建：

```bash
npm run build
```

本地预览构建产物：

```bash
npm run preview
```

## 部署

部署到 GitHub Pages：

```bash
npm run deploy
```

部署到 Gitee Pages：

```bash
npm run deploy-gitee
```

部署路径由 `vite.config.js` 中的 `base: '/options_simulation/'` 控制，`package.json` 中的 `homepage` 与 GitHub Pages 地址保持一致。

## 目录结构

```text
src/
  App.jsx                    页面布局与弹窗入口
  main.jsx                   React 挂载入口
  components/
    MarketChart.jsx          K 线与成交量图表
    OptionsChain.jsx         期权链和 Greeks 表格
    Portfolio.jsx            投资组合、持仓和历史记录
    TimeControl.jsx          日期推进和重置控制
    TradeModal.jsx           下单弹窗
    TutorialModal.jsx        策略教学手册
  constants/
    config.js                模拟窗口、初始资金、标的参数
    eventsConfig.js          宏观事件配置
  hooks/
    useMarketData.js         每日行情推进和事件冲击逻辑
  store/
    useTradingStore.js       Zustand 全局交易状态与交易动作
  utils/
    mathUtils.js             Black-Scholes、Greeks、价格路径生成
    optionPricing.js         期限结构 IV（期权链与持仓估值共用）
    formatters.js            金额、Greeks、到期时间格式化
```

## 核心流程

1. 应用启动后，`useTradingStore` 生成一段预热历史行情，并初始化现金、日期、波动率和持仓。
2. 点击“进入下一天”时，`useMarketData` 判断下一天是否有宏观事件或随机冲击。
3. 行情生成器根据当前价格、利率、波动率和事件状态生成下一日 OHLCV。
4. Store 推进日期，更新价格历史、波动率，并处理期权到期行权、指派或作废。
5. `OptionsChain` 根据当前价格、到期日和波动率重新计算理论价、bid / ask 和 Greeks。
6. 用户通过交易弹窗买卖股票或期权，成交后更新平均成本、已实现盈亏和交易流水。
7. `Portfolio` 按可清算价格重估净资产：多头期权按 bid 估值，空头期权按 ask 估值。

## 模拟限制

- 期权采用 Black-Scholes 理论价加简化价差模型，没有真实订单簿。
- 保证金规则是教学近似，不等同于真实券商风控或组合保证金。
- 到期行权和指派已模拟股票交割，但仍省略真实券商的提前指派概率、风控强平和交割失败处理。
- 股票持仓维护平均成本，但不保存完整逐笔 tax lot。
- 行情由可复现的随机种子驱动（种子显示在时间控制区），交易行为不消耗随机数，重跑本局行情可精确重放同一价格路径。

## 常用开发任务

修改基础参数：编辑 `src/constants/config.js`。

新增事件：编辑 `src/constants/eventsConfig.js`，按 `M/D` 日期字符串添加事件结果。

调整定价或行情模型：编辑 `src/utils/mathUtils.js`。

调整交易和结算行为：编辑 `src/store/useTradingStore.js` 与 `src/components/TradeModal.jsx`。

调整界面布局：从 `src/App.jsx` 和 `src/components/` 下的对应组件入手。
