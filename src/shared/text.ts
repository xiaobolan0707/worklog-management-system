export function effectiveCharacterCount(value: string) {
  return Array.from(value.replace(/\s/gu, "")).length;
}

/**
 * base64 字符串的真实解码字节数。
 * 服务端按 `Buffer.byteLength(base64, "base64") === size` 校验图片完整性，
 * 因此调用方不能按「长度 ×0.75」估算：省略 padding 会在原始字节数不能被 3 整除时
 * 偏大 1–2 字节，导致日志保存/提交被判为校验失败。
 */
export function base64ByteLength(base64: string) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor(base64.length * 3 / 4) - padding;
}

/** 取 data URL 中的 base64 载荷。 */
export function dataUrlPayload(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  return comma < 0 ? "" : dataUrl.slice(comma + 1);
}
