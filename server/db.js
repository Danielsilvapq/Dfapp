const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { hashPassword } = require('./auth');

function openDb(file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'leads.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'vendedor' CHECK (role IN ('admin','vendedor')),
      whatsapp TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      last_assigned_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT,
      instagram_user TEXT,
      instagram_id TEXT UNIQUE,
      source TEXT NOT NULL DEFAULT 'instagram',
      interest TEXT,             -- compra | troca | venda | financiamento | pesquisando
      vehicle_interest TEXT,     -- ex.: "Corolla 2022"
      budget REAL,
      payment TEXT,              -- avista | financiado_entrada | financiado_sem_entrada | consorcio | nao_sabe
      timeline TEXT,             -- imediato | 30_dias | 90_dias | sem_previsao
      trade_in_vehicle TEXT,     -- veículo que o cliente quer dar na troca / vender
      city TEXT,
      notes TEXT,
      score INTEGER NOT NULL DEFAULT 0,
      classification TEXT NOT NULL DEFAULT 'frio', -- quente | morno | frio
      stage TEXT NOT NULL DEFAULT 'novo',
      lost_reason TEXT,
      seller_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      forwarded_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      type TEXT NOT NULL,        -- nota | instagram | whatsapp | etapa | sistema | ligacao | visita
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
    CREATE INDEX IF NOT EXISTS idx_leads_seller ON leads(seller_id);
    CREATE INDEX IF NOT EXISTS idx_inter_lead ON interactions(lead_id);
  `);

  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count === 0) {
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(
      'Administrador',
      process.env.ADMIN_EMAIL || 'admin@loja.com',
      hashPassword(process.env.ADMIN_PASSWORD || 'admin123'),
      'admin'
    );
  }
  return db;
}

module.exports = { openDb };
