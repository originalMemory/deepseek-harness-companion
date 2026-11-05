FROM node:24-bookworm-slim

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends --yes \
       bubblewrap build-essential ca-certificates curl git musl-tools openssh-client python3 python3-pip tini tzdata util-linux \
    && npm install --global pnpm@11.28.5 \
    && rm -rf /var/lib/apt/lists/* \
    && usermod --uid 99 --gid 100 --home /data/user node \
    && mkdir -p /opt/dsh/node_modules /data /workspace /pnpm/store \
    && chown 99:100 /opt/dsh/node_modules /data /workspace /pnpm/store

ENV DSH_HOME=/data/dsh \
    DSH_AGENTS_HOME=/data/dsh/agents \
    HOME=/data/user \
    XDG_CACHE_HOME=/data/cache \
    PATH="${PATH}:/data/user/.local/bin" \
    npm_config_store_dir=/pnpm/store \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1

USER node
WORKDIR /opt/dsh
EXPOSE 3080
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "flock", "-n", "-E", "75", "/pnpm/store/.dsh-docker.lock", "node", "/opt/dsh/docker/run.mjs"]
CMD ["serve"]
