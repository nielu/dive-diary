# Build the frontend, then ship it inside a small PocketBase image.
# Works on Railway, Fly.io or any Docker host. Mount persistent storage at /pb/pb_data.
FROM node:22-alpine AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build   # writes to ../backend/pb_public

FROM alpine:3.22
ARG PB_VERSION=0.40.6
ARG TARGETARCH=amd64
RUN apk add --no-cache ca-certificates unzip wget \
 && wget -q https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip -O /tmp/pb.zip \
 && unzip /tmp/pb.zip pocketbase -d /pb && rm /tmp/pb.zip
COPY backend/pb_migrations /pb/pb_migrations
COPY backend/pb_hooks /pb/pb_hooks
COPY --from=web /app/backend/pb_public /pb/pb_public

EXPOSE 8090
# Hosts like Railway pass the port in $PORT.
CMD ["sh", "-c", "exec /pb/pocketbase serve --http=0.0.0.0:${PORT:-8090} --dir=/pb/pb_data --publicDir=/pb/pb_public --hooksDir=/pb/pb_hooks --migrationsDir=/pb/pb_migrations"]
