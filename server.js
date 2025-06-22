/**
 * server.js — чистый Node.js-сервер без Express, с авторизацией, сессиями в памяти и CRUD API.
 * 
 * Структура файла:
 * 1. Загрузка модулей и конфигурации (.env)
 * 2. Константы и настройка
 * 3. Вспомогательные функции (cookie, парсинг запроса, отправка ответов)
 * 4. Основной HTTP-обработчик: статические файлы, авторизация, API
 * 5. Запуск сервера
 */

////////////////////////////////////////////////////////////////////////////////
// 1. Загрузка модулей и конфигурации
////////////////////////////////////////////////////////////////////////////////

// Загружаем переменные окружения из файла .env в process.env
require('dotenv').config();

// Встроенный модуль http для создания HTTP-сервера
const http   = require('http');
// Встроенный модуль fs для работы с файловой системой (чтение статики)
const fs     = require('fs');
// Встроенный модуль path для формирования путей к файлам (независимо от ОС)
const path   = require('path');
// Встроенный модуль url для разбора URL-запросов
const url    = require('url');
// Модуль crypto для генерации случайных идентификаторов сессий
const crypto = require('crypto');
// Библиотека mysql2/promise для асинхронной работы с MySQL
const mysql  = require('mysql2/promise');
// Модуль querystring для парсинга application/x-www-form-urlencoded
const qs     = require('querystring');

////////////////////////////////////////////////////////////////////////////////
// 2. Константы и настройка
////////////////////////////////////////////////////////////////////////////////

// Хост и порт для прослушивания — берутся из .env или по-умолчанию
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT) || 3000;

// Конфигурация подключения к MySQL — все параметры берутся из .env
const dbConfig = {
  host:     process.env.DB_HOST,    // хост MySQL (обычно имя сервиса в Docker "db")
  user:     process.env.DB_USER,    // имя пользователя MySQL
  password: process.env.DB_PASS,    // пароль пользователя MySQL
  database: process.env.DB_NAME     // имя базы данных
};

// Примитивный «админский» логин/пароль из .env для авторизации в веб-интерфейсе
const ADMIN_USER = process.env.LOGIN_USER ?? process.env.ADMIN_USER;
const ADMIN_PASS = process.env.LOGIN_PASS ?? process.env.ADMIN_PASS;

// Храним сессии в оперативной памяти: Map<sid, { username, created }>
const sessions = new Map();

// MIME-типы для отдачи статических файлов (расширение → Content-Type)
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon'
};

////////////////////////////////////////////////////////////////////////////////
// 3. Вспомогательные функции
////////////////////////////////////////////////////////////////////////////////

/**
 * genSid — генерирует уникальный идентификатор сессии.
 * Использует криптографически стойкий генератор случайных байт.
 */
function genSid() {
  // 16 байт → 32-значный hex-строк
  return crypto.randomBytes(16).toString('hex');
}

/**
 * parseCookies — парсит заголовок Cookie в объект { key: value }
 * @param {string} cookieHeader — содержимое заголовка 'Cookie'
 * @returns {Object} cookies — распарсенные куки
 */
function parseCookies(cookieHeader = '') {
  const cookies = {};
  // Каждый куки-пайр разделён ';'
  cookieHeader.split(';').forEach(pair => {
    // Убираем пробелы вокруг и делим на ключ и значение
    const [k, v] = pair.trim().split('=');
    if (k) cookies[k] = decodeURIComponent(v);
  });
  return cookies;
}

/**
 * readBody — асинхронно читает тело запроса и возвращает строку.
 * Подходит для 'application/json' и 'application/x-www-form-urlencoded'.
 * @param {http.IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    // На каждом фрагменте (chunk) накапливаем
    req.on('data', chunk => { data += chunk; });
    // По окончании чтения отдаем строку
    req.on('end', () => resolve(data));
  });
}

/**
 * sendJson — отправляет JSON-ответ с нужным статусом и параметрами заголовка.
 * @param {http.ServerResponse} res
 * @param {number} code — HTTP-статус
 * @param {Object} obj — объект для сериализации
 */
function sendJson(res, code, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  });
  res.end(data);
}

/**
 * sendFile — читает и отправляет статический файл (HTML/CSS/JS/картинки).
 * Если файл не найден — отдает 404 в JSON.
 * @param {http.ServerResponse} res
 * @param {string} filePath — абсолютный путь к файлу
 */
function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Файл не найден или другая ошибка
      return sendJson(res, 404, { error: 'Not found' });
    }
    // Определяем MIME по расширению
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

/**
 * getAuth — проверяет авторизацию пользователя по cookie.sid.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @returns {Object|null} данные сессии { username, created } или null
 */
function getAuth(req, res) {
  // Парсим куки из заголовка
  const sid = parseCookies(req.headers.cookie).sid;
  if (!sid) return null;
  // Возвращаем данные сессии или null, если не существует
  return sessions.get(sid) || null;
}

/**
 * createSession — создаёт новую сессию, сохраняет её в Map и устанавливает куки.
 * @param {http.ServerResponse} res
 * @param {string} username
 */
function createSession(res, username) {
  const sid = genSid();                      // уникальный id сессии
  sessions.set(sid, { username, created: Date.now() });
  // Устанавливаем куку sid; HttpOnly — недоступна JS; Path=/ — для всех путей
  res.setHeader('Set-Cookie',
    `sid=${sid}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`
  );
}

