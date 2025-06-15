
# Базовый образ с Node.js 18 LTS на Alpine Linux (легковесный)
FROM node:18-alpine

# Устанавливаем рабочую директорию в контейнере
WORKDIR /usr/src/app

# Копируем package-файлы и устанавливаем зависимости
COPY package*.json ./
RUN npm install --production

# Копируем всё остальное в контейнер
COPY . .

# Открываем порт 3000 для Express
EXPOSE 3000

# Запускаем основное приложение (Express)
CMD ["node", "server.js"]


