FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 5174
CMD ["npm", "run", "dev"]
