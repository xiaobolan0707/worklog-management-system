import type { PrismaClient } from "../../generated/prisma/client.js";
import type { AuthUserRecord } from "../auth/auth.repository.js";
import { AdministrationError } from "../users/user.service.js";
import { appendAudit } from "../audit/audit.repository.js";
import { PrismaLogRepository } from "../logs/log.repository.js";
import { ArchiveStorage, validateAttachment } from "./archive-storage.js";

type Actor = Pick<AuthUserRecord, "id" | "role" | "employmentStatus">;
export type AttachmentCategory = "RESUME" | "DEGREE" | "AGREEMENT";
export const availableArchive = { deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null };
const archiveSelect = {
  id: true, username: true, displayName: true, gender: true, departmentId: true,
  employeeNumber: true, numberDepartmentId: true, hireDate: true, departureDate: true,
  employmentStatus: true, createdAt: true, recycledAt: true, archivePurgingAt: true,
  department: { select: { name: true } },
  archiveAttachments: { where: { deletedAt: null }, select: { id: true, category: true, name: true, mimeType: true, size: true, createdAt: true }, orderBy: { createdAt: "desc" as const } }
} as const;

export class ArchiveService {
  constructor(private readonly database: PrismaClient, private readonly storage: ArchiveStorage, private readonly now: () => Date = () => new Date()) {}

  private role(actor: Actor, bin = false) {
    if (bin ? actor.role !== "MANAGEMENT" : !["EMPLOYEE", "LEADER", "MANAGEMENT"].includes(actor.role)) {
      throw new AdministrationError(403, "FORBIDDEN", "无权查看员工档案");
    }
  }

  private async scope(actor: Actor, id: string, bin = false) {
    this.role(actor, bin);
    const user = await this.database.user.findFirst({ where: { id, role: { in: ["EMPLOYEE", "LEADER", "MANAGEMENT"] }, ...(bin ? { recycledAt: { not: null }, archivePurgingAt: null, archivePurgedAt: null } : availableArchive) }, select: archiveSelect });
    if (!user) throw new AdministrationError(404, "ARCHIVE_NOT_FOUND", "员工档案不存在或已移入回收站");
    if (!bin && actor.id !== id && (actor.role === "EMPLOYEE" || actor.employmentStatus === "DEPARTED")) throw new AdministrationError(403, "FORBIDDEN", "仅可查看本人员工档案");
    if (!bin && actor.role === "LEADER" && actor.id !== id) {
      const leader = await this.database.user.findUnique({ where: { id: actor.id }, select: { departmentId: true } });
      if (!leader?.departmentId || leader.departmentId !== user.departmentId) throw new AdministrationError(403, "FORBIDDEN", "仅可查看本部门员工档案");
    }
    return user;
  }

  async list(actor: Actor) {
    this.role(actor);
    let departmentId: string | undefined;
    if (actor.role === "LEADER") {
      const leader = await this.database.user.findUnique({ where: { id: actor.id }, select: { departmentId: true } });
      if (leader?.departmentId) departmentId = leader.departmentId;
      else return { employees: [] };
    }
    const users = await this.database.user.findMany({ where: { ...availableArchive, role: { in: ["EMPLOYEE", "LEADER", "MANAGEMENT"] },
      ...(actor.role === "EMPLOYEE" || actor.employmentStatus === "DEPARTED" ? { id: actor.id } : departmentId ? { departmentId } : {}) },
      select: { id: true, displayName: true, departmentId: true, department: { select: { name: true } }, employmentStatus: true, employeeNumber: true, numberDepartmentId: true }, orderBy: { displayName: "asc" } });
    return { employees: users.map(({ department, ...user }) => ({ ...user, departmentName: department?.name ?? "未分配部门" })) };
  }

  async get(actor: Actor, id: string, bin = false) {
    const user = await this.scope(actor, id, bin);
    const activation = await this.database.systemSetting.findUnique({ where: { key: "employee-archives.enabled-at" }, select: { value: true } });
    const enabledAt = typeof activation?.value === "string" ? new Date(activation.value) : null;
    if (!enabledAt || !Number.isFinite(enabledAt.getTime())) throw new AdministrationError(503, "ARCHIVES_NOT_ENABLED", "档案启用时间未初始化，请先完成数据库迁移");
    const completionDeadline = new Date(Math.max(enabledAt.getTime(), user.createdAt.getTime()) + 7 * 86_400_000);
    const numberDepartment = user.numberDepartmentId ? await this.database.department.findUnique({ where: { id: user.numberDepartmentId }, select: { name: true, employeeNumberPrefix: true } }) : null;
    const missing = [!user.displayName?.trim() && "员工姓名", !user.gender && "性别", !user.departmentId && "所属部门", !user.hireDate && "入职日期", !user.employeeNumber && "工号",
      ...(["RESUME", "DEGREE", "AGREEMENT"] as const).map((category) => !user.archiveAttachments.some((file) => file.category === category) && ({ RESUME: "入职简历", DEGREE: "学历证明", AGREEMENT: "劳动合同／合伙人协议" }[category]))].filter(Boolean) as string[];
    const { archiveAttachments, department, archivePurgingAt: _purging, ...profile } = user;
    return { archive: { ...profile, departmentName: department?.name ?? "未分配部门", numberDepartmentName: numberDepartment?.name ?? null,
      employeeNumberDisplay: user.employeeNumber ? `${numberDepartment?.employeeNumberPrefix || `${numberDepartment?.name ?? "原部门"} `}${String(user.employeeNumber).padStart(4, "0")}` : null,
      completionDeadline, complete: missing.length === 0, missing, canEdit: !bin && actor.id === id && user.employmentStatus === "ACTIVE", attachments: archiveAttachments } };
  }

