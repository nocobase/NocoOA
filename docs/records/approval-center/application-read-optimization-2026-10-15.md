# 审批中心查询与应用读取优化验证

2026-10-15，Asia/Singapore。对应[当前契约](../../designs/approval-center/query-performance-design.md)。本PR纳入main尚未包含的公开审批Query集成、同步依赖变更及时间边界前置，并包含本轮应用读取优化；排除原工作区页面样式、浏览器巡查和app-cli打包补丁。原工作区保留。

## 实现与主注册

主应用注册SQL入口中间件、GET关系/事实/摘要上下文和统一ApprovalQueryProvider；新增时间边界迁移。按业务公开SDK注册来源、保留证明行政与非审批来源、字段/记录/动作授权及业务排序/精确total。组织和员工事实按根连接身份复用；事务和写入新读。候选轻量目录包含竞争代理，业务资格使用完整目录；用户摘要保留禁用、服务账号、缺失和请求刷新语义。

## 同服务只读样本

用户指定服务通过既有虚构演示系统管理员登录、读取受保护OpenAPI后串行GET；不是用户原super admin浏览器会话。不记录凭据或业务内容。pageSize=6实际返回3条，total=3。

| 阶段                              |    SQL | HTTP耗时    |
| --------------------------------- | -----: | ----------- |
| 早期待办扫描                      | 未记录 | 1155/1134ms |
| 索引候选后                        |    690 | 329/300ms   |
| 目录批量链与候选GET写入gate修正后 |    536 | 287/283ms   |
| 本轮应用事实及摘要优化后          |    514 | 251/253ms   |

本轮536→514，减少22次（4.1%）。部门6→1、岗位6→1、部门成员4→2、职责成员6→2。最终聚合分组之和514；仍有349结构/元数据/存在性、42权限集定义、52 BEGIN/COMMIT，共443（86.2%），不声明SQL数量已合理。

测试并行及热更新窗口出现更高耗时，亦出现in-flight结构检查在其他请求执行导致单请求计数偏低的窗口，未将其作为稳态收益。只读候选改造保留7条真实待办排序、代理起止与办理检查。

## 验证与限界

原应用工作区的限定PG回归已覆盖组织/目录、摘要、中心权限/字段/非审批、证明/转岗/招聘/离职、七条待办、真实批量办理、SQL预算、事务新读及下一请求刷新。类型检查、限定ESLint/Prettier通过。

本PR从origin/main建立独立worktree，仅复制相关源码/测试与两项依赖升级；去除CLI补丁后离线重算锁文件，并在该worktree重新验证。独立worktree验证结果：

- `pnpm install --lockfile-only --offline --ignore-scripts`：通过，仅更新锁文件；未携带CLI补丁。
- `pnpm exec tsc -p tsconfig.server.json --noEmit`：通过。
- 66个相关TS文件限定ESLint（--max-warnings 0）、全部选定源码/测试的Prettier、3份文档格式及相对链接、git diff检查：通过。
- request-performance、request-sql、user-summaries、statistics-boundaries-migration、statistics-changes、pending-candidates、user-summaries-database、workbench/performance：8文件20项通过（与注册单测同批运行总时长54.66s）。
- approval-query-registration初次因独立worktree的浏览器默认环境无法解析符号链接的react setup而加载失败；该文件是纯服务端单测，补充Node环境后单独2项通过，351ms。没有修改业务行为或降低断言。

测试数据库通过公开测试工厂创建隔离PostgreSQL schema；临时worktree借用现有node_modules及本地测试环境，未安装到业务数据库。

没有执行全pnpm check、生产p95/大数据容量、用户原角色浏览器验收或发布。没有运行repair、重置业务数据库或直接改插件内部表。
