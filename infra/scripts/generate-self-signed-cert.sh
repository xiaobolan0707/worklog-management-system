#!/bin/sh
# 生成仅供本地/内网联调使用的自签证书。生产环境请替换为受信任 CA 签发的正式证书。
set -eu

TARGET_DIR="${1:-$(dirname "$0")/../nginx/certs}"
mkdir -p "$TARGET_DIR"

if [ -f "$TARGET_DIR/fullchain.pem" ] || [ -f "$TARGET_DIR/privkey.pem" ]; then
  echo "证书已存在：$TARGET_DIR（如需重建请先移除旧文件）" >&2
  exit 1
fi

openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout "$TARGET_DIR/privkey.pem" \
  -out "$TARGET_DIR/fullchain.pem" \
  -subj "/CN=worklog.local" \
  -addext "subjectAltName=DNS:worklog.local,DNS:localhost,IP:127.0.0.1"

chmod 600 "$TARGET_DIR/privkey.pem"
echo "已生成自签证书：$TARGET_DIR"
echo "注意：自签证书不受浏览器信任，仅限联调使用，生产必须替换为正式证书。"
