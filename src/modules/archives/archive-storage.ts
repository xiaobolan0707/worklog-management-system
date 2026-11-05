import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { AdministrationError } from "../users/user.service.js";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function validDocx(data: Buffer) {
  // Read the ZIP directory without inflating user-controlled entries.
  let end = data.length - 22;
  const minimum = Math.max(0, data.length - 65_557);
  while (end >= minimum && data.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < minimum || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6)) return false;
  const count = data.readUInt16LE(end + 10);
  if (!count || count > 512) return false;
  let offset = data.readUInt32LE(end + 16);
  let total = 0;
  const names = new Set<string>();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || data.readUInt32LE(offset) !== 0x02014b50) return false;
    const flags = data.readUInt16LE(offset + 8);
    const compressed = data.readUInt32LE(offset + 20);
    const size = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const local = data.readUInt32LE(offset + 42);
    if (offset + 46 + nameLength + extraLength + commentLength > end || local + 30 > data.length || data.readUInt32LE(local) !== 0x04034b50) return false;
    const name = data.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    total += size;
    if ((flags & 1) || total > 50 * 1024 * 1024 || size > Math.max(compressed, 1) * 200 || /(^\/|\\|(^|\/)\.\.(\/|$)|vbaProject\.bin$)/i.test(name)) return false;
    names.add(name);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names.has("[Content_Types].xml") && names.has("word/document.xml");
}

export function validateAttachment(name: string, data: Buffer) {
  if (!name.trim() || name.length > 200 || /[\x00-\x1f\x7f/\\]/.test(name) || data.length === 0 || data.length > MAX_ATTACHMENT_BYTES) {
    throw new AdministrationError(400, "INVALID_ATTACHMENT", "文件名无效或文件超过 10MB，请重新选择");
  }
  const extension = extname(name).toLowerCase();
  let mimeType: string | null = null;
  if (extension === ".pdf" && data.subarray(0, 5).toString() === "%PDF-") mimeType = "application/pdf";
  if ([".jpg", ".jpeg"].includes(extension) && data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) mimeType = "image/jpeg";
  if (extension === ".png" && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mimeType = "image/png";
  if (extension === ".docx" && data.length >= 22 && validDocx(data)) mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (!mimeType) throw new AdministrationError(400, "INVALID_ATTACHMENT_TYPE", "仅支持内容有效的 PDF、JPG、PNG 或 DOCX 文件");
  return { name: name.trim(), mimeType, size: data.length };
}

export class ArchiveStorage {
  constructor(private readonly root: string) {}
  private path(key: string) {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error("Invalid private storage key");
    return resolve(this.root, key);
  }
  async save(data: Buffer) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const key = randomUUID();
    await writeFile(this.path(key), data, { flag: "wx", mode: 0o600 });
    return key;
  }
  read(key: string) { return readFile(this.path(key)); }
  async remove(key: string) {
    try { await unlink(this.path(key)); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  }
  async sweepUnreferenced(referenced: ReadonlySet<string>) {
    let keys: string[];
    try { keys = await readdir(this.root); }
    catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return; throw error; }
    for (const key of keys) {
      if (!/^[a-f0-9-]{36}$/.test(key) || referenced.has(key)) continue;
      const metadata = await stat(this.path(key)).catch(() => null);
      // Keep in-flight uploads; clean leftovers from a failed DB commit only after one day.
      if (metadata?.isFile() && metadata.mtimeMs < Date.now() - 86_400_000) await this.remove(key);
    }
  }
}
