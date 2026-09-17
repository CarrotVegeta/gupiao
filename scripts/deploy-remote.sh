#!/usr/bin/env bash
# 部署股票看板到远程服务器（release 目录 + systemd 切换方式）
#
# 用法：
#   ./scripts/deploy-remote.sh              # 先 build，再发布
#   ./scripts/deploy-remote.sh --skip-build # 直接发布现有 dist/dist-server
#
# 服务器凭据来源（按优先级）：
#   1. 环境变量 DEPLOY_HOST / DEPLOY_USER / DEPLOY_PASS
#   2. 仓库根目录 local-secrets.md（第 1 行说明、第 2 行地址、第 3 行用户、第 4 行密码）
#
# 发布结果：
#   /opt/stock-dashboard/releases/<时间戳>-<commit>[-local]/
#   systemd 单元 stock-dashboard.service 指向新 release，出问题可用 rollback/ 下的备份回滚。
#
# 运行时布局说明（重要）：
#   node 运行时放在 /opt/stock-dashboard/runtime（release 之外），ExecStart 直接使用该固定路径。
#   不要把运行时放回 releases/<release>/runtime 再靠软链解析：在本机 ext4 + AliHips 环境下，
#   凡是指向名为 runtime 目录的软链，其下可执行文件的 execve 会返回 ENOENT（stat/open 正常，
#   仅 execve 失败），会导致 systemd 报 status=203/EXEC。指向 runtime/bin 的软链则正常。

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_NAME="stock-dashboard"
BASE_DIR="/opt/${APP_NAME}"
RELEASES_DIR="${BASE_DIR}/releases"
ROLLBACK_DIR="${BASE_DIR}/rollback"
UNIT="/etc/systemd/system/${APP_NAME}.service"
# node 运行时固定在 BASE_DIR/runtime（不在 releases 内，避免被清理逻辑误删）。
# 切勿把运行时放回 releases/<release>/runtime：execve 经该层软链会返回 ENOENT（见下方“运行时布局说明”）。
RUNTIME_DIR="${BASE_DIR}/runtime"
# 共享 node_modules 的宿主 release（免去每台机器重复安装依赖）。
# 该目录含全站唯一的 node_modules，**必须**排除在 releases 清理之外。
SHARED_RELEASE="20260827-1619-788afd6c8ddd"
SHARED_DIR="${RELEASES_DIR}/${SHARED_RELEASE}"
# releases 清理时保留的最近发布数
KEEP_RELEASES=5
PORT="3001"

SKIP_BUILD=0
case "${1:-}" in
  --skip-build) SKIP_BUILD=1 ;;
  -h|--help)
    sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  "") ;;
  *) echo "未知参数：$1（可用：--skip-build | --help）" >&2; exit 2 ;;
esac

# ---------- 解析凭据 ----------
SECRETS_FILE="${ROOT_DIR}/local-secrets.md"
if [[ -z "${DEPLOY_HOST:-}" && -f "$SECRETS_FILE" ]]; then
  DEPLOY_HOST="$(sed -n '2p' "$SECRETS_FILE" | tr -d '[:space:]')"
  DEPLOY_USER="$(sed -n '3p' "$SECRETS_FILE" | tr -d '[:space:]')"
  DEPLOY_PASS="$(sed -n '4p' "$SECRETS_FILE" | tr -d '[:space:]')"
fi
DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-root}"
: "${DEPLOY_PASS:?缺少 SSH 密码：请设置 DEPLOY_PASS 或提供 local-secrets.md}"
: "${DEPLOY_HOST:?缺少服务器地址：请设置 DEPLOY_HOST 或提供 local-secrets.md}"

