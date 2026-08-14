export const OPTION_MULTIPLIER = 100;
export const STOCK_TICKET_FEE = 1;
export const OPTION_CONTRACT_FEE = 0.65;

export function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getOptionIntrinsicValue(type, spotPrice, strike) {
  if (type === 'CALL') return Math.max(0, spotPrice - strike);
  return Math.max(0, strike - spotPrice);
}

export function calculateOptionQuote({
  theoreticalPrice,
  strike,
  spotPrice,
  daysToExpiration,
  delta,
  volatility,
}) {
  const safeTheo = Math.max(0, theoreticalPrice || 0);
  const distanceToStrike = Math.abs(spotPrice - strike) / Math.max(spotPrice, 0.01);
  const shortDteSpread = daysToExpiration <= 2 ? 0.08 : daysToExpiration <= 7 ? 0.05 : 0.025;
  const moneynessSpread = distanceToStrike * 0.35;
  const lowPremiumSpread = safeTheo < 0.25 ? 0.12 : safeTheo < 1 ? 0.06 : 0;
  const volatilitySpread = clamp((volatility || 0.3) * 0.05, 0.01, 0.08);
  const spreadRate = clamp(0.02 + shortDteSpread + moneynessSpread + lowPremiumSpread + volatilitySpread, 0.025, 0.8);
  const minimumSpread = daysToExpiration <= 2 ? 0.05 : 0.02;
  const halfSpread = Math.max(minimumSpread / 2, safeTheo * spreadRate / 2);

  let bid = Math.max(0, safeTheo - halfSpread);
  let ask = Math.max(0.01, safeTheo + halfSpread);

  if (distanceToStrike > 0.2 && daysToExpiration <= 2 && Math.abs(delta || 0) < 0.08) {
    // Deep-OTM near expiry still quotes at pennies (not zero): the market
    // maker keeps a one-penny bid instead of refusing to quote.
    bid = 0.01;
    ask = Math.max(ask, 0.05);
  }

  bid = roundMoney(bid);
  ask = roundMoney(Math.max(ask, bid + 0.01));

  return {
    bid,
    ask,
    mid: roundMoney((bid + ask) / 2),
    spread: roundMoney(ask - bid),
  };
}

export function calculateStockPositionAfterTrade(currentQuantity, averagePrice, tradeQuantity, tradePrice) {
  const nextQuantity = currentQuantity + tradeQuantity;

  if (currentQuantity === 0 || Math.sign(currentQuantity) === Math.sign(tradeQuantity)) {
    const totalShares = Math.abs(currentQuantity) + Math.abs(tradeQuantity);
    return {
      quantity: nextQuantity,
      averagePrice: totalShares === 0
        ? 0
        : roundMoney(((Math.abs(currentQuantity) * averagePrice) + (Math.abs(tradeQuantity) * tradePrice)) / totalShares),
      realizedPnl: 0,
    };
  }

  const closedShares = Math.min(Math.abs(currentQuantity), Math.abs(tradeQuantity));
  const realizedPnl = closedShares * (tradePrice - averagePrice) * Math.sign(currentQuantity);

  if (nextQuantity === 0) {
    return {
      quantity: 0,
      averagePrice: 0,
      realizedPnl: roundMoney(realizedPnl),
    };
  }

  return {
    quantity: nextQuantity,
    averagePrice: Math.sign(nextQuantity) === Math.sign(currentQuantity) ? averagePrice : tradePrice,
    realizedPnl: roundMoney(realizedPnl),
  };
}

/**
 * Reg-T style margin per contract for a short (naked) option.
 * Calls: 20% of underlying - OTM amount + premium (min 10% of underlying + premium).
 * Puts:  20% of strike - OTM amount + premium (min 10% of strike + premium).
 * (Real brokers also apply a per-contract floor; 100 USD is used here.)
 */
export function calculateOptionMarginPerContract(type, strike, spotPrice, premium) {
  const outOfTheMoney = type === 'PUT'
    ? Math.max(0, spotPrice - strike)
    : Math.max(0, strike - spotPrice);
  const reference = type === 'PUT' ? strike : spotPrice;
  const byUnderlyingRisk = (reference * 0.2 - outOfTheMoney + premium) * OPTION_MULTIPLIER;
  const minimumRisk = (reference * 0.1 + premium) * OPTION_MULTIPLIER;
  return Math.max(100, byUnderlyingRisk, minimumRisk);
}

/**
 * Resulting average price for an option series after a trade, mirroring the
 * store's ledger logic (used by the trade modal for the PnL diagram).
 */
export function calculateOptionAveragePrice(existingQty, existingAvg, tradeQty, tradePrice) {
  const netQty = existingQty + tradeQty;
  if (netQty === 0) return 0;
  if (existingQty === 0 || Math.sign(existingQty) === Math.sign(tradeQty)) {
    return (Math.abs(existingQty) * existingAvg + Math.abs(tradeQty) * tradePrice) / Math.abs(netQty);
  }
  return Math.sign(netQty) === Math.sign(existingQty) ? existingAvg : tradePrice;
}

function sampleCurve(lo, hi, count, pnlAt) {
  const points = [];
  for (let i = 0; i <= count; i++) {
    const s = lo + ((hi - lo) * i) / count;
    points.push({ s: roundMoney(s), pnl: roundMoney(pnlAt(s)) });
  }
  return points;
}

