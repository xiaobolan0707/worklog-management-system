// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ReminderMenu } from "../../../src/web/components/ReminderMenu.js";
import { LogDetailPage } from "../../../src/web/pages/leader/LogDetailPage.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("uses the personal history route for a read-only personal reminder", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ reminders: [{ id: "r1", kind: "COMMENT_REPLY", title: "历史批注回复", body: "收到回复", relatedLogId: "log-own", readAt: null }] }), { status: 200 }));
  render(<MemoryRouter><ReminderMenu logPath="/employee/logs" /><Routes><Route path="/" element={null} /><Route path="/employee/logs/:id" element={<h1>本人历史日志</h1>} /></Routes></MemoryRouter>);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "系统提醒" }));
  await user.click(await screen.findByRole("button", { name: /历史批注回复/ }));
  expect(await screen.findByRole("heading", { name: "本人历史日志" })).toBeInTheDocument();
});

it("shows only unread reminders in red and removes one after acknowledgement", async () => {
  const reminders = [
    { id: "old", kind: "LOG_SUBMISSION", title: "旧提醒", body: "已查收", readAt: "2026-10-30T09:00:00.000Z" },
    { id: "new", kind: "LOG_SUBMISSION", title: "新提醒", body: "待查收", readAt: null as string | null }
  ];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input).endsWith("/api/reminders/new/read") && init?.method === "POST") {
      reminders[1]!.readAt = "2026-10-30T10:00:00.000Z";
      return new Response(JSON.stringify({ reminder: reminders[1] }), { status: 200 });
    }
    return new Response(JSON.stringify({ reminders }), { status: 200 });
  });
  const user = userEvent.setup();
  render(<MemoryRouter><ReminderMenu /></MemoryRouter>);
  const trigger = screen.getByRole("button", { name: "系统提醒" });
  await user.click(trigger);
  expect(await screen.findByText("新提醒")).toBeInTheDocument();
  expect(screen.queryByText("旧提醒")).not.toBeInTheDocument();
  expect(trigger).toHaveClass("has-unread");
  await user.keyboard("{Escape}");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "查收新提醒" }));
  await waitFor(() => expect(screen.queryByText("新提醒")).not.toBeInTheDocument());
  expect(trigger).not.toHaveClass("has-unread");
});

it("lets a leader open and mark an employee reply reminder as read", async () => {
  const reminder = {
    id: "reminder-1", kind: "COMMENT_REPLY", title: "员工回复了您的批注",
    body: "员工回复了第 1 项工作的批注。", relatedLogId: "log-1", readAt: null as string | null
  };
  const calls: string[] = [];
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input).endsWith("/api/logs/log-1")) {
      calls.push("log");
      return new Response(JSON.stringify({ log: {
        employeeName: "张三", workDate: "2026-10-22", color: "RED", items: [], approvalSteps: []
      } }), { status: 200 });
    }
    if (init?.method === "POST") {
      calls.push("read");
      reminder.readAt = "2026-10-22T03:00:00.000Z";
      return new Response(JSON.stringify({ reminder }), { status: 200 });
    }
    return new Response(JSON.stringify({ reminders: [reminder] }), { status: 200 });
  });
  render(<MemoryRouter><ReminderMenu /><Routes>
    <Route path="/" element={null} />
    <Route path="/leader/logs/:id" element={<LogDetailPage />} />
  </Routes></MemoryRouter>);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "系统提醒" }));
  await user.click(await screen.findByRole("button", { name: /员工回复了您的批注/ }));
  expect(await screen.findByRole("heading", { name: "完整日志" })).toBeInTheDocument();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    "/api/reminders/reminder-1/read", expect.objectContaining({ method: "POST" })
  ));
  expect(calls.indexOf("log")).toBeLessThan(calls.indexOf("read"));
  await user.click(screen.getByRole("button", { name: "系统提醒" }));
  expect(await screen.findByText("暂无新提醒")).toBeInTheDocument();
  expect(screen.queryByText("员工回复了您的批注")).not.toBeInTheDocument();
});
