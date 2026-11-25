'use strict';

const STAGES = [
  ['novo', 'Novo'], ['qualificando', 'Em qualificação'], ['qualificado', 'Qualificado'], ['encaminhado', 'Encaminhado'],
  ['negociacao', 'Negociação'], ['proposta', 'Proposta'], ['ganho', 'Venda fechada'], ['perdido', 'Perdido'],
];
const STAGE_LABEL = Object.fromEntries(STAGES);
const OPTS = {
  interest: [['compra', 'Compra'], ['troca', 'Troca'], ['venda', 'Quer vender o carro'], ['financiamento', 'Financiamento'], ['pesquisando', 'Só pesquisando']],
  payment: [['avista', 'À vista'], ['financiado_entrada', 'Financiado c/ entrada'], ['financiado_sem_entrada', 'Financiado s/ entrada'], ['consorcio', 'Consórcio'], ['nao_sabe', 'Não sabe']],
  timeline: [['imediato', 'Imediato (esta semana)'], ['30_dias', 'Até 30 dias'], ['90_dias', 'Até 90 dias'], ['sem_previsao', 'Sem previsão']],
  source: [['instagram', 'Instagram'], ['instagram_dm', 'Instagram (DM)'], ['formulario_instagram', 'Formulário (bio)'], ['whatsapp', 'WhatsApp'], ['loja', 'Loja física'], ['indicacao', 'Indicação'], ['outro', 'Outro']],
};
const label = (k, v) => (OPTS[k]?.find(o => o[0] === v) || [, v || '-'])[1];
const CLASS_LABEL = { quente: '🔥 Quente', morno: '🌤️ Morno', frio: '❄️ Frio' };
const LOST_REASONS = ['Sem crédito aprovado', 'Preço / orçamento', 'Comprou em outra loja', 'Não respondeu', 'Sem o veículo desejado', 'Desistiu da compra', 'Outro'];

let me = null;
let currentView = 'dashboard';
let sellersCache = [];

// ---------- utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => Number(v) > 0 ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : '-';
const fmtDate = (s) => s ? new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-';
const fmtPhone = (p) => { const d = String(p || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : (p || '-'); };
const badge = (c) => `<span class="badge ${esc(c)}">${CLASS_LABEL[c] || esc(c)}</span>`;
const options = (list, sel, empty = '—') => `<option value="">${empty}</option>` + list.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
const isAdmin = () => me?.role === 'admin';

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 3000);
}

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw new Error('Sessão expirada'); }
  if (!res.ok) throw new Error(data.error || 'Erro na requisição');
  return data;
}

function modal(html, cls = '') {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-bg"><div class="modal ${cls}"><button class="close" aria-label="Fechar">×</button>${html}</div></div>`;
  const close = () => { root.innerHTML = ''; };
  $('.close', root).onclick = close;
  $('.modal-bg', root).onclick = (e) => { if (e.target.classList.contains('modal-bg')) close(); };
  return { el: $('.modal', root), close };
}

// ---------- login ----------
function showLogin() { $('#app-view').classList.add('hidden'); $('#login-view').classList.remove('hidden'); }
$('#login-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api('/api/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } });
    await boot();
  } catch (err) { $('#login-err').textContent = err.message; }
};
$('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); showLogin(); };

async function boot() {
  try { me = await api('/api/me'); } catch { return showLogin(); }
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#user-name').textContent = `${me.name} (${me.role})`;
  document.querySelectorAll('[data-admin]').forEach(el => el.classList.toggle('hidden', !isAdmin()));
  if (isAdmin()) sellersCache = (await api('/api/users')).filter(u => u.role === 'vendedor');
  go(location.hash.slice(1) || 'dashboard');
}

$('#nav').onclick = (e) => { const v = e.target.dataset.view; if (v) go(v); };
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v && v !== currentView) go(v); });

function go(view) {
  currentView = view;
  if (location.hash.slice(1) !== view) location.hash = view;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  ({ dashboard: renderDashboard, funil: renderFunnel, leads: renderLeads, vendedores: renderSellers }[view] || renderDashboard)();
}
const refresh = () => go(currentView);

