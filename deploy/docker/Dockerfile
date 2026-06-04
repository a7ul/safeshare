# Stage 1: build the React frontend
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: run the Deno server with the built frontend embedded
FROM denoland/deno:2.7.7
WORKDIR /app

# Copy server source
COPY main.ts ./
COPY src/ ./src/
COPY deno.json ./
COPY deno.lock ./

# Copy built frontend from stage 1
COPY --from=frontend /app/frontend/dist ./frontend/dist

# Cache Deno dependencies at build time (no network needed at runtime)
RUN deno cache main.ts

EXPOSE 8000

ENV PORT=8000
ENV STORAGE_DIR=/data
ENV LINK_TTL_DAYS=30

# Storage volume — mount a PVC or host path here
VOLUME ["/data"]

CMD ["run", "--allow-read", "--allow-write", "--allow-net", "--allow-env", "main.ts"]
