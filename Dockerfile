# Build and run the Glassboard multiplayer server (Rust) for deployment.
# The build context is the repo root, so the server's path dependency on
# core/engine resolves. Fly.io builds this remotely — no local Docker needed.

FROM rust:1-slim-bookworm AS builder
WORKDIR /app
COPY . .
RUN cargo build --release --manifest-path server/Cargo.toml

FROM debian:bookworm-slim
RUN useradd -m app
COPY --from=builder /app/server/target/release/glassboard-server /usr/local/bin/glassboard-server
USER app
# Fly's http_service terminates TLS and forwards to this internal port.
ENV GLASSBOARD_ADDR=0.0.0.0:8080
EXPOSE 8080
CMD ["glassboard-server"]