/**
 * destroySession — удаляет сессию и обнуляет куку на клиенте.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function destroySession(req, res) {
  const sid = parseCookies(req.headers.cookie).sid;
  if (sid) sessions.delete(sid);
  // Сбрасываем куку: Max-Age=0
  res.setHeader('Set-Cookie',
    'sid=; Path=/; Max-Age=0; SameSite=Lax'
  );
}

////////////////////////////////////////////////////////////////////////////////
// 4. Основной HTTP-обработчик
////////////////////////////////////////////////////////////////////////////////

const server = http.createServer(async (req, res) => {
  // Разбираем URL на объект { pathname, query }
  const { pathname } = url.parse(req.url);
  const method = req.method;     // GET, POST и т.д.
  const user   = getAuth(req);   // данные сессии или null

  // Логируем каждый запрос: метод, путь, авторизованность
  console.log(`[${new Date().toISOString()}] ${method} ${pathname}  user=${user?.username || '-'}`);

  // ───── 1) Обслуживание статики ─────
  // Любой GET, который не к /api и не /login, /logout
  if (method === 'GET' && !pathname.startsWith('/api/') && !['/login', '/logout'].includes(pathname)) {
    // Корень "/" выдаёт index.html, но только для авторизованных
    if (pathname === '/') {
      if (!user) {
        // Если неавторизован — перенаправляем на login.html
        res.writeHead(302, { Location: '/login.html' }).end();
        return;
      }
      // Отдаём главную страницу
      sendFile(res, path.join(__dirname, 'index.html'));
      return;
    }
    // Login-страница всегда открыта
    if (pathname === '/login.html') {
      sendFile(res, path.join(__dirname, 'login.html'));
      return;
    }
    // Любой другой путь: пытаемся найти файл в корне проекта
    const filePath = path.join(__dirname, pathname.slice(1));
    sendFile(res, filePath);
    return;
  }

  // ───── 2) Логин / Логаут ─────
  // POST /login — обрабатываем форму логина
  if (method === 'POST' && pathname === '/login') {
    // Считываем тело формы (urlencoded)
    const body = qs.parse(await readBody(req));
    const { username, password } = body;
    // Сравниваем с админскими значениями из .env
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      createSession(res, ADMIN_USER);
      // Успешный логин → редирект на главную
      res.writeHead(302, { Location: '/' }).end();
    } else {
      // Ошибка → редирект на login.html с флагом ?error=1
      res.writeHead(302, { Location: '/login.html?error=1' }).end();
    }
    return;
  }
  // GET /logout — выход из сессии
  if (method === 'GET' && pathname === '/logout') {
    destroySession(req, res);
    res.writeHead(302, { Location: '/login.html' }).end();
    return;
  }

  // ───── 3) REST-API ─────
  // Все /api/* требуют авторизации
  if (!user && pathname.startsWith('/api/')) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  // Открываем соединение с БД только для API
  let conn;
  try {
    if (pathname.startsWith('/api/')) {
      conn = await mysql.createConnection(dbConfig);
    }
  } catch (e) {
    console.error('DB connection error:', e);
    sendJson(res, 500, { error: 'DB connection error' });
    return;
  }

  try {
    // GET /api/items — возвращаем все задачи
    if (method === 'GET' && pathname === '/api/items') {
      const [rows] = await conn.execute('SELECT id, text FROM items');
      sendJson(res, 200, rows);
      return;
    }

    // POST /api/add — добавляем задачу, тело JSON { text }
    if (method === 'POST' && pathname === '/api/add') {
      const { text } = JSON.parse(await readBody(req));
      if (!text || !text.trim()) {
        sendJson(res, 400, { error: 'Empty text' });
        return;
      }
      const [result] = await conn.execute(
        'INSERT INTO items (text) VALUES (?)',
        [text.trim()]
      );
      sendJson(res, 200, { id: result.insertId });
      return;
    }

    // POST /api/delete — удаляем задачу по id
    if (method === 'POST' && pathname === '/api/delete') {
      const { id } = JSON.parse(await readBody(req));
      await conn.execute('DELETE FROM items WHERE id = ?', [id]);
      sendJson(res, 200, { success: true });
      return;
    }

    // POST /api/edit — редактируем задачу { id, text }
    if (method === 'POST' && pathname === '/api/edit') {
      const { id, text } = JSON.parse(await readBody(req));
      if (!text || !text.trim()) {
        sendJson(res, 400, { error: 'Empty text' });
        return;
      }
      const [result] = await conn.execute(
        'UPDATE items SET text = ? WHERE id = ?',
        [text.trim(), id]
      );
      if (result.affectedRows === 0) {
        sendJson(res, 404, { error: 'Not found' });
      } else {
        sendJson(res, 200, { success: true });
      }
      return;
    }

    // Если не подошёл ни один маршрут — 404
    sendJson(res, 404, { error: 'Not found' });

  } catch (e) {
    // Обработка ошибок SQL или парсинга
    console.error('API error:', e);
    sendJson(res, 500, { error: 'Server error' });
  } finally {
    // Закрываем соединение с БД
    if (conn) await conn.end();
  }
});

////////////////////////////////////////////////////////////////////////////////
// 5. Запуск сервера
////////////////////////////////////////////////////////////////////////////////

// Запускаем сервер и слушаем HOST:PORT
server.listen(PORT, HOST, () => {
  console.log(`🚀 Node сервер запущен: http://${HOST}:${PORT}`);
});


