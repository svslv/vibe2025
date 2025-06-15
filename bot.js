// bot.js — полностью рабочий Telegram-бот для ToDo

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mysql       = require('mysql2/promise');

// Создаём бота в режиме polling
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Конфигурация MySQL (та же, что и для сервера)
const dbConfig = {
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
};

// Текст справки
const HELP = `
*ToDo-бот* готов к работе!  
Используй команды:
• /help — справка  
• /add _текст_ — добавить задачу  
• /list — показать все задачи  
• /edit _id_ _новый текст_ — изменить задачу  
• /delete _id_ — удалить задачу
`;

// Обработчик /start и /help
bot.onText(/\/(start|help)/, msg => {
  bot.sendMessage(msg.chat.id, HELP, { parse_mode: 'Markdown' });
});

// Добавление задачи: /add текст задачи
bot.onText(/\/add (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const text = match[1].trim();
  if (!text) {
    return bot.sendMessage(chatId, '❗️ Текст задачи не может быть пустым.');
  }
  try {
    const conn = await mysql.createConnection(dbConfig);
    const [result] = await conn.execute(
      'INSERT INTO items (text) VALUES (?)',
      [text]
    );
    await conn.end();
    bot.sendMessage(
      chatId,
      `✅ Задача добавлена под номером *${result.insertId}*.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Error INSERT:', err);
    bot.sendMessage(chatId, '❌ Ошибка при добавлении задачи.');
  }
});

// Список задач: /list
bot.onText(/\/list/, async msg => {
  const chatId = msg.chat.id;
  try {
    const conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute(
      'SELECT id, text FROM items ORDER BY id'
    );
    await conn.end();
    if (rows.length === 0) {
      return bot.sendMessage(chatId, '📋 Список задач пуст.');
    }
    const text = rows.map(r => `*${r.id}*. ${r.text}`).join('\n');
    bot.sendMessage(chatId, `📋 Текущий список задач:\n${text}`, {
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('Error SELECT:', err);
    bot.sendMessage(chatId, '❌ Ошибка при получении списка.');
  }
});

// Редактирование: /edit id новый текст
bot.onText(/\/edit (\d+) (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const id = parseInt(match[1], 10);
  const newText = match[2].trim();
  if (!newText) {
    return bot.sendMessage(chatId, '❗️ Новый текст не может быть пустым.');
  }
  try {
    const conn = await mysql.createConnection(dbConfig);
    const [result] = await conn.execute(
      'UPDATE items SET text = ? WHERE id = ?',
      [newText, id]
    );
    await conn.end();
    if (result.affectedRows === 0) {
      return bot.sendMessage(
        chatId,
        `❓ Задача с ID ${id} не найдена.`
      );
    }
    bot.sendMessage(
      chatId,
      `✅ Задача *${id}* обновлена.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Error UPDATE:', err);
    bot.sendMessage(chatId, '❌ Ошибка при редактировании задачи.');
  }
});

// Удаление: /delete id
bot.onText(/\/delete (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const id = parseInt(match[1], 10);
  try {
    const conn = await mysql.createConnection(dbConfig);
    const [result] = await conn.execute(
      'DELETE FROM items WHERE id = ?',
      [id]
    );
    await conn.end();
    if (result.affectedRows === 0) {
      return bot.sendMessage(
        chatId,
        `❓ Задача с ID ${id} не найдена.`
      );
    }
    bot.sendMessage(chatId, `🗑️ Задача *${id}* удалена.`, {
      parse_mode: 'Markdown'
    });
  } catch (err) {
    console.error('Error DELETE:', err);
    bot.sendMessage(chatId, '❌ Ошибка при удалении задачи.');
  }
});

// Ловим все остальные сообщения
bot.on('message', msg => {
  const text = msg.text || '';
  if (!/^\/(add|list|edit|delete|start|help)/.test(text)) {
    bot.sendMessage(
      msg.chat.id,
      'Неизвестная команда. Введите /help для списка команд.'
    );
  }
});