/**
 * Build the expiration PnL curve for the position that results from a trade:
 * the traded option series (existing position + trade) plus the stock leg.
 * Piecewise-linear, so extremes and break-evens are solved analytically.
 * Returns { flat, realizedPnl } when the trade fully closes the exposure.
 */
export function buildExpirationPnlCurve({
  type,            // 'CALL' | 'PUT' | null (null = stock-only trade)
  strike = 0,
  existingQty = 0,
  existingAvg = 0,
  tradeQty,
  tradePrice,
  stockQty = 0,
  stockAvg = 0,
  spot,
  fees = 0,
  sampleCount = 80,
}) {
  if (type === null || type === undefined) {
    const res = calculateStockPositionAfterTrade(stockQty, stockAvg, tradeQty, tradePrice);
    const qty = res.quantity;
    if (qty === 0) {
      return { flat: true, realizedPnl: roundMoney(res.realizedPnl - fees) };
    }
    const avg = res.averagePrice;
    const pnlAt = (s) => qty * (s - avg) - fees;
    const lo = Math.max(0, spot * 0.5);
    const hi = spot * 1.5;
    return {
      flat: false,
      points: sampleCurve(lo, hi, sampleCount, pnlAt),
      breakEvens: [roundMoney(avg + fees / qty)],
      maxGain: qty > 0 ? Infinity : roundMoney(pnlAt(0)),
      maxLoss: qty < 0 ? -Infinity : roundMoney(pnlAt(0)),
      includeStock: true,
    };
  }

  const netQty = existingQty + tradeQty;
  if (netQty === 0) {
    const realized = existingQty !== 0
      ? Math.abs(existingQty) * (tradePrice - existingAvg) * OPTION_MULTIPLIER * Math.sign(existingQty)
      : 0;
    return { flat: true, realizedPnl: roundMoney(realized - fees) };
  }

  const avg = calculateOptionAveragePrice(existingQty, existingAvg, tradeQty, tradePrice);
  const mult = OPTION_MULTIPLIER;
  const payoff = (s) => type === 'CALL'
    ? Math.max(0, s - strike)
    : Math.max(0, strike - s);
  const pnlAt = (s) => netQty * mult * (payoff(s) - avg) + stockQty * (s - stockAvg) - fees;

  // Piecewise linear: segment 1 = [0, strike], segment 2 = [strike, +inf)
  const m1 = (type === 'PUT' ? -netQty * mult : 0) + stockQty;
  const m2 = (type === 'CALL' ? netQty * mult : 0) + stockQty;
  const p0 = pnlAt(0);
  const pK = pnlAt(strike);

  const collect = (a, b, m) => {
    const pa = pnlAt(a);
    if (Math.abs(pa) < 1e-9) return [a];
    if (b === Infinity) {
      if (Math.abs(m) < 1e-9) return [];
      const s = a - pa / m;
      return s >= a ? [s] : [];
    }
    const pb = pnlAt(b);
    if (Math.abs(pb) < 1e-9) return [b];
    if (pa * pb > 0) return [];
    return [a + (-pa / (pb - pa)) * (b - a)];
  };
  const breakEvens = [...collect(0, strike, m1), ...collect(strike, Infinity, m2)]
    .map(s => roundMoney(s))
    .filter((s, i, arr) => arr.indexOf(s) === i) // dedupe
    .sort((a, b) => a - b);

  let maxGain = Math.max(p0, pK);
  let maxLoss = Math.min(p0, pK);
  if (m2 > 0) maxGain = Infinity;
  if (m2 < 0) maxLoss = -Infinity;

  const lo = Math.max(0, Math.min(spot * 0.5, strike * 0.6));
  const hi = Math.max(spot * 1.5, strike * 1.3);

  return {
    flat: false,
    points: sampleCurve(lo, hi, sampleCount, pnlAt),
    breakEvens,
    maxGain: maxGain === Infinity ? Infinity : roundMoney(maxGain),
    maxLoss: maxLoss === -Infinity ? -Infinity : roundMoney(maxLoss),
    includeStock: stockQty !== 0,
  };
}

export function calculateReservedCash(positions, spotPrice) {
  let reserved = 0;

  if (positions.stock < 0) {
    reserved += Math.abs(positions.stock) * spotPrice * 0.5;
  }

  let coveredCallContracts = Math.max(0, Math.floor(Math.max(0, positions.stock) / OPTION_MULTIPLIER));

  positions.options.forEach((option) => {
    if (option.quantity >= 0) return;

    const shortContracts = Math.abs(option.quantity);
    if (option.type === 'PUT') {
      reserved += shortContracts * calculateOptionMarginPerContract('PUT', option.strike, spotPrice, option.averagePrice || 0);
      return;
    }

    const coveredContracts = Math.min(coveredCallContracts, shortContracts);
    coveredCallContracts -= coveredContracts;
    const uncoveredContracts = shortContracts - coveredContracts;
    reserved += uncoveredContracts * calculateOptionMarginPerContract('CALL', option.strike, spotPrice, option.averagePrice || 0);
  });

  return roundMoney(reserved);
}
