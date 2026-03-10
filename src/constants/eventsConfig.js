// src/constants/eventsConfig.js

export const MACRO_EVENTS = {
  // Geopolitical Shock (Phase A & B logic handled in useMarketData)
  '4/2': {
    id: 'geo_conflict',
    name: '地缘政治冲突',
    type: 'geopolitical',
    description: 'A国对B国发动进攻，全球避险情绪升温！',
    color: '#ef4444', // red
    volatilityImpact: 0.10, // Pre-event anxiety
    isMultiDayShock: true, // Flag to trigger Phase A & B logic in MarketData
    results: [
      { type: 'Bearish', desc: '战争爆发，恐慌蔓延！', priceObj: { jump: 0.85 }, volCrush: 0 /* Volatility actually spikes, handled in post-event logic */ }
    ]
  },
  '3/5': {
    id: 'national_contract',
    name: '国家超大型订单',
    type: 'catalyst',
    description: '公司成功斩获国家级超大合同，营收预期翻番！',
    color: '#10b981', // emerald
    volatilityImpact: 0.20, // Pre-event speculation
    results: [
      { type: 'Bullish', desc: '合同细节超预期，机构疯狂扫货！', priceObj: { jump: 1.25 }, volCrush: 0.5 },
      { type: 'Bullish', desc: '重大突破，但市场已部分priced in', priceObj: { jump: 1.10 }, volCrush: 0.6 }
    ]
  },
  // Key matches the M/D string
  '3/20': {
    id: 'fomc_mar',
    name: 'FOMC (美联储议息会议)',
    type: 'fomc',
    description: '美联储利率决议及点阵图发布',
    color: '#3b82f6', // blue
    volatilityImpact: 0.15, // Pre-event vol bump
    results: [
      { type: 'Bullish', desc: '美联储鸽派发声，暗示降息提前', priceObj: { jump: 1.05 }, volCrush: 0.4, rateChange: -0.01 },
      { type: 'Bearish', desc: '美联储鹰派发声，打压降息预期', priceObj: { jump: 0.95 }, volCrush: 0.4, rateChange: 0.01 },
      { type: 'Neutral', desc: '符合市场预期，维持现状', priceObj: { jump: 1.0 }, volCrush: 0.5, rateChange: 0 }
    ]
  },
  '4/10': {
    id: 'cpi_apr',
    name: 'CPI 数据公布',
    type: 'cpi',
    description: '美国消费者物价指数(CPI)出炉',
    color: '#eab308', // yellow
    volatilityImpact: 0.10,
    results: [
      { type: 'Bullish', desc: 'CPI超预期降温，通胀受控', priceObj: { jump: 1.03 }, volCrush: 0.3 },
      { type: 'Bearish', desc: 'CPI超预期反弹，通胀粘性强', priceObj: { jump: 0.96 }, volCrush: 0.3 },
      { type: 'Neutral', desc: 'CPI符合预期', priceObj: { jump: 1.0 }, volCrush: 0.4 }
    ]
  },
  '4/15': {
    id: 'tock_earnings',
    name: 'TOCK Q1 财报',
    type: 'earnings',
    description: '主力产品超预期？还是指引疲软？',
    color: '#8b5cf6', // purple
    volatilityImpact: 0.25, // Massive IV expansion before earnings
    results: [
      { type: 'Bullish', desc: '财报大超预期，上调全年指引！', priceObj: { jump: 1.15 }, volCrush: 0.6 },
      { type: 'Bearish', desc: '业绩爆雷，利润大跌！', priceObj: { jump: 0.85 }, volCrush: 0.6 },
      { type: 'Neutral', desc: '业绩平平，缺乏亮点', priceObj: { jump: 1.0 }, volCrush: 0.7 }
    ]
  },
  '4/28': {
    id: 'gdp_apr',
    name: 'Q1 GDP初值',
    type: 'gdp',
    description: '美国第一季度GDP年化季率初值',
    color: '#ec4899', // pink
    volatilityImpact: 0.08,
    results: [
      { type: 'Bullish', desc: '经济强劲复苏，实现软着陆', priceObj: { jump: 1.02 }, volCrush: 0.2 },
      { type: 'Bearish', desc: '经济增速放缓，衰退担忧加剧', priceObj: { jump: 0.97 }, volCrush: 0.2 },
      { type: 'Neutral', desc: 'GDP增速符合预期', priceObj: { jump: 1.0 }, volCrush: 0.3 }
    ]
  }
};

/**
 * Helper to get MD format string from Date
 */
export const getDateStringMD = (dateObj) => {
  return `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
};

/**
 * Determine if upcoming days have an event to apply pre-event volatility expansion
 */
export const getUpcomingEventVolatilityImpact = (currentDateObj, lookaheadDays = 3) => {
  const checkDate = new Date(currentDateObj);
  let totalImpact = 0;
  
  for (let i = 1; i <= lookaheadDays; i++) {
    checkDate.setDate(checkDate.getDate() + 1);
    const md = getDateStringMD(checkDate);
    const evt = MACRO_EVENTS[md];
    if (evt) {
      // The closer the event, the higher the volatility expansion (e.g., 3 days out: 1/3, 1 day out: full impact)
      totalImpact += evt.volatilityImpact * (1 - (i - 1) / lookaheadDays);
    }
  }
  return totalImpact;
};
