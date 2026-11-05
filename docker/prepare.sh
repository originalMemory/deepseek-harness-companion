#!/bin/sh
# 复用 Unraid 容器的本地镜像、环境和挂载，停止服务后明确执行源码构建。
set -eu

container=${1:-dsh}
umask 077
task_env=$(mktemp)
cleanup() { rm -f "$task_env"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker inspect --type container --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" > "$task_env"
image=$(docker inspect --type container --format '{{.Image}}' "$container")
user=$(docker inspect --type container --format '{{.Config.User}}' "$container")
mounts=$(docker inspect --type container --format '{{range .Mounts}}{{println .Destination}}{{end}}' "$container")
for target in /opt/dsh /opt/dsh/node_modules /pnpm/store /data /workspace; do
  if ! printf '%s\n' "$mounts" | grep -Fx "$target" >/dev/null; then
    printf '缺少必要挂载 %s，请先修正 Unraid 容器配置，再执行准备。\n' "$target" >&2
    exit 1
  fi
done
docker stop "$container" >/dev/null

set -- docker run --rm --pull=never --network bridge --volumes-from "$container" --env-file "$task_env"
if [ -n "$user" ]; then set -- "$@" --user "$user"; fi
"$@" "$image" prepare

printf '构建完成，请从 Unraid Docker 页面启动 %s。\n' "$container"
