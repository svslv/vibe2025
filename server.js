// server.js — с подробным логированием

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const mysql   = require('mysql2/promise');
const path    = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Конфиг MySQL
const dbConfig = {
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
};

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Сессии
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { sameSite: 'lax' }
}));

// --- Логируем каждый запрос ---
app.use((req, res, next) => {
  console.log(`\n[${new Date().toISOString()}] ➤ ${req.method} ${req.path}`);
  console.log(`  Session user: ${req.session.user ? req.session.user.username : 'none'}`);
  console.log(`  Body: ${JSON.stringify(req.body)}`);
  next();
});

// Middleware авторизации
function ensureAuth(req, res, next) {
  if (req.session.user) return next();
  if (req.path.startsWith('/api/')) {
    console.warn(`  ❗ Unauthorized API access, returning 401`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/login.html');
}

// === авторизация ===
app.get('/login.html', (req, res) =>
  res.sendFile(path.join(__dirname, 'login.html'))
);

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const USER = process.env.LOGIN_USER ?? process.env.ADMIN_USER;
  const PASS = process.env.LOGIN_PASS ?? process.env.ADMIN_PASS;
  console.log(`  Проверяем логин: ${username}/${password}`);
  if (username === USER && password === PASS) {
    req.session.user = { username };
    console.log(`  ✔ Успешный вход, редирект на /`);
    return res.redirect('/');
  }
  console.log(`  ✘ Неверные креды, редирект обратно`);
  return res.redirect('/login.html?error=1');
});

app.get('/logout', (req, res) => {
  console.log(`  Выход пользователя ${req.session.user?.username}`);
  req.session.destroy(() => res.redirect('/login.html'));
});

// статические файлы
app.use(express.static(path.join(__dirname)));

// === API ===

// GET /api/items
app.get('/api/items', ensureAuth, async (req, res) => {
  console.log(`  → Получаем все задачи`);
  try {
    const conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute('SELECT id, text FROM items');
    await conn.end();
    console.log(`  ← Найдено ${rows.length} записей`);
    res.json(rows);
  } catch (err) {
    console.error(`  ❌ Ошибка при SELECT:`, err);
    res.status(500).json({ error: 'DB error' });
  }
});

// POST /api/add
app.post('/api/add', ensureAuth, async (req, res) => {
  const { text } = req.body;
  console.log(`  → Добавляем задачу: "${text}"`);
  if (!text || !text.trim()) {
    console.warn(`  ✘ Пустой текст`);
    return res.status(400).json({ error: 'Empty text' });
  }
  try {
    const conn = await mysql.createConnection(dbConfig);
    const [result] = await conn.execute(
      'INSERT INTO items (text) VALUES (?)',
      [text.trim()]
    );
    await conn.end();
    console.log(`  ✔ Вставлено с ID=${result.insertId}`);
    res.json({ id: result.insertId });
  } catch (err) {
    console.error(`  ❌ Ошибка при INSERT:`, err);
    res.status(500).json({ error: 'DB error' });
  }
});

// POST /api/delete
app.post('/api/delete', ensureAuth, async (req, res) => {
  const { id } = req.body;
  console.log(`  → Удаляем задачу ID=${id}`);
  try {
    const conn = await mysql.createConnection(dbConfig);
    const [result] = await conn.execute(
      'DELETE FROM items WHERE id = ?', [id]
    );
    await conn.end();
    console.log(`  ✔ Удалено строк: ${result.affectedRows}`);
    res.json({ success: true });
  } catch (err) {
    console.error(`  ❌ Ошибка при DELETE:`, err);
    res.status(500).json({ error: 'DB error' });
  }
});

// POST /api/edit
app.post('/api/edit', ensureAuth, async (req, res) => {
  const { id, text } = req.body;
  console.log(`  → Редактируем ID=${id} → "${text}"`);
  if (!text || !text.trim()) {
    console.warn(`  ✘ Пустой текст при редактировании`);
    return res.status(400).json({ error: 'Empty text' });
  }
  try {
    const conn = await mysql.createConnection(dbConfig);
    const [result] = await conn.execute(
      'UPDATE items SET text = ? WHERE id = ?', [text.trim(), id]
    );
    await conn.end();
    console.log(`  ✔ Обновлено строк: ${result.affectedRows}`);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(`  ❌ Ошибка при UPDATE:`, err);
    res.status(500).json({ error: 'DB error' });
  }
});

// запуск
app.listen(PORT, () => {
  console.log(`🚀 Server on http://localhost:${PORT}`);
});
