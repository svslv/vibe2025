-- Создать БД и таблицу задач
CREATE DATABASE IF NOT EXISTS todolist;
USE todolist;

CREATE TABLE IF NOT EXISTS items (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  text VARCHAR(255) NOT NULL
);
