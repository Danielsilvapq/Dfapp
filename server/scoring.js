// Pontuação automática de leads (0–100) e classificação de potencial.
// Ajuste os pesos aqui conforme a realidade da loja.

const WEIGHTS = {
  interest: { compra: 15, troca: 18, financiamento: 12, venda: 10, pesquisando: 0 },
  timeline: { imediato: 25, '30_dias': 18, '90_dias': 8, sem_previsao: 0 },
  payment: { avista: 20, financiado_entrada: 15, financiado_sem_entrada: 8, consorcio: 5, nao_sabe: 0 },
  hasPhone: 10,
  hasBudget: 8,
  hasVehicleInterest: 7,
  hasTradeIn: 5,
};

const LABELS = {
  interest: { compra: 'Compra', troca: 'Troca', venda: 'Quer vender o carro', financiamento: 'Financiamento', pesquisando: 'Só pesquisando' },
  payment: { avista: 'À vista', financiado_entrada: 'Financiado c/ entrada', financiado_sem_entrada: 'Financiado s/ entrada', consorcio: 'Consórcio', nao_sabe: 'Não sabe' },
  timeline: { imediato: 'Imediato (esta semana)', '30_dias': 'Até 30 dias', '90_dias': 'Até 90 dias', sem_previsao: 'Sem previsão' },
  classification: { quente: '🔥 QUENTE', morno: '🌤️ MORNO', frio: '❄️ FRIO' },
};

const THRESHOLDS = { quente: 60, morno: 35 };

function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }

function validPhone(phone) {
  const d = onlyDigits(phone);
  return d.length >= 10 && d.length <= 13;
}

function scoreLead(lead) {
  const reasons = [];
  let score = 0;
  const add = (pts, why) => { if (pts) { score += pts; reasons.push(`+${pts} ${why}`); } };

  add(WEIGHTS.interest[lead.interest] || 0, `interesse: ${LABELS.interest[lead.interest]}`);
  add(WEIGHTS.timeline[lead.timeline] || 0, `prazo: ${LABELS.timeline[lead.timeline]}`);
  add(WEIGHTS.payment[lead.payment] || 0, `pagamento: ${LABELS.payment[lead.payment]}`);
  if (validPhone(lead.phone)) add(WEIGHTS.hasPhone, 'tem WhatsApp');
  if (Number(lead.budget) > 0) add(WEIGHTS.hasBudget, 'informou orçamento');
  if (lead.vehicle_interest && String(lead.vehicle_interest).trim()) add(WEIGHTS.hasVehicleInterest, 'veículo definido');
  if (lead.trade_in_vehicle && String(lead.trade_in_vehicle).trim()) add(WEIGHTS.hasTradeIn, 'tem veículo para troca/venda');

  score = Math.min(100, score);
  const classification = score >= THRESHOLDS.quente ? 'quente' : score >= THRESHOLDS.morno ? 'morno' : 'frio';
  return { score, classification, reasons };
}

// Extrai informações de mensagens livres (DM do Instagram).
function extractFromText(text) {
  const t = String(text || '').toLowerCase();
  const out = {};
  const phone = String(text || '').match(/(?:\+?55\s?)?\(?\d{2}\)?\s?9?\s?\d{4}[-\s]?\d{4}/);
  if (phone) out.phone = onlyDigits(phone[0]);

  if (/\btroc(a|ar|o)\b/.test(t)) out.interest = 'troca';
  else if (/\bfinanc/.test(t)) out.interest = 'financiamento';
  else if (/\b(vender|vendo|avaliar|avalia[çc][aã]o)\b/.test(t)) out.interest = 'venda';
  else if (/\b(comprar|compra|quero|interesse|valor|pre[çc]o|dispon[ií]vel)\b/.test(t)) out.interest = 'compra';

  if (/[àa] vista/.test(t)) out.payment = 'avista';
  else if (/\bentrada\b/.test(t)) out.payment = 'financiado_entrada';
  else if (/\bfinanc/.test(t)) out.payment = 'financiado_sem_entrada';
  else if (/cons[óo]rcio/.test(t)) out.payment = 'consorcio';

  if (/\b(hoje|amanh[ãa]|urgente|essa semana|esta semana|agora)\b/.test(t)) out.timeline = 'imediato';
  else if (/\b(esse m[êe]s|este m[êe]s|pr[óo]ximo m[êe]s|30 dias)\b/.test(t)) out.timeline = '30_dias';

  const money = t.match(/r\$\s?([\d.]+(?:,\d{2})?)\s*(mil|k)?/) || t.match(/\b(\d{2,3})\s*(mil|k)\b/);
  if (money) {
    let v = Number(money[1].replace(/\./g, '').replace(',', '.'));
    if (money[2]) v *= 1000;
    if (v > 1000) out.budget = v;
  }
  return out;
}

module.exports = { scoreLead, extractFromText, validPhone, onlyDigits, WEIGHTS, THRESHOLDS, LABELS };