  private async writable(actor: Actor, id: string) {
    await this.scope(actor, id);
    if (actor.id !== id) throw new AdministrationError(403, "FORBIDDEN", "只能修改本人档案");
  }

  async update(actor: Actor, id: string, input: { displayName: string; gender: string }) {
    await this.writable(actor, id);
    const changed = await this.database.user.updateMany({ where: { id, employmentStatus: "ACTIVE", ...availableArchive }, data: input });
    if (changed.count !== 1) throw new AdministrationError(409, "ARCHIVE_READ_ONLY", "档案已只读，请刷新后重试");
    await appendAudit(this.database, { actorId: actor.id, subjectUserId: id, action: "ARCHIVE_UPDATED", entityType: "User", entityId: id, metadata: {} });
    return this.get(actor, id);
  }

  async upload(actor: Actor, id: string, input: { category: AttachmentCategory; name: string; data: string }) {
    await this.writable(actor, id);
    const data = Buffer.from(input.data, "base64");
    if (data.toString("base64") !== input.data) throw new AdministrationError(400, "INVALID_ATTACHMENT", "文件编码无效，请重新上传");
    const metadata = validateAttachment(input.name, data);
    const storageKey = await this.storage.save(data);
    try {
      await this.database.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
        const user = await transaction.user.findFirst({ where: { id, employmentStatus: "ACTIVE", ...availableArchive }, select: { id: true } });
        if (!user) throw new AdministrationError(409, "ARCHIVE_READ_ONLY", "档案已只读，无法上传附件");
        if (await transaction.employeeAttachment.count({ where: { userId: id, category: input.category, deletedAt: null } }) >= 10) throw new AdministrationError(409, "ATTACHMENT_LIMIT", "每类最多保留 10 份附件，请先删除旧文件");
        await transaction.employeeAttachment.create({ data: { userId: id, category: input.category, ...metadata, storageKey } });
        await appendAudit(transaction, { actorId: actor.id, subjectUserId: id, action: "ARCHIVE_ATTACHMENT_UPLOADED", entityType: "User", entityId: id, metadata: {} });
      });
    } catch (error) { await this.storage.remove(storageKey); throw error; }
    return this.get(actor, id);
  }

  async remove(actor: Actor, id: string, attachmentId: string) {
    await this.writable(actor, id);
    const storageKey = await this.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
      const user = await transaction.user.findFirst({ where: { id, employmentStatus: "ACTIVE", ...availableArchive }, select: { id: true } });
      if (!user) throw new AdministrationError(409, "ARCHIVE_READ_ONLY", "档案已只读，无法删除附件");
      const file = await transaction.employeeAttachment.findFirst({ where: { id: attachmentId, userId: id } });
      if (!file) throw new AdministrationError(404, "ATTACHMENT_NOT_FOUND", "附件不存在");
      await transaction.employeeAttachment.update({ where: { id: attachmentId }, data: { deletedAt: this.now() } });
      await appendAudit(transaction, { actorId: actor.id, subjectUserId: id, action: "ARCHIVE_ATTACHMENT_DELETED", entityType: "User", entityId: id, metadata: {} });
      return file.storageKey;
    });
    try { await this.storage.remove(storageKey); }
    catch { throw new AdministrationError(503, "ATTACHMENT_DELETE_PENDING", "附件已标记删除，存储暂不可用，系统将自动重试清理"); }
    await this.database.employeeAttachment.deleteMany({ where: { id: attachmentId, userId: id, deletedAt: { not: null } } });
    return this.get(actor, id);
  }

  async download(actor: Actor, id: string, attachmentId: string, bin = false) {
    await this.scope(actor, id, bin);
    const file = await this.database.employeeAttachment.findFirst({ where: { id: attachmentId, userId: id, deletedAt: null }, select: { storageKey: true, name: true, mimeType: true } });
    if (!file) throw new AdministrationError(404, "ATTACHMENT_NOT_FOUND", "附件不存在");
    try { return { name: file.name, mimeType: file.mimeType, data: await this.storage.read(file.storageKey) }; }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") throw new AdministrationError(409, "ATTACHMENT_UNAVAILABLE", "附件文件暂不可用，请联系管理员检查存储");
      throw error;
    }
  }

  async recycledLogs(actor: Actor, id: string) {
    await this.scope(actor, id, true);
    const logs = await this.database.dailyLog.findMany({ where: { employeeId: id }, orderBy: { workDate: "desc" }, select: { id: true } });
    const repository = new PrismaLogRepository(this.database);
    return { logs: await Promise.all(logs.map((log) => repository.findRecycledById(log.id))) };
  }
}
