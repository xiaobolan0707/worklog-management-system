import type { AdministrationRepository, ApproverAssignmentInput } from "./user.service.js";

type ApproverRepository = Pick<
  AdministrationRepository,
  "replaceApprovers" | "listAuthorizedEmployeeIds"
>;

export class ApproverService {
  constructor(private readonly repository: ApproverRepository) {}

  orderedAssignments(approverIds: string[]): ApproverAssignmentInput[] {
    if (new Set(approverIds).size !== approverIds.length) {
      throw new Error("duplicate approver is not allowed");
    }
    return approverIds.map((approverId, index) => ({ approverId, position: index + 1 }));
  }

  async replace(employeeId: string, approverIds: string[]) {
    const assignments = this.orderedAssignments(approverIds);
    await this.repository.replaceApprovers(employeeId, assignments);
    return assignments;
  }

  listAuthorizedEmployeeIds(actorId: string) {
    return this.repository.listAuthorizedEmployeeIds(actorId);
  }
}
