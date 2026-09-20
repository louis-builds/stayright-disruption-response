## Task 1: 项目脚手架 + 鉴权架构 + 导航结构

> 项目背景（适用于全部 11 个 Task）：客户端App（客人自助 + 中断响应伴随App）。来源脑图：`/Users/yangdongqing/it/Claude/客户端App.xmind`。代码目录：`Kakapo/guest-app/`（新目录，同仓库，跟 `Kakapo/coordinator-app/` 平级）。
>
> **英文系统**：所有用户可见 UI 文案一律英文，跟现有 Web 前端一致；代码注释用中文。后端存的中文分类字符串（转人工原因、结案原因等）保留原值不改，只在展示层用 `escalationReasonLabel`/`CLOSE_REASONS.label` 这类映射转英文再显示——这个坑已经在 Web 和协调员App上各踩过一次，这次从 Task 1 起就要避免，不要等复核阶段才发现。
>
> **推送通知走真实 Expo Push**（不是 stub）：Expo Push 免费、不需要付费账号，后端要新增设备 token 注册接口，并在通知创建时真正推送。

- `npx create-expo-app` 脚手架，TypeScript 模板。目录结构复用协调员App已验证过的分层：`src/features/<feature>/{types.ts,api.ts,use<Feature>.ts,<Screen>.tsx,index.ts}`。
- 鉴权：原生 Cookie Jar 自动带 session（`fetch` + `credentials:"include"`），不手动管理 token，不用 `@react-native-cookies/cookies`（已废弃、无 New Architecture 支持，协调员App踩过这个坑）。`AsyncStorage` 只存 `rememberedIdentifier` 字符串（key 前缀 `guest-app:`），不存任何鉴权凭证。
- `AuthContext`：冷启动调 `GET /api/auth/me` 恢复会话并回填 `user`（协调员App第一版漏了这步，冷启动后 Settings 显示不出用户信息，这次直接做对）。
- 登出：真实 `POST /api/auth/logout`，触发后端 `SignOutAsync`。
- 导航：底部 Tab（Home / Bookings / Notifications / Settings），Home Tab 内嵌 Stack（Home → CaseConversation → OptionsFlow），支持从通知/订单卡片跨 Tab 跳转到 CaseConversation（`navigation.dispatch(CommonActions.navigate(...))` 模式，协调员App已验证）。
- `src/shared/escalationLabels.ts`：从 `frontend/src/features/coordinator/escalationLabels.ts` 移植（内容跟协调员App的 `src/shared/escalationLabels.ts` 一致，直接复用即可）。
- `.env.example`：`EXPO_PUBLIC_API_BASE_URL=http://localhost:5080`。

## Task 2: 后端推送通知模块（新增）

真实 Expo Push 集成，不是权限请求 UI 那种 stub。

- 新增 `backend/Infrastructure/Data/Entities/DeviceToken.cs`：`Id, UserId, ExpoPushToken, Platform(ios/android), CreatedAt, UpdatedAt`。`(UserId, ExpoPushToken)` 唯一索引（同一用户多设备可以有多个 token，同一 token 不重复注册）。
- `backend/Features/Push/`（照搬现有 `Features/*` 分层）：
  - `IDeviceTokenRepository`/`DeviceTokenRepository`：注册（upsert）、按 UserId 查询、注销（删除）。
  - `IExpoPushSender`/`ExpoPushSender`：调 Expo 的 `https://exp.host/--/api/v2/push/send`，批量发送（Expo 一次请求最多 100 条，超过要分批）。失败/无效 token（Expo 返回 `DeviceNotRegistered`）要能删除失效 token，不能让死 token 一直占着重试。
  - `PushController`：`POST /api/push/register`（body: `{expoPushToken, platform}`，`[Authorize]` 任意登录角色）、`DELETE /api/push/register`（登出前调用，注销当前设备 token）。
- **集成点**：`AppDbContext.SaveChangesAsync` 里已经有拦截 `ChangeTracker` 做 case workflow history 记录的现成模式（`recordingWorkflowHistory` 那段），照这个思路扩展——在 `base.SaveChangesAsync` 成功之后，检查这次保存里有没有新增的 `Notification` 实体，有的话查这些 `UserId` 名下注册过的 `DeviceToken`，调 `IExpoPushSender` 推送（title/body 直接用 `Notification.Title`/`Body`）。这样不用改动现在散落在 7 个文件里创建通知的调用点（`CaseService`/`CaseRepository`/`CoordinatorService`/`OptionsAdminService`/`OptionsAdminRepository`/`DisruptionService`/`DisruptionRepository`），一个地方接管，别的地方零改动。
- `IExpoPushSender` 通过依赖注入拿，`AppDbContext` 不能直接 new 一个 HttpClient——用 `IServiceScopeFactory` 在 `SaveChangesAsync` 里开一个 scope 解析（DbContext 本身生命周期不该持有别的 scoped 服务的直接引用）。
- 迁移：`AddDeviceTokens`。

