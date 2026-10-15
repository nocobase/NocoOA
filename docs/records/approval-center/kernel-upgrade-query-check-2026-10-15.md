# 内核依赖升级与审批SQL复测

2026-10-15，Asia/Singapore。按用户要求在fix/approval-center-query-performance继续升级可用内核依赖并复测相同请求。本次不改业务读取实现，基线是[应用读取优化](application-read-optimization-2026-10-15.md)。

## 发布版本核对

同时核对项目registry镜像与官方npm元数据。db最新仍为1.0.0-beta.19，app-server仍为2.0.0-beta.6，app-client仍为3.0.0-beta.1，app-cli仍为1.0.0-beta.21，lifecycle仍为0.1.0-beta.2；这些包已经是当前发布版，本次没有虚构版本升级。

| 包                        | 原版本        | 升级版本      |
| ------------------------- | ------------- | ------------- |
| authorization             | 1.0.0-beta.12 | 1.0.0-beta.13 |
| app-plugin-authorization  | 1.0.0-beta.26 | 1.0.0-beta.27 |
| app-plugin-authentication | 2.0.0-beta.3  | 2.0.0-beta.8  |
| app-plugin-users          | 2.0.0-beta.2  | 2.0.0-beta.4  |
| app-plugin-notification   | 1.0.0-beta.25 | 1.0.0-beta.27 |
| config                    | 0.1.0-beta.2  | 0.1.0-beta.3  |
| logging                   | 0.1.0-beta.6  | 0.1.0-beta.7  |
| session                   | 0.1.0-beta.2  | 0.1.0-beta.3  |
| snowflake                 | 1.0.0-beta.3  | 1.0.0-beta.4  |
| app-testing               | 0.1.0-beta.2  | 0.1.0-beta.3  |

包名统一省略@nocobase/。保留原有caret/精确版本策略。授权插件要求authentication至少beta.6，新Users要求notification至少beta.27，已补齐兼容链。其他不相关插件与应用模板版本未更新。

镜像tarball端点曾返回401；直接访问官方公开tarball并校验integrity后核对源码。全局改为官方scope会使私有审批包元数据404，因此最终保留原.npmrc，pnpm使用镜像已有元数据及公开dist tarball完成安装。未索取或更改凭据。worktree的node_modules/.agents改为独立目录，原工作区依赖未被更新。

## 源码判定

新authorization beta.13的resolvePermissionSets仍为requested.map(key => store.get(key))；新授权插件beta.27的describeCollection仍调用getPhysical。此次发布版本没有实现已定位的权限集批量读取或授权结构描述复用；db包版本也没有变化。此判定只针对当前发布版与当前路径，不推断未发布源码。

## 同一请求对照

先在原17000服务取得旧依赖基线，再正常停止已核对cwd的开发进程，以升级后的fix worktree在同一端口启动。复用相同本地配置、数据库和APP_STORAGE_DIR，未改原工作区源码和镜像配置。新旧迁移预览均无待执行迁移或种子。使用同一既有虚构系统管理员登录，先读取受保护OpenAPI，再GET approvalCenter?view=pending&pageSize=6；不是用户原super admin浏览器会话。

| 窗口               | SQL       | HTTP耗时    | 返回/total |
| ------------------ | --------- | ----------- | ---------- |
| 升级前两次         | 519 / 514 | 309 / 308ms | 均3/3      |
| 升级后初次两次     | 519 / 514 | 328 / 282ms | 均3/3      |
| 升级后其他普通窗口 | 516 / 516 | 254 / 266ms | 均3/3      |
| 升级后完整分组诊断 | 514       | 262ms       | 3/3        |

保留所有窗口，不把首次519或小幅波动当作内核收益。分组514与升级前514样本一致：catalog236、Collection元数据86、表存在性27，合计349；权限集定义42；任务表28；BEGIN/COMMIT各26。514/516差异发生在应用读取分支/并发窗口，当前诊断分组未显示结构与权限查询减少，未宣称内核升级能改善该请求SQL数量。最终通知兼容链重启后两次为519/514 SQL、272/250ms，返回均3/3；预热后仍是514。

## 验证与运行状态

- 升级后skills sync完成，全部包来自独立worktree安装。
- pnpm typecheck（客户端、Node、服务端）通过。
- request-sql、user-summaries、user-summaries-database、approval-directory/service、pending-candidates、routes、workbench/performance：7文件15项通过，66.97s，使用隔离PostgreSQL。
- 补齐notification后的pnpm typecheck通过；approval-notifications/service与jobs两文件24项通过。附加client-auth 5项中2项文案断言失败，旧依赖原工作区同样2项失败（Welcome back与About this application已不匹配现有OA文案），不是本次升级引入；本轮没有修改无关页面或降低断言。
- db apply --dry-run --json：migrations/seeds均0项，不运行repair或手工改业务库。
- peers check：新增NocoBase不匹配已消除；退出1仅因升级前已存在的Tiptap core/pm 3.30.2与bubble/floating-menu 3.31.4不一致。

最终包/锁文件格式、限定diff与新增文档链接检查通过。当前17000由升级后的fix worktree开发服务承接，复用原存储；原工作区依赖未改，私有配置与存储未提交；本次不代表生产部署。没有完整pnpm check、生产p95、大数据容量或用户原会话浏览器验收。
