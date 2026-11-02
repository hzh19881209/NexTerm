#!/usr/bin/env bash
# Update the NexTerm version, rebuild the selected Compose service, restart it,
# and verify the running API reports the same version.
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="${NEXTERM_COMPOSE_SERVICE:-termhub}"
NO_CACHE=0

usage() {
  cat <<'USAGE'
用法：
  ./scripts/release.sh [--no-cache]

默认使用 Docker 构建缓存；传入 --no-cache 会强制重新安装依赖并完整构建镜像。
也可以通过 NEXTERM_COMPOSE_SERVICE 指定 Compose 服务名（默认 termhub）。
USAGE
}

for argument in "$@"; do
  case "$argument" in
    --no-cache) NO_CACHE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$argument" >&2; usage >&2; exit 2 ;;
  esac
done

die() { echo "发布失败：$*" >&2; exit 1; }
trap 'echo "发布失败：第 ${LINENO} 行执行出错。" >&2' ERR

cd "$ROOT"
command -v python3 >/dev/null 2>&1 || die "未找到 python3。"
command -v docker >/dev/null 2>&1 || die "未找到 docker。"
docker compose version >/dev/null 2>&1 || die "当前 Docker 不支持 docker compose。"
docker compose config --services | grep -Fxq "$SERVICE" || die "Compose 服务不存在：$SERVICE"

echo "[1/5] 根据本地时间更新项目版本号…"
python3 "$ROOT/update_version.py"
VERSION="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["version"])' "$ROOT/public/version.json")"
[[ "$VERSION" =~ ^[0-9]{2}\.[0-9]{1,2}\.[0-9]+$ ]] || die "生成的版本号格式异常：$VERSION"
echo "项目版本：$VERSION"

echo "[2/5] 构建 Docker 镜像（服务：$SERVICE）…"
if [[ "$NO_CACHE" == "1" ]]; then
  docker compose build --no-cache "$SERVICE"
else
  docker compose build "$SERVICE"
fi

echo "[3/5] 重新创建并启动容器…"
echo "注意：重启会中断当前容器内的 SSH/Codex 进程。"
docker compose up -d --force-recreate "$SERVICE"

echo "[4/5] 等待容器启动并检查 API…"
container_id=""
health_json=""
for attempt in $(seq 1 30); do
  container_id="$(docker compose ps -q "$SERVICE" | sed -n '1p')"
  if [[ -n "$container_id" ]] && [[ "$(docker inspect -f '{{.State.Running}}' "$container_id" 2>/dev/null || true)" == "true" ]]; then
    if health_json="$(docker compose exec -T "$SERVICE" node -e 'const https=require("https");let body="";const request=https.get({host:"127.0.0.1",port:Number(process.env.PORT||3000),path:"/api/health",rejectUnauthorized:false},(response)=>{response.setEncoding("utf8");response.on("data",(chunk)=>{body+=chunk});response.on("end",()=>{process.stdout.write(body);process.exit(response.statusCode===200?0:1)})});request.setTimeout(3000,()=>{request.destroy();process.exit(2)});request.on("error",()=>process.exit(3));' 2>/dev/null)"; then
      break
    fi
  fi
  health_json=""
  sleep 1
done

[[ -n "$container_id" ]] || die "没有找到运行中的容器。"
[[ -n "$health_json" ]] || { docker compose logs --tail=80 "$SERVICE" >&2 || true; die "容器未通过 /api/health 检查。"; }
runtime_ok="$(printf '%s' "$health_json" | python3 -c 'import json, sys; print("true" if json.load(sys.stdin).get("ok") is True else "false")')"
runtime_version="$(printf '%s' "$health_json" | python3 -c 'import json, sys; print(json.load(sys.stdin).get("version", ""))')"
[[ "$runtime_ok" == "true" ]] || die "容器健康接口返回异常：$health_json"
[[ "$runtime_version" == "$VERSION" ]] || die "容器版本不一致：项目=$VERSION，运行中=$runtime_version"

echo "[5/5] 发布检查完成。"
echo "容器：$container_id（运行中）"
echo "项目版本：$VERSION"
echo "运行中 API 版本：$runtime_version"
