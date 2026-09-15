FROM node:24-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
ENV VITE_API_BASE_URL=/api/v1
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 FRONTEND_DIST=/app/frontend/dist
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY --from=frontend /build/dist /app/frontend/dist
RUN useradd --create-home --uid 10001 appuser
USER appuser
EXPOSE 10000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
