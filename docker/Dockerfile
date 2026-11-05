FROM node:24-bookworm-slim

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends --yes \
       bubblewrap build-essential ca-certificates curl git musl-tools openssh-client python3 python3-pip tini tzdata util-linux \
    && npm install --global pnpm@11.28.5 \
    && rm -rf /var/lib/apt/lists/* \
    && usermod --uid 99 --gid 100 --home /data/user node \
    && mkdir -p /data/source /data/pnpm-store /workspace \
    && chown 99:100 /data /data/source /data/pnpm-store /workspace

ENV DSH_HOME=/data/dsh \
    DSH_AGENTS_HOME=/data/dsh/agents \
    HOME=/data/user \
    XDG_CACHE_HOME=/data/cache \
    PATH="${PATH}:/data/user/.local/bin" \
    pnpm_config_store_dir=/data/pnpm-store \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1

USER node
WORKDIR /data/source
EXPOSE 3080
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "flock", "-n", "-E", "75", "/data/pnpm-store/.dsh-docker.lock", "node", "/data/source/docker/run.mjs"]
CMD ["serve"]