SSH_OPTS=(-o StrictHostKeyChecking=no -o ConnectTimeout=15)
rsh() { sshpass -p "$DEPLOY_PASS" ssh "${SSH_OPTS[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "$@"; }

# ---------- 构建 ----------
if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "==> 构建前端与服务端"
  npm run build
fi

for f in dist/index.html dist-server/server/index.js; do
  [[ -f "$f" ]] || { echo "缺少构建产物：$f（先执行 npm run build）" >&2; exit 1; }
done

# ---------- 生成发布号 ----------
COMMIT="$(git rev-parse --short=12 HEAD)"
STAMP="$(TZ=Asia/Shanghai date +%Y%m%d-%H%M)"
SUFFIX=""
if [[ -n "$(git status --porcelain)" ]]; then
  SUFFIX="-local"   # 工作区有未提交改动
fi
RELEASE="${STAMP}-${COMMIT}${SUFFIX}"
DEST="${RELEASES_DIR}/${RELEASE}"

echo "==> 目标：${DEPLOY_USER}@${DEPLOY_HOST}:${DEST}"

# ---------- 传输 ----------
rsh "mkdir -p '${DEST}' && chmod 755 '${RELEASES_DIR}'"
sshpass -p "$DEPLOY_PASS" rsync -az --delete -e "ssh ${SSH_OPTS[*]}" \
  dist dist-server package.json package-lock.json \
  "${DEPLOY_USER}@${DEPLOY_HOST}:${DEST}/"

# ---------- 权限、软链、清单 ----------
rsh "set -e
  ln -sfn '${RUNTIME_DIR}' '${DEST}/runtime'
  ln -sfn '${SHARED_DIR}/node_modules' '${DEST}/node_modules'
  chown -h ${APP_NAME}:${APP_NAME} '${DEST}/runtime' '${DEST}/node_modules'
  chown -R ${APP_NAME}:${APP_NAME} '${DEST}'
  find '${DEST}' -type d -exec chmod 755 {} +
  find '${DEST}' -type f -exec chmod 644 {} +
  cd '${DEST}' && find dist dist-server package.json package-lock.json -type f -print0 \
    | sort -z | xargs -0 sha256sum > ARTIFACT.sha256
  chown ${APP_NAME}:${APP_NAME} '${DEST}/ARTIFACT.sha256'
  '${RUNTIME_DIR}/bin/node' -v"

# ---------- 前置校验：共享依赖必须可用 ----------
rsh "set -e
  test -x '${RUNTIME_DIR}/bin/node' || { echo '缺少 node 运行时：${RUNTIME_DIR}/bin/node' >&2; exit 1; }
  test -d '${SHARED_DIR}/node_modules/express' || { echo '缺少共享 node_modules：${SHARED_DIR}/node_modules' >&2; exit 1; }"

# ---------- 备份 unit 并切换 ----------
rsh "set -e
  mkdir -p '${ROLLBACK_DIR}'
  cp -p '${UNIT}' '${ROLLBACK_DIR}/${APP_NAME}-${RELEASE}-before.service'
  sed -i -E 's#^WorkingDirectory=.*#WorkingDirectory=${DEST}#; s#^ExecStart=.*#ExecStart=${RUNTIME_DIR}/bin/node ${DEST}/dist-server/server/index.js#' '${UNIT}'
  systemctl daemon-reload
  systemctl restart '${APP_NAME}.service'
  sleep 4
  systemctl is-active '${APP_NAME}.service'"

# ---------- 健康检查 ----------
echo "==> 健康检查"
rsh "set -e
  B=http://127.0.0.1:${PORT}
  code=\$(curl -s -m 15 -o /dev/null -w '%{http_code}' \$B/)
  echo \"首页 \$code\"
  [[ \"\$code\" == \"200\" ]]
  for api in market-overview limit-up dragon-tiger auction stock-search?query=%E8%8C%85%E5%8F%B0; do
    printf '  %-28s %s\n' \"\$api\" \"\$(curl -s -m 25 -o /dev/null -w '%{http_code}' \"\$B/api/\$api\")\"
  done
  systemctl is-active '${APP_NAME}.service'"

# ---------- 清理旧发布（务必保留共享 node_modules 宿主） ----------
# 历史 bug：无差别删除 releases/* 会连带删掉 SHARED_DIR，即全站唯一的 node_modules。
# 运行中的进程靠已删除的文件句柄还能短暂存活，但服务一旦重启就会因缺少依赖而失败。
if [[ "${SKIP_CLEAN:-0}" != "1" ]]; then
  echo "==> 清理旧发布（保留最近 ${KEEP_RELEASES} 个 + 共享 release）"
  rsh "set -e
    cd '${RELEASES_DIR}'
    keep=\$(ls -1dt */ 2>/dev/null | head -${KEEP_RELEASES} | sed 's|/\$||')
    for d in */; do
      d=\"\${d%/}\"
      [[ \"\$d\" == \"${SHARED_RELEASE}\" ]] && continue
      printf '%s\n' \"\$keep\" | grep -qx \"\$d\" && continue
      echo \"  删除 \$d\"
      rm -rf -- \"\$d\"
    done
    test -d '${SHARED_DIR}/node_modules/express' || { echo '清理后共享 node_modules 丢失' >&2; exit 1; }
    ls -1dt */ | head"
fi

echo
echo "==> 部署完成：http://${DEPLOY_HOST}:${PORT}/"
echo "    发布号：${RELEASE}"
echo "    回滚：sed -i -E 's#^WorkingDirectory=.*#WorkingDirectory=${RELEASES_DIR}/<旧发布号>#; s#^ExecStart=.*#ExecStart=${RUNTIME_DIR}/bin/node ${RELEASES_DIR}/<旧发布号>/dist-server/server/index.js#' ${UNIT} && systemctl daemon-reload && systemctl restart ${APP_NAME}.service"
