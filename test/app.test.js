const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { openDb } = require('../server/db');
const { createApp } = require('../server/app');
const { scoreLead, extractFromText } = require('../server/scoring');

test('pontuação classifica leads quentes e frios', () => {
  const hot = scoreLead({ interest: 'troca', timeline: 'imediato', payment: 'avista', phone: '11999998888', budget: 90000, vehicle_interest: 'Corolla' });
  assert.equal(hot.classification, 'quente');
  const cold = scoreLead({ interest: 'pesquisando', timeline: 'sem_previsao' });
  assert.equal(cold.classification, 'frio');
});

test('extrai dados de mensagem do Instagram', () => {
  const x = extractFromText('Oi, quero trocar meu Gol, tenho 50 mil de entrada, meu zap 11 98888-7777. Preciso essa semana');
  assert.equal(x.interest, 'troca');
  assert.equal(x.phone, '11988887777');
  assert.equal(x.payment, 'financiado_entrada');
  assert.equal(x.timeline, 'imediato');
  assert.equal(x.budget, 50000);
});

test('fluxo completo pela API', async (t) => {
  const db = openDb(':memory:');
  const server = createApp(db, { igVerifyToken: 'tok', igAppSecret: 'segredo' }).listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (path, method = 'GET', body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie, ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };

  assert.equal((await call('/api/leads')).status, 401);
  assert.equal((await call('/api/login', 'POST', { email: 'admin@loja.com', password: 'admin123' })).status, 200);

  await call('/api/users', 'POST', { name: 'Ana', email: 'ana@loja.com', password: 'x1', whatsapp: '(11) 97777-0001' });
  await call('/api/users', 'POST', { name: 'Beto', email: 'beto@loja.com', password: 'x2', whatsapp: '11977770002' });

  // formulário público
  const pub = await call('/api/public/leads', 'POST', { name: 'Carlos Silva', phone: '(11) 99999-1234', interest: 'compra', timeline: 'imediato', payment: 'avista', budget: '120.000', vehicle_interest: 'Compass 2023' });
  assert.equal(pub.status, 201);

  // webhook Instagram: verificação e assinatura
  assert.equal((await call('/webhooks/instagram?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=42')).data, 42);
  const payload = { object: 'instagram', entry: [{ id: 'PAGE', messaging: [{ sender: { id: 'IG123' }, message: { text: 'Qual o valor do Onix? Só pesquisando' } }] }] };
  const raw = JSON.stringify(payload);
  assert.equal((await call('/webhooks/instagram', 'POST', payload, { 'x-hub-signature-256': 'sha256=errado' })).status, 401);
  const sig = 'sha256=' + crypto.createHmac('sha256', 'segredo').update(raw).digest('hex');
  assert.equal((await call('/webhooks/instagram', 'POST', payload, { 'x-hub-signature-256': sig })).status, 200);

  const leads = (await call('/api/leads')).data;
  assert.equal(leads.length, 2);
  const carlos = leads.find(l => l.name === 'Carlos Silva');
  assert.equal(carlos.classification, 'quente');
  assert.equal(carlos.stage, 'qualificado');
  assert.equal(carlos.budget, 120000);
  const ig = leads.find(l => l.instagram_id === 'IG123');
  assert.equal(ig.source, 'instagram_dm');

  // encaminhamento em rodízio
  const f1 = (await call(`/api/leads/${carlos.id}/forward`, 'POST', {})).data;
  assert.equal(f1.seller.name, 'Ana');
  assert.match(f1.seller_link, /^https:\/\/wa\.me\/5511977770001\?text=/);
  assert.match(f1.client_link, /^https:\/\/wa\.me\/5511999991234/);
  assert.equal(f1.lead.stage, 'encaminhado');
  const f2 = (await call(`/api/leads/${ig.id}/forward`, 'POST', {})).data;
  assert.equal(f2.seller.name, 'Beto');

  // etapas
  assert.equal((await call(`/api/leads/${ig.id}/stage`, 'PATCH', { stage: 'perdido' })).status, 400);
  assert.equal((await call(`/api/leads/${ig.id}/stage`, 'PATCH', { stage: 'perdido', lost_reason: 'Não respondeu' })).status, 200);
  await call(`/api/leads/${carlos.id}/stage`, 'PATCH', { stage: 'ganho' });

  const dash = (await call('/api/dashboard')).data;
  assert.equal(dash.won, 1);
  assert.equal(dash.conversion, 50);

  // vendedora só enxerga os próprios leads
  await call('/api/logout', 'POST'); cookie = '';
  await call('/api/login', 'POST', { email: 'ana@loja.com', password: 'x1' });
  const mine = (await call('/api/leads')).data;
  assert.deepEqual(mine.map(l => l.id), [carlos.id]);
  assert.equal((await call(`/api/leads/${ig.id}`)).status, 404);
  assert.equal((await call('/api/users')).status, 403);
  const det = (await call(`/api/leads/${carlos.id}`)).data;
  assert.ok(det.interactions.length >= 3);
});
