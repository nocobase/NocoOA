# 工作台选项请求性能

2026-10-13，Asia/Singapore。范围：资产、供应商准入、转正、离职的 options 服务；保留当前共享工作树其他页面修改。

## 损耗与修复

资产原先仅需当前人及部门负责人资格，却调用全员 directory.snapshot，读取所有有效员工/账号、汇报链、主部门与祖先链、全部职责、代理和管理员分配。供应商只需当前 purchasing 标志、转正只需当前 hr 标志，也走完整目录；离职对 departureType 连续读取三次。

审批目录新增公开 eligibility(userIds, roles, connection?)，通过公开员工 getByUserIds、账号 list 和组织 dutyRoleMembersByCodes 定向读取，保留 active、非 left、enabled person 和有效成员/职责校验，不持久缓存。若 GET 授权已经加载完整目录，复用同一请求的目录并限制到指定人和职责，避免额外查询；显式 connection 不复用该目录。此接口仅支持普通组织职责，明确不提供 protected approval.admin。完整审批、提交/办理与显式事务 snapshot 保持独立。资产传当前申请人和原 headOf 选定负责人；供应商传当前人+purchasing；转正传当前人+hr。离职一次字典读取派生三份列表。现有主注册已生效，无新增 provider、迁移或种子。

原业务设计没有取消任何资格、字段、审批或授权要求；本次是性能补充。原工作台 4+4 资格调度保持不变。权限及审批摘要另有跨模块可读范围扫描和逐单 SDK 查询损耗，本次未解决该范围，不能把 options 达标当作整个首屏达标。

## 测量

使用已有运行服务会话仅读取当前账号，不在记录中保存身份、凭据或响应行内容。HTTP 墙钟与 Server-Timing app 相近，表明主要损耗在服务端。修复前样本资产193ms、供应商220ms、离职235ms、转正349ms；原源码隔离 PostgreSQL 10员工/6单据的并发测试资产495ms、合同520ms、供应商526ms、离职505ms、转正500ms、招聘550ms、车辆535ms。共享机器负载有变化，不作受控百分比或 p95 结论。

修复后的一个运行窗口全部200：资产80ms(app78.3)、供应商90ms(app87.1)、离职118ms(app114.3)、转正222ms(app220.6)；合同92ms、调岗167ms、车辆189ms、招聘204ms。该窗口权限2621ms、审批 mine2576ms、pending2758ms仍超过500ms。

最后在源码稳定且上述回归结束后复测：8项资格全部200；资产79ms(app75.8)、合同82ms、供应商83ms(app80.3)、离职110ms、调岗164ms、车辆183ms、招聘200ms、转正218ms。不是生产p95承诺。

## 验证与边界

实现过程中首次测试因沙箱无法连接本机 PG 失败；批准本机网络后，初版读取过滤器与当前 db 公共接口不兼容导致测试失败及热更新 options 的短暂500/400，已改用公开员工 getByUserIds，后续真实窗口全部200。以上失败不算性能成功样本。

`pnpm exec vitest run tests/logic/approval-directory/service.test.ts tests/logic/asset-requests/selection.test.ts tests/logic/vendor-qualification/http.test.ts tests/logic/probation/routes.test.ts tests/logic/departure/drafts.test.ts tests/logic/workbench/performance.test.ts --testTimeout=120000`：隔离 PostgreSQL 6文件24项通过，65.89s。包含与完整目录的资格一致性、停用账号失去资格、缺档案、真实资产分配/字段范围、供应商私有字段边界、转正路由及离职草稿。目录复用追加后的验证单独记录，不合并计数。

目录复用追加后的 `pnpm exec vitest run tests/logic/approval-directory/service.test.ts tests/logic/probation/routes.test.ts tests/logic/workbench/performance.test.ts --testTimeout=120000`：3文件15项通过，31.16s；包含复用后的限定人员、职责及protected管理员不提供检查。合成串行查询数：资产75、供应商82、离职96、转正83。新增资产≤80、供应商≤86 SQL预算；避免受负载影响的毫秒硬断言。

新增SQL预算后的独立 `pnpm exec vitest run tests/logic/workbench/performance.test.ts --testTimeout=120000`：1文件1项通过，17.37s，资产≤80、供应商≤86预算通过。与前两个回归窗口分别记录，不合并或称作全量套件。

`pnpm exec tsc --noEmit -p tsconfig.server.json`、变更服务/路由/测试 scoped ESLint及格式检查通过。8份受影响文档569个本地链接目标均存在；`git diff --check`通过。

没有执行生产发布、手动重启服务、全量套件或实际角色浏览器验收；当前服务热更新的 HTTP 验证不代表生产发布。另一个窗口资产101ms、供应商112ms、离职148ms，但第二组选项1122–1295ms，发生于后续源码热更新相邻窗口：不能只保留快速窗口并宣称全部请求稳定达标，毫秒存在机器负载/热更新差异；可读范围扫描仍影响转正、招聘、车辆、调岗。

## PR 分支独立验证

2026-10-13，Asia/Singapore。从最新 origin/main 创建 fix/options-request-performance 隔离工作树，只应用本次8个源码/测试文件的差异与独立设计/记录；原工作区未提交的历史文档整理和页面修改未纳入。

在隔离工作树执行相同6个受影响文件，使用临时 Vitest 配置将 cacheDir 指向独立临时目录，隔离 PostgreSQL 6文件24项通过，51.06s，SQL预算通过。服务端 TypeScript、scoped ESLint、格式及diff检查通过。独立设计和记录的本地链接均已核对；原工作区569个链接检查不代表PR含有该文档集合。