// ---------- dashboard ----------
async function renderDashboard() {
  const d = await api('/api/dashboard');
  const max = Math.max(1, ...Object.values(d.byStage));
  $('#main').innerHTML = `
    ${d.pendingForward ? `<div class="alert">⚠️ ${d.pendingForward} lead(s) com potencial ainda <b>sem vendedor</b>. <a href="#leads" data-pending>Ver e encaminhar</a></div>` : ''}
    <div class="cards">
      <div class="card"><div class="label">Total de leads</div><div class="value">${d.total}</div></div>
      <div class="card hot"><div class="label">🔥 Quentes</div><div class="value">${d.byClass.quente}</div></div>
      <div class="card warm"><div class="label">🌤️ Mornos</div><div class="value">${d.byClass.morno}</div></div>
      <div class="card cold"><div class="label">❄️ Frios (baixo potencial)</div><div class="value">${d.byClass.frio}</div></div>
      <div class="card ok"><div class="label">Vendas fechadas</div><div class="value">${d.won}</div></div>
      <div class="card"><div class="label">Conversão (fechados)</div><div class="value">${d.conversion}%</div></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>Funil de vendas</h3>
        ${STAGES.map(([k, l]) => `<div class="funnel-bar"><div class="name">${l}</div><div class="track"><div class="fill" style="width:${(d.byStage[k] / max) * 100}%;${k === 'ganho' ? 'background:var(--ok)' : k === 'perdido' ? 'background:var(--bad)' : ''}"></div></div><div class="n">${d.byStage[k]}</div></div>`).join('')}
      </div>
      <div class="card"><h3>Leads por interesse</h3>
        ${d.byInterest.length ? d.byInterest.map(r => `<div class="funnel-bar"><div class="name">${esc(r.interest === 'indefinido' ? 'Indefinido' : label('interest', r.interest))}</div><div class="track"><div class="fill" style="width:${(r.n / d.total) * 100}%;background:var(--warm)"></div></div><div class="n">${r.n}</div></div>`).join('') : '<p class="s">Sem dados ainda.</p>'}
        <h3 style="margin-top:20px">Principais motivos de perda</h3>
        ${d.lostReasons.length ? d.lostReasons.map(r => `<div class="funnel-bar"><div class="name">${esc(r.reason)}</div><div class="n">${r.n}</div></div>`).join('') : '<p class="s">Nenhuma perda registrada.</p>'}
      </div>
      ${isAdmin() ? `<div class="card"><h3>Desempenho por vendedor</h3>
        <div class="table-wrap"><table><thead><tr><th>Vendedor</th><th>Leads</th><th>Em aberto</th><th>Vendas</th><th>Conversão</th></tr></thead><tbody>
        ${d.sellers.map(s => `<tr><td>${esc(s.name)}</td><td>${s.total}</td><td>${s.abertos || 0}</td><td>${s.ganhos || 0}</td><td>${s.total ? Math.round(((s.ganhos || 0) / s.total) * 100) : 0}%</td></tr>`).join('') || '<tr><td colspan="5">Cadastre vendedores na aba Vendedores.</td></tr>'}
        </tbody></table></div></div>` : ''}
      <div class="card"><h3>Novos leads — últimos 7 dias</h3>
        ${d.last7.length ? d.last7.map(r => `<div class="funnel-bar"><div class="name">${new Date(r.d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' })}</div><div class="track"><div class="fill" style="width:${(r.n / Math.max(...d.last7.map(x => x.n))) * 100}%"></div></div><div class="n">${r.n}</div></div>`).join('') : '<p class="s">Nenhum lead novo.</p>'}
      </div>
    </div>`;
  const p = $('[data-pending]'); if (p) p.onclick = (e) => { e.preventDefault(); renderLeads({ pending: true }); };
}

// ---------- funil (kanban) ----------
async function renderFunnel() {
  const leads = await api('/api/leads');
  $('#main').innerHTML = `
    <div class="toolbar"><b>Arraste os cards entre as etapas.</b><span class="grow"></span>
      <select id="f-class">${options(Object.entries(CLASS_LABEL), '', 'Todas as classificações')}</select>
      <button class="btn primary" id="new-lead">+ Novo lead</button></div>
    <div class="kanban" id="kanban"></div>`;
  const draw = () => {
    const fc = $('#f-class').value;
    const list = leads.filter(l => !fc || l.classification === fc);
    $('#kanban').innerHTML = STAGES.map(([k, lbl]) => {
      const items = list.filter(l => l.stage === k);
      return `<section class="col" data-stage="${k}"><header>${lbl}<span>${items.length}</span></header><div class="list">
        ${items.map(l => `<div class="kcard ${l.classification}" draggable="true" data-id="${l.id}">
          <div class="t">${esc(l.name || (l.instagram_user ? '@' + l.instagram_user : 'Lead #' + l.id))}</div>
          <div class="s">${esc(label('interest', l.interest))} · ${esc(l.vehicle_interest || 'veículo não definido')}</div>
          <div class="row"><span class="score">${l.score} pts</span><span class="s">${esc(l.seller_name || 'sem vendedor')}</span></div></div>`).join('')}
      </div></section>`;
    }).join('');
  };
  draw();
  $('#f-class').onchange = draw;
  $('#new-lead').onclick = () => openLeadForm();
  const kb = $('#kanban');
  kb.addEventListener('click', (e) => { const c = e.target.closest('.kcard'); if (c) openLead(c.dataset.id); });
  kb.addEventListener('dragstart', (e) => { const c = e.target.closest('.kcard'); if (c) e.dataTransfer.setData('text/plain', c.dataset.id); });
  kb.addEventListener('dragover', (e) => { const col = e.target.closest('.col'); if (col) { e.preventDefault(); col.classList.add('drag-over'); } });
  kb.addEventListener('dragleave', (e) => { const col = e.target.closest('.col'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('drag-over'); });
  kb.addEventListener('drop', async (e) => {
    const col = e.target.closest('.col'); if (!col) return;
    e.preventDefault(); col.classList.remove('drag-over');
    const id = Number(e.dataTransfer.getData('text/plain'));
    const lead = leads.find(l => l.id === id);
    if (!lead || lead.stage === col.dataset.stage) return;
    const ok = await changeStage(lead, col.dataset.stage);
    if (ok) { lead.stage = col.dataset.stage; draw(); }
  });
}

async function changeStage(lead, stage) {
  let lost_reason;
  if (stage === 'perdido') {
    lost_reason = await askLostReason(); if (!lost_reason) return false;
  }
  try { await api(`/api/leads/${lead.id}/stage`, { method: 'PATCH', body: { stage, lost_reason } }); toast(`Movido para "${STAGE_LABEL[stage]}"`); return true; }
  catch (err) { toast(err.message); return false; }
}

function askLostReason() {
  return new Promise((resolve) => {
    const m = modal(`<h2>Motivo da perda</h2><div class="form-grid"><label class="full">Motivo<select id="lr">${LOST_REASONS.map(r => `<option>${r}</option>`).join('')}</select></label>
      <label class="full">Detalhe (opcional)<input id="lr-d"></label></div><div class="actions"><button class="btn primary" id="lr-ok">Confirmar</button></div>`, 'small');
    $('#lr-ok').onclick = () => { const r = $('#lr').value + ($('#lr-d').value ? ` — ${$('#lr-d').value}` : ''); m.close(); resolve(r); };
    const origClose = $('.close').onclick; $('.close').onclick = () => { origClose(); resolve(null); };
  });
}

// ---------- lista de leads ----------
async function renderLeads(preset = {}) {
  $('#main').innerHTML = `
    <div class="toolbar">
      <input id="f-q" placeholder="Buscar nome, telefone, @instagram, veículo" class="grow">
      <select id="f-class">${options(Object.entries(CLASS_LABEL), '', 'Potencial: todos')}</select>
      <select id="f-stage">${options(STAGES, '', 'Etapa: todas')}</select>
      <select id="f-interest">${options(OPTS.interest, '', 'Interesse: todos')}</select>
      ${isAdmin() ? `<select id="f-seller"><option value="">Vendedor: todos</option><option value="none" ${preset.pending ? 'selected' : ''}>Sem vendedor</option>${sellersCache.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>` : ''}
      <button class="btn" id="export">Exportar CSV</button>
      <button class="btn primary" id="new-lead">+ Novo lead</button>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Lead</th><th>Potencial</th><th>Pontos</th><th>Interesse</th><th>Veículo</th><th>Orçamento</th><th>Prazo</th><th>Etapa</th><th>Vendedor</th><th>Criado</th></tr></thead><tbody id="tb"></tbody></table></div>`;
  let rows = [];
  const load = async () => {
    const p = new URLSearchParams();
    for (const [k, id] of [['q', 'f-q'], ['classification', 'f-class'], ['stage', 'f-stage'], ['interest', 'f-interest']]) if ($('#' + id).value) p.set(k, $('#' + id).value);
    const sel = $('#f-seller')?.value;
    if (sel && sel !== 'none') p.set('seller_id', sel);
    rows = await api('/api/leads?' + p);
    if (sel === 'none') rows = rows.filter(r => !r.seller_id && r.classification !== 'frio' && !['ganho', 'perdido'].includes(r.stage));
    $('#tb').innerHTML = rows.map(l => `<tr data-id="${l.id}">
      <td><b>${esc(l.name || '-')}</b><div class="reasons">${esc(fmtPhone(l.phone))}${l.instagram_user ? ' · @' + esc(l.instagram_user) : ''}</div></td>
      <td>${badge(l.classification)}</td><td class="score">${l.score}</td><td>${esc(label('interest', l.interest))}</td>
      <td>${esc(l.vehicle_interest || '-')}</td><td>${brl(l.budget)}</td><td>${esc(label('timeline', l.timeline))}</td>
      <td><span class="badge stage">${STAGE_LABEL[l.stage]}</span></td><td>${esc(l.seller_name || '—')}</td><td>${fmtDate(l.created_at)}</td></tr>`).join('')
      || '<tr><td colspan="10">Nenhum lead encontrado.</td></tr>';
  };
  let t; $('#f-q').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  ['f-class', 'f-stage', 'f-interest', 'f-seller'].forEach(id => { const el = $('#' + id); if (el) el.onchange = load; });
  $('#tb').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) openLead(tr.dataset.id); };
  $('#new-lead').onclick = () => openLeadForm();
  $('#export').onclick = () => exportCsv(rows);
  await load();
}

function exportCsv(rows) {
  const cols = ['id', 'name', 'phone', 'instagram_user', 'source', 'classification', 'score', 'interest', 'vehicle_interest', 'budget', 'payment', 'timeline', 'trade_in_vehicle', 'city', 'stage', 'seller_name', 'lost_reason', 'created_at'];
  const csv = [cols.join(';'), ...rows.map(r => cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(';'))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
}

// ---------- formulário de lead ----------
function leadFields(l = {}) {
  return `<div class="form-grid">
    <label>Nome<input name="name" value="${esc(l.name)}"></label>
    <label>WhatsApp / telefone<input name="phone" value="${esc(l.phone)}" placeholder="(11) 99999-9999"></label>
    <label>Instagram<input name="instagram_user" value="${esc(l.instagram_user)}" placeholder="@usuario"></label>
    <label>Origem<select name="source">${options(OPTS.source, l.source || 'instagram')}</select></label>
    <label>Interesse<select name="interest">${options(OPTS.interest, l.interest)}</select></label>
    <label>Veículo de interesse<input name="vehicle_interest" value="${esc(l.vehicle_interest)}" placeholder="Ex.: HB20 2021"></label>
    <label>Orçamento (R$)<input name="budget" value="${l.budget ? esc(l.budget) : ''}" inputmode="numeric"></label>
    <label>Forma de pagamento<select name="payment">${options(OPTS.payment, l.payment)}</select></label>
    <label>Prazo de compra<select name="timeline">${options(OPTS.timeline, l.timeline)}</select></label>
    <label>Veículo para troca / venda<input name="trade_in_vehicle" value="${esc(l.trade_in_vehicle)}" placeholder="Ex.: Gol 2015, 90 mil km"></label>
    <label>Cidade<input name="city" value="${esc(l.city)}"></label>
    <label class="full">Observações<textarea name="notes" rows="2">${esc(l.notes)}</textarea></label>
  </div>`;
}
const formData = (form) => Object.fromEntries(new FormData(form).entries());

function openLeadForm() {
  const m = modal(`<h2>Novo lead</h2><form id="lf">${leadFields()}<div class="actions"><button class="btn primary">Salvar</button></div></form>`);
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    try { const l = await api('/api/leads', { method: 'POST', body: formData(e.target) }); m.close(); toast(`Lead criado: ${l.score} pts (${l.classification})`); refresh(); openLead(l.id); }
    catch (err) { toast(err.message); }
  };
}

// ---------- detalhe do lead ----------
async function openLead(id) {
  const l = await api(`/api/leads/${id}`);
  const m = modal(`
    <h2>${esc(l.name || (l.instagram_user ? '@' + l.instagram_user : 'Lead #' + l.id))} ${badge(l.classification)} <span class="score">${l.score} pts</span></h2>
    <div class="reasons">${l.score_reasons.map(esc).join(' · ') || 'Sem informações suficientes para pontuar — qualifique o lead.'}</div>
    <div class="actions">
      <select id="stage-sel">${STAGES.map(([k, v]) => `<option value="${k}" ${k === l.stage ? 'selected' : ''}>${v}</option>`).join('')}</select>
      ${isAdmin() ? `<select id="seller-sel"><option value="">Rodízio automático</option>${sellersCache.filter(s => s.active).map(s => `<option value="${s.id}" ${s.id === l.seller_id ? 'selected' : ''}>${esc(s.name)}${s.whatsapp ? '' : ' (sem WhatsApp)'}</option>`).join('')}</select>
        <button class="btn wa" id="fwd">📲 Encaminhar ao vendedor (WhatsApp)</button>` : ''}
      ${l.phone ? `<button class="btn" id="wa-client">💬 Chamar cliente no WhatsApp</button>` : ''}
      ${isAdmin() ? '<button class="btn danger" id="del">Excluir</button>' : ''}
    </div>
    <div class="reasons">Vendedor: <b>${esc(l.seller_name || 'nenhum')}</b>${l.forwarded_at ? ` · encaminhado em ${fmtDate(l.forwarded_at)}` : ''}${l.lost_reason ? ` · <b>Perdido:</b> ${esc(l.lost_reason)}` : ''} · Origem: ${esc(label('source', l.source))}</div>
    <div class="lead-layout">
      <form id="lead-edit">${leadFields(l)}<div class="actions"><button class="btn primary">Salvar alterações</button></div></form>
      <div>
        <h3>Histórico</h3>
        <form id="note-form" class="actions" style="flex-direction:column">
          <div class="actions" style="margin:0"><select name="type"><option value="nota">📝 Nota</option><option value="ligacao">📞 Ligação</option><option value="whatsapp">💬 WhatsApp</option><option value="visita">🏬 Visita à loja</option></select></div>
          <textarea name="content" rows="2" placeholder="Registrar contato, proposta, test drive..."></textarea>
          <button class="btn">Adicionar ao histórico</button>
        </form>
        <ul class="timeline">${l.interactions.map(i => `<li class="${esc(i.type)}"><div class="meta">${fmtDate(i.created_at)} · ${esc(i.type)}${i.user_name ? ' · ' + esc(i.user_name) : ''}</div><div class="c">${esc(i.content)}</div></li>`).join('')}</ul>
      </div>
    </div>`);

  $('#stage-sel', m.el).onchange = async (e) => { if (await changeStage(l, e.target.value)) { m.close(); refresh(); openLead(id); } else e.target.value = l.stage; };
  $('#lead-edit', m.el).onsubmit = async (e) => {
    e.preventDefault();
    try { await api(`/api/leads/${id}`, { method: 'PUT', body: formData(e.target) }); toast('Lead atualizado'); m.close(); refresh(); openLead(id); }
    catch (err) { toast(err.message); }
  };
  $('#note-form', m.el).onsubmit = async (e) => {
    e.preventDefault();
    try { await api(`/api/leads/${id}/interactions`, { method: 'POST', body: formData(e.target) }); m.close(); openLead(id); }
    catch (err) { toast(err.message); }
  };
  const fwd = $('#fwd', m.el);
  if (fwd) fwd.onclick = async () => {
    try {
      const r = await api(`/api/leads/${id}/forward`, { method: 'POST', body: { seller_id: $('#seller-sel').value || undefined } });
      window.open(r.seller_link, '_blank');
      toast(`Encaminhado para ${r.seller.name}`);
      m.close(); refresh(); openLead(id);
    } catch (err) { toast(err.message); }
  };
  const wc = $('#wa-client', m.el);
  if (wc) wc.onclick = async () => {
    try { const r = await api(`/api/leads/${id}/whatsapp`); window.open(r.link, '_blank'); await api(`/api/leads/${id}/interactions`, { method: 'POST', body: { type: 'whatsapp', content: 'Conversa aberta no WhatsApp com o cliente' } }); }
    catch (err) { toast(err.message); }
  };
  const del = $('#del', m.el);
  if (del) del.onclick = async () => { if (confirm('Excluir este lead definitivamente?')) { await api(`/api/leads/${id}`, { method: 'DELETE' }); m.close(); refresh(); } };
}

// ---------- vendedores ----------
async function renderSellers() {
  if (!isAdmin()) return renderDashboard();
  const users = await api('/api/users');
  sellersCache = users.filter(u => u.role === 'vendedor');
  $('#main').innerHTML = `
    <div class="toolbar"><span class="grow">Os leads são distribuídos em <b>rodízio</b> entre vendedores ativos com WhatsApp cadastrado.</span><button class="btn primary" id="new-user">+ Novo usuário</button></div>
    <div class="table-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>WhatsApp</th><th>Status</th><th>Último lead recebido</th><th></th></tr></thead><tbody>
    ${users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${esc(fmtPhone(u.whatsapp))}</td>
      <td>${u.active ? '✅ Ativo' : '⛔ Inativo'}</td><td>${u.last_assigned_at ? new Date(u.last_assigned_at).toLocaleString('pt-BR') : '-'}</td>
      <td><button class="btn sm" data-edit="${u.id}">Editar</button></td></tr>`).join('')}
    </tbody></table></div>`;
  $('#new-user').onclick = () => userForm();
  $('#main').querySelectorAll('[data-edit]').forEach(b => b.onclick = (e) => { e.stopPropagation(); userForm(users.find(u => u.id === Number(b.dataset.edit))); });
}

function userForm(u) {
  const m = modal(`<h2>${u ? 'Editar usuário' : 'Novo usuário'}</h2><form id="uf"><div class="form-grid">
    <label class="full">Nome<input name="name" required value="${esc(u?.name)}"></label>
    ${u ? '' : '<label class="full">E-mail (login)<input name="email" type="email" required></label>'}
    <label class="full">WhatsApp<input name="whatsapp" value="${esc(u?.whatsapp)}" placeholder="(11) 99999-9999"></label>
    <label>Perfil<select name="role"><option value="vendedor" ${u?.role !== 'admin' ? 'selected' : ''}>Vendedor</option><option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Administrador</option></select></label>
    ${u ? `<label>Status<select name="active"><option value="1" ${u.active ? 'selected' : ''}>Ativo</option><option value="0" ${u.active ? '' : 'selected'}>Inativo</option></select></label>` : ''}
    <label class="full">${u ? 'Nova senha (deixe vazio para manter)' : 'Senha'}<input name="password" type="password" ${u ? '' : 'required'}></label>
  </div><div class="actions"><button class="btn primary">Salvar</button></div></form>`, 'small');
  $('#uf').onsubmit = async (e) => {
    e.preventDefault();
    const b = formData(e.target);
    if (b.active !== undefined) b.active = b.active === '1';
    if (!b.password) delete b.password;
    try { await api(u ? `/api/users/${u.id}` : '/api/users', { method: u ? 'PUT' : 'POST', body: b }); m.close(); toast('Salvo'); renderSellers(); }
    catch (err) { toast(err.message); }
  };
}

boot();
