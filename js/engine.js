export const INSTRUMENTS = {
  MNQ: { pointValue: 2, tickSize: 0.25, feePerContractSide: 0.95 },
  NQ: { pointValue: 20, tickSize: 0.25, feePerContractSide: 0 }
};

export const ACCOUNT_SIZES = [50,100,150,200,250,300,400];
export const STAGES = ["Evaluation","SIM","Live"];
export const ACCOUNT_STATUSES = ["Active","Paused","Closed","Replaced","Lost","Completed"];

export function roundToTick(value, tick=0.25, direction="nearest") {
  const n = value / tick;
  if (direction === "up") return Math.ceil(n - 1e-9) * tick;
  if (direction === "down") return Math.floor(n + 1e-9) * tick;
  return Math.round(n) * tick;
}

export function calculateTarget({instrument, direction, qty, avgEntry, targetAmount, bufferPoints=1, realized=0}) {
  const cfg = INSTRUMENTS[instrument];
  const remainingGoal = targetAmount - realized;
  if (!cfg || qty <= 0 || !Number.isFinite(avgEntry)) return {remainingGoal, requiredPoints:0, targetPrice:null};
  const requiredPoints = Math.max(0, remainingGoal) / (qty * cfg.pointValue) + (remainingGoal > 0 ? bufferPoints : 0);
  const raw = direction === "LONG" ? avgEntry + requiredPoints : avgEntry - requiredPoints;
  const targetPrice = roundToTick(raw, cfg.tickSize, direction === "LONG" ? "up" : "down");
  return { remainingGoal, requiredPoints, targetPrice, rawTarget: raw };
}

export function stopFromPoints(entry, points, direction, tick=0.25) {
  const raw = direction === "LONG" ? entry - points : entry + points;
  return roundToTick(raw, tick, "nearest");
}

export function stopPointsFromPrice(entry, stop) {
  return Math.abs(entry - stop);
}

export function riskMetrics({instrument, direction, qty, avgEntry, stopPrice, targetPrice}) {
  const cfg = INSTRUMENTS[instrument];
  if (!cfg || !qty || !avgEntry || !stopPrice) return {riskPoints:0,riskPerAccount:0,rewardPoints:0,rr:0};
  const riskPoints = Math.abs(avgEntry - stopPrice);
  const riskPerAccount = riskPoints * qty * cfg.pointValue;
  const rewardPoints = targetPrice == null ? 0 : Math.abs(targetPrice - avgEntry);
  const rr = riskPoints > 0 ? rewardPoints / riskPoints : 0;
  return {riskPoints,riskPerAccount,rewardPoints,rr};
}

