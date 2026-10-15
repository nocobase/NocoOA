# 内核依赖升级与审批SQL复测

2026-10-15，Asia/Singapore。按用户要求在fix/approval-center-query-performance继续升级可用内核依赖并复测相同请求。本次不改业务读取实现，基线是[应用读取优化](application-read-optimization-2026-10-15.md)。

## 首轮发布版本核对

首轮核对项目registry镜像与官方npm元数据，当时db最新仍为1.0.0-beta.19，app-server仍为2.0.0-beta.6，app-client仍为3.0.0-beta.1，app-cli仍为1.0.0-beta.21，lifecycle仍为0.1.0-beta.2；这些包已经是当前发布版，本次没有虚构版本升级。

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

## 第二轮发布核对与db内核升级（2026-10-15 10:44–10:49 +08:00）

用户要求再次核对后，直接请求官方npm元数据，带独立查询参数及no-cache避免沿用前轮缓存，同时比较latest与beta标签。新发布版本如下；此次实际安装并更新锁文件，不修改应用查询实现：

| 包                        | 上一轮版本    | 本轮版本      |
| ------------------------- | ------------- | ------------- |
| db                        | 1.0.0-beta.19 | 1.0.0-beta.20 |
| app-server                | 2.0.0-beta.6  | 2.0.0-beta.7  |
| app-cli                   | 1.0.0-beta.21 | 1.0.0-beta.22 |
| app-plugin-authentication | 2.0.0-beta.8  | 2.0.0-beta.9  |
| app-testing               | 0.1.0-beta.3  | 0.1.0-beta.4  |

app-testing同时引入db-testing 0.1.0-beta.2。PostgreSQL驱动仍为0.1.0-beta.4，SQLite驱动仍为0.1.0-beta.5，均已是最新发布版；app-client与lifecycle也无新版本。保留原caret/精确版本策略，release-age排除仅增加本轮明确版本，不做模板或无关插件全量升级。

迁移预览tasks均为空后，正常停止已核对工作目录的原开发服务，以升级后的独立worktree重启17000。配置、数据库、APP_STORAGE_DIR和演示管理员均沿用前轮。安装完成与服务重启分别核对，避免把仍在运行的旧模块误认为新版本。

| 窗口                   | SQL       | HTTP耗时    | 返回/total |
| ---------------------- | --------- | ----------- | ---------- |
| 本轮第一次普通请求两次 | 489 / 489 | 162 / 153ms | 均3/3      |
| 本轮第一次分组诊断     | 489       | 161ms       | 3/3        |
| 本轮再次普通请求两次   | 492 / 487 | 137 / 126ms | 均3/3      |
| 本轮最终分组诊断       | 487       | 155ms       | 3/3        |

保留所有窗口：请求内并发复用和目录读取分支仍会产生少量波动，不能将每次差值都算作内核收益。最终487与上一轮514的完整分组对照如下：

| 类别                           | db beta.19 | db beta.20 |
| ------------------------------ | ---------- | ---------- |
| PostgreSQL catalog四组结构检查 | 236        | 236        |
| Collection元数据读取           | 86         | 59         |
| information_schema表存在性检查 | 27         | 0          |
| Collection元数据缓存版本读取   | 0          | 27         |
| 权限集定义读取                 | 42         | 42         |
| 审批任务表读取                 | 28         | 28         |
| BEGIN / COMMIT                 | 26 / 26    | 26 / 26    |

结构及元数据相关SQL合计349降到322，最终总数514降到487（约5.3%）。前一489样本比487多两次代理读取，不影响上述分类判定。耗时明显下降，但这是开发环境小样本，不能直接推导生产p95或并发容量。

已安装源码中DatabaseCollectionMetadataStore新增prepareTransaction，初始化状态与namingCache在主连接及事务间共享；通过版本行读取和generation校验，在符合条件的事务中复用命名快照，外部事务、失效代际与事务自身写入仍走相应安全回退。此路径与本次元数据读取下降一致。CollectionRegistry.getPhysical仍调用inspectLogicalCollection，授权逐key读取和每来源事务也仍存在，因此新内核只改善部分开销，没有彻底解决查询放大。

