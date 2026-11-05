import { describe, expect, it, vi } from "vitest";

import { SettingService } from "../../../src/modules/settings/setting.service.js";
import { InMemoryAdministrationRepository } from "../../support/in-memory-administration-repository.js";
import { InMemoryAuthRepository } from "../../support/in-memory-auth-repository.js";

function context() {
  const repository = new InMemoryAdministrationRepository(new InMemoryAuthRepository());
  return { repository, service: new SettingService(repository), audit: vi.spyOn(repository, "appendAudit") };
}

describe("log reminder exclusion settings", () => {
  it("defaults old settings to no excluded days or dates", async () => {
    const { service } = context();
    expect(await service.get()).toMatchObject({ logReminderExcludedWeekdays: [], logReminderExcludedDates: [] });
  });

  it("saves, audits and preserves exclusions when an old client saves other settings", async () => {
    const { service, repository, audit } = context();
    const legacy = { ...repository.settings };
    const exclusions = { logReminderExcludedWeekdays: [0, 6], logReminderExcludedDates: ["2026-11-03"] };
    await service.update("admin-1", { ...legacy, ...exclusions });
    expect(await service.get()).toMatchObject(exclusions);
    expect(audit).toHaveBeenLastCalledWith(expect.objectContaining({ metadata: expect.objectContaining(exclusions) }));
    await service.update("admin-1", { ...legacy, submissionDeadline: "19:00" });
    expect(await service.get()).toMatchObject({ ...exclusions, submissionDeadline: "19:00" });
    await service.update("admin-1", { ...legacy, logReminderExcludedWeekdays: [], logReminderExcludedDates: [] });
    expect(await service.get()).toMatchObject({ logReminderExcludedWeekdays: [], logReminderExcludedDates: [] });
  });

  it.each([
    { logReminderExcludedWeekdays: [-1] },
    { logReminderExcludedWeekdays: [7] },
    { logReminderExcludedWeekdays: [1.5] },
    { logReminderExcludedWeekdays: ["6"] },
    { logReminderExcludedDates: ["2026-02-30"] },
    { logReminderExcludedDates: ["2026-13-01"] },
    { logReminderExcludedDates: ["11/03/2026"] }
  ])("rejects invalid exclusion input %j without saving", async (invalid) => {
    const { service, repository, audit } = context();
    const before = { ...repository.settings };
    await expect(service.update("admin-1", { ...before, ...invalid })).rejects.toThrow();
    expect(repository.settings).toEqual(before);
    expect(audit).not.toHaveBeenCalled();
  });
});
