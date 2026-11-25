const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const auth = require('./auth');
const { scoreLead, extractFromText, validPhone, onlyDigits } = require('./scoring');
const { leadSummary, waLink, clientGreeting } = require('./whatsapp');

const STAGES = ['novo', 'qualificando', 'qualificado', 'encaminhado', 'negociacao', 'proposta', 'ganho', 'perdido'];
const LEAD_FIELDS = ['name', 'phone', 'instagram_user', 'source', 'interest', 'vehicle_interest', 'budget', 'payment', 'timeline', 'trade_in_vehicle', 'city', 'notes'];

function createApp(db, opts = {}) {
  const app = express();
  const igVerifyToken = opts.igVerifyToken ?? process.env.IG_VERIFY_TOKEN;
  const igAppSecret = opts.igAppSecret ?? process.env.IG_APP_SECRET;

  // Guarda o corpo bruto para validar a assinatura do webhook da Meta.
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

  // ---------- helpers ----------
  const q = (sql) => db.prepare(sql);
  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  function pick(body) {
    const out = {};
    for (const f of LEAD_FIELDS) if (body[f] !== undefined) out[f] = body[f] === '' ? null : body[f];
    if (out.budget != null) out.budget = Number(String(out.budget).replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || null;
    if (out.phone) out.phone = onlyDigits(out.phone);
    if (out.instagram_user) out.instagram_user = String(out.instagram_user).replace(/^@/, '').trim();
    return out;
  }

  function getLead(id) {
    return q(`SELECT l.*, u.name AS seller_name, u.whatsapp AS seller_whatsapp FROM leads l LEFT JOIN users u ON u.id = l.seller_id WHERE l.id = ?`).get(id);
  }

  function logInteraction(leadId, userId, type, content) {
    q('INSERT INTO interactions (lead_id, user_id, type, content) VALUES (?, ?, ?, ?)').run(leadId, userId ?? null, type, content);
  }

  function insertLead(data, userId) {
    const { score, classification } = scoreLead(data);
    const stage = classification === 'frio' ? 'novo' : 'qualificado';
    const cols = Object.keys(data);
    const r = q(`INSERT INTO leads (${[...cols, 'score', 'classification', 'stage'].join(',')}) VALUES (${[...cols, 1, 2, 3].map(() => '?').join(',')})`)
      .run(...cols.map(c => data[c]), score, classification, stage);
    const id = Number(r.lastInsertRowid);
    logInteraction(id, userId, 'sistema', `Lead criado (origem: ${data.source || 'instagram'}) — ${score} pts, ${classification}`);
    return id;
  }

  function updateLead(id, data, userId) {
    const current = getLead(id);
    if (!current) return null;
    const merged = { ...current, ...data };
    const { score, classification } = scoreLead(merged);
    const cols = Object.keys(data);
    q(`UPDATE leads SET ${[...cols, 'score', 'classification', 'updated_at'].map(c => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map(c => data[c]), score, classification, now(), id);
    if (current.classification !== classification) logInteraction(id, userId, 'sistema', `Classificação: ${current.classification} → ${classification} (${score} pts)`);
    return getLead(id);
  }

  function canAccess(user, lead) {
    return user.role === 'admin' || lead.seller_id === user.id;
  }

  // Rodízio: vendedor ativo com WhatsApp que recebeu lead há mais tempo.
  function nextSeller() {
    return q(`SELECT * FROM users WHERE role = 'vendedor' AND active = 1 AND whatsapp IS NOT NULL AND whatsapp != ''
              ORDER BY last_assigned_at IS NOT NULL, last_assigned_at, id LIMIT 1`).get();
  }

  // ---------- autenticação ----------
  function requireAuth(req, res, next) {
    const token = auth.parseCookies(req.headers.cookie).sid;
    const s = auth.getSession(token);
    const user = s && q('SELECT id, name, email, role, whatsapp, active FROM users WHERE id = ?').get(s.userId);
    if (!user || !user.active) return res.status(401).json({ error: 'Não autenticado' });
    req.user = user;
    next();
  }
  const requireAdmin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Apenas administradores' });

  app.post('/api/login', (req, res) => {
    const { email, password } = req.body || {};
    const u = q('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase().trim());
    if (!u || !u.active || !auth.verifyPassword(String(password || ''), u.password_hash)) return res.status(401).json({ error: 'E-mail ou senha inválidos' });
    const token = auth.createSession(u.id);
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=43200`);
    res.json({ id: u.id, name: u.name, role: u.role });
  });

  app.post('/api/logout', (req, res) => {
    auth.destroySession(auth.parseCookies(req.headers.cookie).sid);
    res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/me', requireAuth, (req, res) => res.json(req.user));

  // ---------- leads ----------
  app.get('/api/leads', requireAuth, (req, res) => {
    const where = [];
    const params = [];
    if (req.user.role !== 'admin') { where.push('l.seller_id = ?'); params.push(req.user.id); }
    else if (req.query.seller_id) { where.push('l.seller_id = ?'); params.push(Number(req.query.seller_id)); }
    if (req.query.stage) { where.push('l.stage = ?'); params.push(req.query.stage); }
    if (req.query.classification) { where.push('l.classification = ?'); params.push(req.query.classification); }
    if (req.query.interest) { where.push('l.interest = ?'); params.push(req.query.interest); }
    if (req.query.q) {
      where.push('(l.name LIKE ? OR l.phone LIKE ? OR l.instagram_user LIKE ? OR l.vehicle_interest LIKE ?)');
      const like = `%${req.query.q}%`; params.push(like, like, like, like);
    }
    const sql = `SELECT l.*, u.name AS seller_name FROM leads l LEFT JOIN users u ON u.id = l.seller_id
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.score DESC, l.created_at DESC LIMIT 1000`;
    res.json(q(sql).all(...params));
  });

  app.post('/api/leads', requireAuth, (req, res) => {
    const data = pick(req.body || {});
    if (!data.name && !data.phone && !data.instagram_user) return res.status(400).json({ error: 'Informe ao menos nome, telefone ou Instagram' });
    if (req.user.role !== 'admin') data.seller_id = req.user.id;
    const id = insertLead(data, req.user.id);
    res.status(201).json(getLead(id));
  });

  app.get('/api/leads/:id', requireAuth, (req, res) => {
    const lead = getLead(Number(req.params.id));
    if (!lead || !canAccess(req.user, lead)) return res.status(404).json({ error: 'Lead não encontrado' });
    const interactions = q(`SELECT i.*, u.name AS user_name FROM interactions i LEFT JOIN users u ON u.id = i.user_id WHERE lead_id = ? ORDER BY i.id DESC`).all(lead.id);
    res.json({ ...lead, interactions, score_reasons: scoreLead(lead).reasons });
  });

  app.put('/api/leads/:id', requireAuth, (req, res) => {
    const lead = getLead(Number(req.params.id));
    if (!lead || !canAccess(req.user, lead)) return res.status(404).json({ error: 'Lead não encontrado' });
    res.json(updateLead(lead.id, pick(req.body || {}), req.user.id));
  });

  app.delete('/api/leads/:id', requireAuth, requireAdmin, (req, res) => {
    q('DELETE FROM leads WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  app.patch('/api/leads/:id/stage', requireAuth, (req, res) => {
    const lead = getLead(Number(req.params.id));
    if (!lead || !canAccess(req.user, lead)) return res.status(404).json({ error: 'Lead não encontrado' });
    const { stage, lost_reason } = req.body || {};
    if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Etapa inválida' });
    if (stage === 'perdido' && !lost_reason) return res.status(400).json({ error: 'Informe o motivo da perda' });
    q('UPDATE leads SET stage = ?, lost_reason = ?, updated_at = ? WHERE id = ?').run(stage, stage === 'perdido' ? lost_reason : null, now(), lead.id);
    logInteraction(lead.id, req.user.id, 'etapa', `Etapa: ${lead.stage} → ${stage}${stage === 'perdido' ? ` (motivo: ${lost_reason})` : ''}`);
    res.json(getLead(lead.id));
  });

  app.post('/api/leads/:id/interactions', requireAuth, (req, res) => {
    const lead = getLead(Number(req.params.id));
    if (!lead || !canAccess(req.user, lead)) return res.status(404).json({ error: 'Lead não encontrado' });
    const { type = 'nota', content } = req.body || {};
    if (!content || !String(content).trim()) return res.status(400).json({ error: 'Conteúdo obrigatório' });
    logInteraction(lead.id, req.user.id, String(type), String(content).trim());
    q('UPDATE leads SET updated_at = ? WHERE id = ?').run(now(), lead.id);
    res.status(201).json({ ok: true });
  });

  // Encaminha o lead para um vendedor e gera os links de WhatsApp.
  app.post('/api/leads/:id/forward', requireAuth, requireAdmin, (req, res) => {
    const lead = getLead(Number(req.params.id));
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
    const seller = req.body?.seller_id
      ? q(`SELECT * FROM users WHERE id = ? AND active = 1`).get(Number(req.body.seller_id))
      : nextSeller();
    if (!seller) return res.status(400).json({ error: 'Nenhum vendedor ativo com WhatsApp cadastrado' });
    if (!seller.whatsapp) return res.status(400).json({ error: 'Vendedor sem WhatsApp cadastrado' });

    const ts = now();
    const stage = ['novo', 'qualificando', 'qualificado'].includes(lead.stage) ? 'encaminhado' : lead.stage;
    q('UPDATE leads SET seller_id = ?, forwarded_at = ?, stage = ?, updated_at = ? WHERE id = ?').run(seller.id, ts, stage, ts, lead.id);
    q('UPDATE users SET last_assigned_at = ? WHERE id = ?').run(new Date().toISOString(), seller.id);
    logInteraction(lead.id, req.user.id, 'whatsapp', `Encaminhado para ${seller.name} (${seller.whatsapp})`);

    const updated = getLead(lead.id);
    res.json({
      lead: updated,
      seller: { id: seller.id, name: seller.name, whatsapp: seller.whatsapp },
      seller_link: waLink(seller.whatsapp, leadSummary(updated)),
      client_link: validPhone(updated.phone) ? waLink(updated.phone, clientGreeting(updated, seller)) : null,
    });
  });

  // Link para o vendedor abrir conversa com o cliente.
  app.get('/api/leads/:id/whatsapp', requireAuth, (req, res) => {
    const lead = getLead(Number(req.params.id));
    if (!lead || !canAccess(req.user, lead)) return res.status(404).json({ error: 'Lead não encontrado' });
    if (!validPhone(lead.phone)) return res.status(400).json({ error: 'Lead sem telefone válido' });
    const seller = lead.seller_id ? q('SELECT * FROM users WHERE id = ?').get(lead.seller_id) : req.user;
    res.json({ link: waLink(lead.phone, clientGreeting(lead, seller)) });
  });

  // ---------- dashboard ----------
  app.get('/api/dashboard', requireAuth, (req, res) => {
    const scope = req.user.role === 'admin' ? '' : 'WHERE seller_id = ' + Number(req.user.id);
    const and = scope ? scope + ' AND' : 'WHERE';
    const byStage = Object.fromEntries(STAGES.map(s => [s, 0]));
    for (const r of q(`SELECT stage, COUNT(*) n FROM leads ${scope} GROUP BY stage`).all()) byStage[r.stage] = r.n;
    const byClass = { quente: 0, morno: 0, frio: 0 };
    for (const r of q(`SELECT classification c, COUNT(*) n FROM leads ${scope} GROUP BY classification`).all()) byClass[r.c] = r.n;
    const byInterest = q(`SELECT COALESCE(interest,'indefinido') interest, COUNT(*) n FROM leads ${scope} GROUP BY 1 ORDER BY n DESC`).all();
    const total = Object.values(byStage).reduce((a, b) => a + b, 0);
    const won = byStage.ganho;
    const closed = won + byStage.perdido;
    const lostReasons = q(`SELECT lost_reason reason, COUNT(*) n FROM leads ${and} stage = 'perdido' GROUP BY 1 ORDER BY n DESC LIMIT 5`).all();
    const sellers = req.user.role === 'admin' ? q(`
      SELECT u.id, u.name, COUNT(l.id) total,
        SUM(CASE WHEN l.stage = 'ganho' THEN 1 ELSE 0 END) ganhos,
        SUM(CASE WHEN l.stage NOT IN ('ganho','perdido') THEN 1 ELSE 0 END) abertos
      FROM users u LEFT JOIN leads l ON l.seller_id = u.id WHERE u.role = 'vendedor' GROUP BY u.id ORDER BY ganhos DESC`).all() : [];
    const last7 = q(`SELECT date(created_at) d, COUNT(*) n FROM leads ${and} created_at >= datetime('now','-6 days') GROUP BY 1 ORDER BY 1`).all();
    const pendingForward = req.user.role === 'admin' ? q(`SELECT COUNT(*) n FROM leads WHERE seller_id IS NULL AND classification != 'frio' AND stage NOT IN ('ganho','perdido')`).get().n : 0;
    res.json({ total, byStage, byClass, byInterest, won, conversion: closed ? Math.round((won / closed) * 100) : 0, lostReasons, sellers, last7, pendingForward });
  });

  // ---------- usuários / vendedores ----------
  app.get('/api/users', requireAuth, requireAdmin, (_req, res) => {
    res.json(q('SELECT id, name, email, role, whatsapp, active, last_assigned_at, created_at FROM users ORDER BY role, name').all());
  });

  app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
    const { name, email, password, role = 'vendedor', whatsapp } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' });
    if (!['admin', 'vendedor'].includes(role)) return res.status(400).json({ error: 'Perfil inválido' });
    try {
      const r = q('INSERT INTO users (name, email, password_hash, role, whatsapp) VALUES (?, ?, ?, ?, ?)')
        .run(name, String(email).toLowerCase().trim(), auth.hashPassword(String(password)), role, whatsapp ? onlyDigits(whatsapp) : null);
      res.status(201).json({ id: Number(r.lastInsertRowid) });
    } catch (e) {
      res.status(400).json({ error: /UNIQUE/.test(e.message) ? 'E-mail já cadastrado' : e.message });
    }
  });

  app.put('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const u = q('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
    const b = req.body || {};
    q('UPDATE users SET name = ?, whatsapp = ?, role = ?, active = ? WHERE id = ?').run(
      b.name ?? u.name,
      b.whatsapp !== undefined ? (b.whatsapp ? onlyDigits(b.whatsapp) : null) : u.whatsapp,
      ['admin', 'vendedor'].includes(b.role) ? b.role : u.role,
      b.active !== undefined ? (b.active ? 1 : 0) : u.active,
      id);
    if (b.password) q('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(String(b.password)), id);
    res.json({ ok: true });
  });

  // ---------- captura pública (formulário do "link na bio") ----------
  const hits = new Map();
  app.post('/api/public/leads', (req, res) => {
    const ip = req.ip;
    const recent = (hits.get(ip) || []).filter(t => Date.now() - t < 60_000);
    if (recent.length >= 5) return res.status(429).json({ error: 'Muitas tentativas, aguarde um minuto' });
    hits.set(ip, [...recent, Date.now()]);

    const data = pick(req.body || {});
    delete data.source;
    if (!data.name || !validPhone(data.phone)) return res.status(400).json({ error: 'Informe nome e WhatsApp válido' });
    data.source = 'formulario_instagram';
    // Se já existe lead com o mesmo telefone, atualiza em vez de duplicar.
    const existing = q('SELECT id FROM leads WHERE phone = ?').get(data.phone);
    if (existing) {
      updateLead(existing.id, data, null);
      logInteraction(existing.id, null, 'sistema', 'Lead preencheu o formulário novamente');
    } else {
      insertLead(data, null);
    }
    res.status(201).json({ ok: true });
  });

  // ---------- webhook Instagram (Meta Graph API – Instagram Messaging) ----------
  app.get('/webhooks/instagram', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && igVerifyToken && req.query['hub.verify_token'] === igVerifyToken) {
      return res.status(200).send(String(req.query['hub.challenge']));
    }
    res.sendStatus(403);
  });

  app.post('/webhooks/instagram', (req, res) => {
    if (igAppSecret) {
      const sig = String(req.headers['x-hub-signature-256'] || '');
      const expected = 'sha256=' + crypto.createHmac('sha256', igAppSecret).update(req.rawBody || '').digest('hex');
      if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return res.sendStatus(401);
    }
    const body = req.body || {};
    for (const entry of body.entry || []) {
      for (const ev of entry.messaging || []) {
        const text = ev.message?.text;
        const senderId = ev.sender?.id;
        if (!text || !senderId || ev.message?.is_echo || senderId === entry.id) continue;
        const extracted = extractFromText(text);
        const existing = q('SELECT * FROM leads WHERE instagram_id = ?').get(String(senderId));
        if (existing) {
          const patch = {};
          for (const [k, v] of Object.entries(extracted)) if (!existing[k]) patch[k] = v;
          if (Object.keys(patch).length) updateLead(existing.id, patch, null);
          logInteraction(existing.id, null, 'instagram', text);
        } else {
          const id = insertLead({ ...extracted, instagram_id: String(senderId), source: 'instagram_dm' }, null);
          logInteraction(id, null, 'instagram', text);
        }
      }
    }
    res.sendStatus(200);
  });

  // ---------- front-end ----------
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('/formulario', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'formulario.html')));

  return app;
}

module.exports = { createApp, STAGES };
