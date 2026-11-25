const { onlyDigits, LABELS } = require('./scoring');

// Normaliza para o formato internacional usado pelo wa.me (Brasil = 55).
function toWaNumber(phone) {
  let d = onlyDigits(phone);
  if (!d) return '';
  if (d.length <= 11) d = '55' + d;
  return d;
}

function brl(v) {
  return Number(v) > 0 ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : '-';
}

function leadSummary(lead) {
  const l = (k, v) => (LABELS[k] && LABELS[k][v]) || v || '-';
  return [
    `*Novo lead encaminhado* ${l('classification', lead.classification)} (${lead.score} pts)`,
    `👤 ${lead.name || '-'}`,
    `📱 ${lead.phone || '-'}`,
    lead.instagram_user ? `📸 @${String(lead.instagram_user).replace(/^@/, '')}` : null,
    `🎯 Interesse: ${l('interest', lead.interest)}`,
    `🚗 Veículo: ${lead.vehicle_interest || '-'}`,
    lead.trade_in_vehicle ? `🔁 Troca/venda: ${lead.trade_in_vehicle}` : null,
    `💰 Orçamento: ${brl(lead.budget)} | ${l('payment', lead.payment)}`,
    `⏱️ Prazo: ${l('timeline', lead.timeline)}`,
    lead.city ? `📍 ${lead.city}` : null,
    lead.notes ? `📝 ${lead.notes}` : null,
    `Lead #${lead.id}`,
  ].filter(Boolean).join('\n');
}

function waLink(phone, text) {
  const n = toWaNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

function clientGreeting(lead, seller) {
  const first = (lead.name || '').split(' ')[0];
  return `Olá${first ? ' ' + first : ''}! Aqui é ${seller.name}, da concessionária. Vi seu interesse${lead.vehicle_interest ? ' no ' + lead.vehicle_interest : ''} pelo Instagram e vou te atender por aqui. Como posso te ajudar?`;
}

module.exports = { leadSummary, waLink, toWaNumber, clientGreeting, LABELS };
