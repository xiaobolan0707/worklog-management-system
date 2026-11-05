# 部门与员工管理 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. 用户已明确要求实施，本次在当前会话直接完成。

**Goal:** 管理员编辑部门名称，管理员／管理层管理各部门普通员工，领导仅管理本部门员工，员工在个人档案选择部门并直接归属。

**Architecture:** 复用 User.departmentId 和 Department.id，部门改名保持 ID 不变；扩展现有 UserService、AdministrationRepository 和组织管理路由，复用现有界面样式。部门权限在服务端检查，新增账号固定为 EMPLOYEE，不开放角色、启停或密码重置权限。

**Tech Stack:** React、TypeScript、Fastify、Prisma、Vitest、Playwright；不新增依赖。

**Spec:** 本次用户截图与最新实现要求；领导仅操作本部门已经明确确认。员工自主选择部门覆盖此前方案中“不能通过个人档案更改部门”的旧建议。完整人事角色、合同附件与离职回收流程不在本轮实现范围内。

## Global Constraints

- 部门名称编辑仅 ADMIN；部门员工维护允许 ADMIN、MANAGEMENT，LEADER 仅本人当前部门。
- 员工只能从已有部门中选择本人归属；不能修改角色或他人归属。
- 编辑员工不包含删除、停用、角色管理、重置密码或重配审批链。
- 所有写接口校验 CSRF；必填信息、重复名称／用户名、不存在的部门、无效员工对象和跨部门访问须拒绝。
- 保留当前工作区已有变更，限定本轮修改文件，不覆盖其他发布工作。

## Review Focus

- 领导伪造部门 ID、员工 ID 或转入其他部门必须失败。
- 管理层不能使用员工接口创建或修改管理员／领导角色。
- 员工自选部门之后，部门列表立即按同一 departmentId 查询到该员工。
- 部门改名不改变 departmentId，员工归属与选择项名称一致。
- 更新遇到重复用户名或归属并发变化时返回可理解的错误，不覆盖其他员工。

## Task 1: 接口行为测试

**Files:** tests/integration/users/department-management.routes.test.ts、tests/support/in-memory-administration-repository.ts。

- [x] 覆盖角色隔离、改名后关系、重复／空名称、无效部门、员工新增／编辑、员工自主归属和禁止权限字段。
- [x] 运行测试确认因缺少接口而失败，再实现。

## Task 2: 服务端部门与员工操作

**Files:** src/modules/users/user.routes.ts、src/modules/users/user.service.ts、tests/support/in-memory-administration-repository.ts。

**Interfaces:**

- PATCH /api/admin/departments/:id：仅管理员修改名称。
- GET /api/departments：返回调用人有权管理的部门。
- GET／POST /api/departments/:id/employees：按权限列出／创建该部门的普通员工。
- PATCH /api/departments/:id/employees/:employeeId：编辑普通员工姓名、用户名和部门；领导不能移出本部门。
- GET /api/profile、GET /api/profile/departments、PUT /api/profile/department：员工查看本人基本信息、选择现有部门并直接绑定。

- [x] 扩展仓储查询、更新及重复冲突映射，更新测试仓储。
- [x] 校验真实部门与当前员工归属，按角色明确允许。
- [x] 使用唯一用户 ID 和部门 ID，记录改名及归属修改审计。
- [x] 运行接口和既有用户管理测试。

## Task 3: 部门层级界面与个人档案入口

**Files:** src/web/pages/admin/DepartmentsPage.tsx、src/web/pages/employee/EmployeeProfilePage.tsx、src/web/components/AppShell.tsx、src/web/router.tsx、src/web/admin.css、tests/unit/web/department-management.test.tsx。

- [x] 左侧部门列表，右侧所选部门名称及员工列表；管理员可改名，员工新增／修改显示在所选部门内。
- [x] 复用现有浅色深绿界面；提供加载、空状态、保存中、成功及错误提示。
- [x] 员工档案加入部门选择和保存；领导与管理层加入部门员工入口，页面路由按角色限制。
- [x] 组件测试覆盖编辑、部门归属、错误反馈与权限差异。

## Task 4: 验证与交付

- [x] 全量 pnpm test、pnpm typecheck、pnpm build。
- [x] 使用真实接口与受控测试数据检查管理员、领导、管理层和员工流程；检查桌面和手机布局。
- [x] 如有既有失败明确报告；交付代码和检查结果，不把本地完成表述为生产上线。