export function replayTrade(trade) {
  const cfg = INSTRUMENTS[trade.instrument];
  let qty = 0;
  let avgEntry = 0;
  let grossRealizedPerAccount = 0;
  let commissionPerAccount = 0;
  let realizedPerAccount = 0; // Net P&L after actual fees
  let currentStopPrice = Number(trade.stopPrice || 0);
  const timeline = [];
  // Buffer points are only for target planning. Fees are independent.
  const feePerContractSide = Math.max(0, Number(trade.feePerContractSide ?? cfg?.feePerContractSide ?? 0));

  const events = [...(trade.events || [])].sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
  for (const ev of events) {
    const q = Number(ev.qtyPerAccount || 0);
    const price = Number(ev.price || 0);
    let eventGross = 0;
    let eventCommission = 0;
    let eventRealized = 0;

    if (["INITIAL","ADD"].includes(ev.type)) {
      const newQty = qty + q;
      avgEntry = newQty > 0 ? ((avgEntry * qty) + (price * q)) / newQty : 0;
      qty = newQty;
    } else if (ev.type === "STOP_UPDATE") {
      currentStopPrice = price;
    } else if (["REDUCE","CLOSE"].includes(ev.type)) {
      const closeQty = Math.min(q, qty);
      const points = trade.direction === "LONG" ? price - avgEntry : avgEntry - price;
      eventGross = points * closeQty * cfg.pointValue;
      eventCommission = feePerContractSide * closeQty * 2; // entry + exit execution sides
      eventRealized = eventGross - eventCommission;
      grossRealizedPerAccount += eventGross;
      commissionPerAccount += eventCommission;
      realizedPerAccount += eventRealized;
      qty -= closeQty;
      if (qty <= 0) { qty = 0; avgEntry = 0; }
    }

    const target = calculateTarget({
      instrument: trade.instrument,
      direction: trade.direction,
      qty,
      avgEntry,
      targetAmount: trade.targetPerAccount,
      bufferPoints: trade.bufferPoints,
      realized: realizedPerAccount
    });
    const remainingPointsFromEvent = qty > 0 && target.targetPrice != null
      ? (trade.direction === "LONG" ? target.targetPrice - price : price - target.targetPrice)
      : 0;

    timeline.push({
      ...ev,
      eventGross,
      eventCommission,
      eventRealized,
      qtyAfter: qty,
      avgEntryAfter: avgEntry,
      grossRealizedAfter: grossRealizedPerAccount,
      commissionAfter: commissionPerAccount,
      realizedAfter: realizedPerAccount,
      remainingGoalAfter: target.remainingGoal,
      targetPriceAfter: target.targetPrice,
      requiredPointsAfter: target.requiredPoints,
      remainingPointsFromEvent: Math.max(0, remainingPointsFromEvent),
      stopPriceAfter: currentStopPrice
    });
  }

  const target = calculateTarget({
    instrument: trade.instrument,
    direction: trade.direction,
    qty,
    avgEntry,
    targetAmount: trade.targetPerAccount,
    bufferPoints: trade.bufferPoints,
    realized: realizedPerAccount
  });
  const risk = riskMetrics({instrument:trade.instrument,direction:trade.direction,qty,avgEntry,stopPrice:currentStopPrice,targetPrice:target.targetPrice});
  const accountCount = (trade.allocations || []).reduce((s,a)=>s + Number(a.accountIds?.length || a.accountCount || 0),0);
  return {
    qty, avgEntry,
    grossRealizedPerAccount,
    commissionPerAccount,
    realizedPerAccount,
    timeline, target, risk,
    accountCount,
    portfolioGrossRealized: grossRealizedPerAccount * accountCount,
    portfolioCommission: commissionPerAccount * accountCount,
    portfolioRealized: realizedPerAccount * accountCount,
    portfolioTarget: trade.targetPerAccount * accountCount,
    portfolioRisk: risk.riskPerAccount * accountCount,
    currentStopPrice
  };
}

export function groupActiveAccounts(state) {
  const companyMap = Object.fromEntries((state.companies||[]).map(c=>[c.id,c]));
  const groups = new Map();
  for (const a of state.accounts || []) {
    if (a.status !== "Active") continue;
    const key = [a.companyId,a.sizeK,a.stage].join("|");
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        companyId:a.companyId,
        companyName:companyMap[a.companyId]?.name || a.companyId,
        sizeK:a.sizeK,
        stage:a.stage,
        accounts:[]
      });
    }
    groups.get(key).accounts.push(a);
  }
  return [...groups.values()].sort((a,b)=>a.companyName.localeCompare(b.companyName));
}

export function nextTradeId(state, dateStr) {
  const compact = (dateStr || new Date().toISOString().slice(0,10)).replaceAll("-","");
  const sameDay = (state.trades||[]).filter(t=>t.date === dateStr).length + 1;
  return `TR-${compact}-${String(sameDay).padStart(3,"0")}`;
}

export function newId(prefix="ID") {
  if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function formatTime(iso, zone) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {hour:"2-digit",minute:"2-digit",hour12:false,timeZone:zone}).format(new Date(iso));
}

export function todayRiyadh() {
  const parts = new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Riyadh",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const m = Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}