本轮验证：

- pnpm nocobase skills sync完成；pnpm typecheck通过三个TypeScript配置。
- pnpm test覆盖request-sql、user-summaries、user-summaries-database、approval-directory/service、approval-center/pending-candidates、approval-center/routes、workbench/performance及approval-notifications/service：8文件37项通过，74.02s，数据库用例使用隔离PostgreSQL。
- 另跑approval-notifications/jobs：1文件2项通过；合计9文件39项通过。
- pnpm nocobase db apply --dry-run --json：success-noop，迁移及种子tasks均为空。
- pnpm peers check仍仅报告既有Tiptap core/pm与菜单扩展版本不匹配，无新增NocoBase peer冲突；前轮已记录的登录文案失败未在本轮重复运行。

当前17000已加载本轮更新。原工作区依赖、业务查询源码及私有配置未改；此记录不代表生产发布、并发压测或用户原super admin会话验收。

## 487条SQL调用链追查（2026-10-15 11:05 +08:00）

本节逐项核对上一轮保存的487条完整分组，并以同一演示账号重新登录、读取受保护OpenAPI、调用相同GET（附sqlProfile=true）。新请求489条、193ms、返回3/total3；相对487只增加两条代理读取，其他分类完全一致。SQL计数器的并发请求隔离、连接隔离、去监听、失败路径、结束后任务排除及分组脱敏三项测试再次通过。以下基于487样本，不将不同时间窗口混成同一请求；分析没有修改业务读取实现。

### 两种互不混算的分解

按SQL类型：

| 类型                       | 数量 | 来源                                             |
| -------------------------- | ---- | ------------------------------------------------ |
| 物理结构与Collection元数据 | 322  | catalog 236 + Collection元数据59 + 缓存版本27    |
| 权限集定义                 | 42   | 42个不同key逐项get，不是一个key重复42次          |
| 事务控制                   | 54   | BEGIN26、COMMIT26、SAVEPOINT1、RELEASE1          |
| 审批任务查询               | 28   | 25个普通来源候选 + 证明办理3次                   |
| 其他数据读取               | 41   | 账号/人员/组织/权限分配、业务记录、审批run/event |
| 合计                       | 487  | 其中前三类418条，占85.8%                         |

按调用阶段，数目同样闭合：授权结构描述145 + 普通候选225 + 权限集42 + 证明办理40 + 其余共享事实/业务读取35 = 487。后一个分解包含事务等成本，不与前一个表相加。

### 授权描述每次重新检查物理结构：145条

应用server/routes/approval-center/index.ts:850附近遍历28个来源，每个来源先调用authz.authorize，再读取候选；工作任务与公告还使用自身业务动作授权。聚合分组在request阶段出现29组不同结构/元数据参数，每组均为4条catalog查询加1条Collection元数据查询，合计29×5=145。

已安装app-plugin-authorization beta.27的server/database/collections.js:35–47在describeCollection内先collections.get(name)，随后无条件getPhysical(name)，用于主键与generatedPrimaryKey描述。db beta.20的registry.js:47–51中getPhysical绕过getResolutionInternal的cache/inFlight，直接inspectLogicalCollection；后者同时调用物理检查器和metadataStore.get。PostgreSQL检查器进一步分表标识、列、约束、索引四次查catalog。因此已有逻辑Collection缓存不代表这条物理检查路径命中缓存；super admin的authorizeUnrestricted也要经过collection描述。

这是授权插件与DB契约结合处的问题。授权应使用DB统一维护、可失效的结构快照；若getPhysical的公共语义要求强制新检查，应新增可复用的结构描述能力，保留显式refresh路径。不能在应用跳过字段/记录策略，也不能把getResolution误当成已包含完整physical schema（当前结果仅有collection/inspection/warnings）。

### 每个候选来源独立事务并重新解析同一任务表：225条