## Task 3: 登录页 + 注册页 + 权限引导页

- 登录页：复用现有客人账号登录，用户名/邮箱二选一识别（同一输入框），密码显示/隐藏切换，remember me。视觉参考协调员App LoginScreen 的酷炫渐变背景手法，但换一套配色（不要跟协调员App视觉撞车）。
- 注册页：Email、Phone、Nickname、Gender、Language、Password、ConfirmPassword——**不需要地址/地图选择**（`RegisterRequest.Hotel` 字段只在 `Role==hotel` 时必填，guest 角色注册表单本来就没有地址这一项，之前脑图担心的 MapPicker 简化问题不存在，直接跳过）。
- 首次启动/权限引导页：只请求通知权限（这个App没有麦克风/呼叫需求，权限集合比协调员App简单）。拒绝时的兜底提示复用协调员App PermissionsScreen 的处理模式（引导去系统设置）。
- 权限引导通过后，调 `expo-notifications` 拿到 push token，调 `POST /api/push/register` 注册。

## Task 4: 首页 / 仪表盘页

对齐现有 Web 端 `GuestHomePage.tsx`：

- 欢迎语 + 行程概览统计
- 「需要处理」优先提醒条：有未解决中断案件时置顶展示，带入住倒计时，点进去直达案件对话
- 即将入住的订单预览（最多 3 条）+「查看全部订单」入口跳 Bookings Tab
- 最近中断通知列表，支持搜索
- 当前案件状态摘要卡片，点进去直达案件对话
- 「StayRight 如何帮您」三步说明卡片

## Task 5: 我的订单页

对齐 `MyBookingsPage.tsx`：状态筛选 tab（全部/已确认/需关注/已重订/已取消，带各分类数量）、搜索（酒店名/确认号）、分页、订单卡片（酒店、房型、入住/离店日期、确认号、状态），有关联案件的点进去直达案件对话。

## Task 6: 案件对话页 + 重订方案页

- 案件对话页对齐 `CaseConversationPage.tsx`：AI 线程（只读，看 AI 已经答过什么）+ 协调员线程（可收发消息），案件基本信息展示，有可选方案时明显入口跳重订方案页。
- 重订方案页对齐 `OptionsFlowPage.tsx`：查看多个重订选项（延期原酒店/候补酒店/取消退款）、查看政策原文、选择方案确认执行、对延期方案提出别的日期。

## Task 7: 通知中心页 + 个人资料页 + 设置页

- 通知中心：全部通知列表（不只首页那几条），已读/未读标记，点击直达对应案件，推送到达时系统通知栏 + App 内均可见。
- 个人资料页对齐 `ProfilePage.tsx`：基本信息 + 资料完整度、修改邮箱、修改密码、账号信息。
- 设置页：通知分类开关（新中断提醒/案件状态变化/方案就绪提醒）、登出（登出前先调 `DELETE /api/push/register` 注销当前设备 token）、App 版本 / 权限状态一览。

## Task 8: 页面功能与体验优化 Loop（第 1 轮，动态展开）

跟协调员App同一套机制：动态发现系统当前所有页面，对每个页面套用 `通用功能优化需求.txt` + `通用页面优化需求.txt`（React Native App，鼠标相关要求换触屏等价物）。

## Task 9: 页面功能与体验优化 Loop（第 2 轮，动态展开）

同 Task 8 机制，第 2 轮重新发现页面列表并再跑一遍两份优化需求文档，确认第 1 轮引入的新元素也经过同样检查。

## Task 10: 页面功能与体验优化 Loop（第 3 轮，动态展开）

同上，第 3 轮。页面功能和体验应收敛——如果发现某页面已经没有可优化点，直接说明"已检查，满足两份文档要求"即可，不强凑改动。

## Task 11: 测试用例生成与执行（动态展开）

动态发现系统所有页面，每个页面按 `通用测试用例需求.txt` 写一份测试用例文件（`guest-app/test-cases/{page}.md`），再按 `通用测试需求.txt` 用 `webapp-testing` skill 逐个测试点截图验证，测出 bug 立刻修复并截图回归确认。
