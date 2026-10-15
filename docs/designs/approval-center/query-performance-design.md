# 审批中心查询性能契约

2026-10-15，Asia/Singapore。本次包含尚未进入main的审批查询前置与应用读取优化。实现和验证见[执行记录](../../records/approval-center/application-read-optimization-2026-10-15.md)。

## 公共审批查询与业务边界

审批及lifecycle分别固定0.1.0-beta.2。最后启动的ApprovalQueryProvider按已有processOwners注册同一公开ApprovalQuery；业务SDK通过createAppApprovalService保留实例身份，GET按当前人批量复用参与关系/历史任务索引。统一来源注册、统计变更与启动关闭生命周期，不直接读取插件内部表。

pending按本人及一跳代理的索引形成候选超集，再与原RepositoryPolicy相交，由原owner加载、字段授权及实际actions/guard检查。完整候选经过业务条件过滤、原业务时间排序和去重后分页，保留精确total；不把插件关系统计直接当作授权可见总数。证明行政appoint/reassign等待办、字段受限或无可复用索引的分支保留原读取语义。workItem、announcementReceipt保留原owner。

## 请求内事实读取

GET主连接的组织树、岗位、职责有效码与成员、员工身份及汇报图按连接身份和完整参数共享，返回克隆，失败可重试。显式传主连接与省略连接使用同一边界；事务连接、POST和后台查询始终新读，不缓存授权决定或办理资格，不跨请求保留业务事实。

candidateSnapshot只预取当前人及反向代理涉及的有效员工/账号，并读取相关委托人的全部出边，防止遗漏指向其他人的竞争代理。与完整snapshot共用一跳、scope、时间窗口和歧义规则。限定投影的主管、角色、分配和人员搜索能力拒绝调用；实际资格/行政offers/写入仍使用完整目录。已存在完整请求目录时直接复用，因此全来源查询在证明等需要时仍会构建完整目录。

申请人摘要仅存id/name。同一GET同服务实例下同ID共享，并发不同ID合并为公开Users.list(kind=all)，按其100页大小分批；单ID使用get。保留禁用/服务/缺失账号语义，失败可重试，请求结束后重新取值。登录、资格和写入不使用摘要缓存。

## 同步变更与时间边界

统一统计变更服务按排序后的来源gate加入业务事务，同步重算受影响用户；请假/销假、代理变更和跨业务依赖写入保持原业务锁顺序。现有SDK观察器与协调事务共享上下文，避免嵌套连接落在父事务之外。普通候选读取跳过编制写入gate，真实办理/写入仍锁定。

新增oaApprovalStatisticsBoundaries持久保存代理生效/到期事件。每秒取到期事件（每批最多100），在事务内重检事件身份、同步重算并删除；失败保留供重试。变更时替换旧事件。它是已知时间边界处理，不是定时repair；历史回补、全业务授权依赖版本与精确统计快照切换未完成。升级部署需通过正常db apply应用应用及插件迁移，启动期间初始化来源后方可接收请求。

## SQL观测

入口中间件位于session之前，以AsyncLocalStorage隔离主数据库请求SQL，包含认证、权限、业务和事务控制，后台任务不计入。默认仅在Server-Timing追加数量，慢请求日志含sqlCount。sqlProfile=true仅在approvalCenter聚合固定scope、操作和表标识，参数仅在内存哈希判重；语句/参数/指纹不落日志。分组日志25项分批，核对总数。提供者关闭时解除监听。

## 剩余成本

主连接授权仍逐Collection检查物理结构，每来源taskCandidates仍打开所属runtime事务并初始化事务Registry；42个权限集key逐条读取。未绕过公开API或用长时间缓存掩盖这些成本。完整容量、生产p95、全角色原浏览器验收及生产发布独立判断。

## 发布内核复测（2026-10-15）

可用的授权/认证/用户及所需通知兼容链、config/logging/session/snowflake和测试内核已更新；db/server/client/cli/lifecycle当前没有更新的发布版。新授权实现仍逐key读取权限集并获取物理结构，实测请求仍约514条SQL，没有消除本契约所列剩余成本。版本、完整分组与前后对照见[内核升级记录](../../records/approval-center/kernel-upgrade-query-check-2026-10-15.md)。