server/providers/approval-runtime/pending-candidates.ts:65–80按来源调用query.taskCandidates，空结果只停止该来源的后续业务加载。审批插件query.js:306–313强制通过source.input.runtime.transaction执行；candidates方法查询相同approvalTasks，以source、当前人/代理及OPEN状态过滤。

此样本共25个普通候选来源；每个来源的共同成本是BEGIN1 + 缓存版本1 + 物理catalog4 + Collection元数据1 + approvalTasks查询1 + COMMIT1 = 9条。25×9=225；recruitment候选scope另外归属了12条共享目录读取，单独计入其余35条，不能把它当成recruitment独有成本。

db的KnexDatabaseConnection构造器每次创建CollectionRegistry；transaction创建新的KnexDatabaseConnection，因此即使25次都读取同一任务表，也有25份事务内首次结构解析。beta.20共享的是符合代际条件的命名快照，不是完整的已解析Collection/物理结构缓存。这解释了升级只降低27条，而未消除这些重复检查。

仅把调用改为现有pending()或authorizedPending()不能解决：已安装query.js:367–372及438–443仍逐业务runtime.transaction，且涉及办理资格、业务授权、排序与总数语义。应由审批插件在同连接/同store范围批量获取跨来源原始候选，再按各来源的代理、资格与业务策略验证；DB负责安全的事务只读结构快照复用。跨连接/不同store不能无条件合并事务，事务内DDL、元数据写入、提交/回滚及失效代际需要测试。应用可负责一次编排与去重，不能自行读取插件内部表绕开契约。

### 权限集42条是逐key加载

authorization beta.13的permission-sets/plugin.js:420–425先查assignments、对permissionSet key去重，再Promise.all(requested.map(key => store.get(key)))；授权插件DatabasePermissionSetStore.get每个key发一条SELECT。分组count=distinct=42，与源码一致。grantsFor已有请求内promise复用，因此不是每次业务授权都重读42项；此处需要store/core支持批量按key加载，保留缺失key错误及事务/授权版本一致性，目标是把42次定义读取收敛为一次或按参数上限分批。应用不能用跨请求权限缓存替代。

### 证明办理40条与其余35条

证明办理不能直接用本人任务候选裁剪，因为其待办包含管理员appoint/reassign。pending-candidates.ts:20–22因此保留原owner读取。certificates/service.ts:700–739开启owner事务，findMany读取授权范围记录，然后逐记录actionsFor；本样本额外出现5组物理解析、2次缓存版本读取、3次任务查询、run/event读取和嵌套savepoint，总计40条。数据量增长时该逐记录资格路径还会继续放大。适合在应用先收窄可进入待办的业务状态、统一owner读上下文；跨记录批量offers需要审批公开能力支持，并覆盖管理员尚无本人任务的办理入口，不能简单替换成assignee筛选。

其余35条是request阶段10条身份/组织/权限分配读取、候选共享目录12条、公告8条和工作任务5条。整个487样本中部门树1次、岗位1次，部门成员2次；账号11次（含不同API路径）、员工6次仍可沿公共服务继续查复用机会，但已经不是最大项。各组织/人员集合不是相同数据，不能只按表名认定可合并。

### pageSize为何没有限制前面的工作

server/routes/approval-center/index.ts:985–1007在所有来源完成读取后，才全局过滤、业务时间排序、计算精确total并slice分页。pageSize=6只限制输出；此样本实际输出3条。保留精确授权total、业务排序、meta.kinds和原有拒绝语义意味着仍需覆盖有效候选，但不要求每个业务都重复事务初始化、物理结构检查。优化应针对这些调用成本，而不是把单条SELECT加LIMIT6或先分页后过滤。

优先顺序：授权/DB的可复用结构描述；审批同store跨来源候选读取及事务结构复用；权限集批量读取；应用证明办理批量资格/状态收窄。上述是已定位的优化边界，尚未实现，不能把理论可消除数量或目标SQL当作实测结果。
