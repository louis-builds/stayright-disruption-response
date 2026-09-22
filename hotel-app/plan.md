> 系统是英文系统——所有用户可见 UI 文案（按钮/标题/占位符/提示语/错误信息）一律英文，跟现有 Web 前端
> 和 coordinator-app/guest-app 一致；代码注释用中文。后端存的中文字段（如有）保留原值不改，只在展示层转英文。
>
> 更正（Task 1 执行中途，用户指出）：页面视觉风格要跟现有 PC 端（`frontend/`）保持一致，不是另起
> 一套品牌色。真实配色取自 `frontend/src/index.css`、`frontend/src/features/hotel/HotelHomePage.css`、
> `frontend/src/features/auth/LoginPage.css` 里实际用的值：主色 `#7628e8`（按钮渐变
> `linear-gradient(135deg, #7628e8, #5f4df3)`）、墨色 `#202438`、次要文字 `#777b8e`/`#555a6e`、
> 边框 `#e1e4ec`/`#eceef4`、背景 `#f7f8fc`、成功 `#118568`、错误 `#c0392b`。已抽成
> `src/shared/theme.ts` 常量，Task 1 的登录/权限页已按此改完；后续每个任务新建 UI 时都要复用这份
> 配色，不要在某个页面里自己发明新的品牌色。

## Task 1: 项目脚手架（Expo React Native App + 导航骨架 + 会话基础设施）

新建移动端项目，产出物为可运行的空壳（能起、能登录联调、导航能跳）。脑图见
`/Users/yangdongqing/it/Claude/Kakapo/docs/proposals/hotel-app-requirements.xmind`。
技术栈、目录分层、会话方案跟现有 `Kakapo/coordinator-app/`、`Kakapo/guest-app/` 保持一致（同一套后端）。

- 用 Expo（React Native + TypeScript）在 `Kakapo/hotel-app/` 下初始化项目，依赖版本对齐
  `coordinator-app/package.json`（Expo ~57、React 19.2.3、React Navigation 7 系列），
  `tsconfig.json` 开 `strict: true`，禁用隐式 any。
- 目录分层按 `/Users/yangdongqing/it/Claude/开发规范.md` 第1.1/1.5节的四层模型落地：
  `src/features/{module}/`（`types.ts`、`api.ts`、`useXxx.ts` hook、`XxxScreen.tsx`、`index.ts`），
  视图层不得直接调服务层，必须经过 hook。
- 导航：底部 Tab 一级导航——Inbox / History / Profile / Notifications / Settings，五个 Tab
  跟脑图的 Common Frame 一致；用 `react-navigation`（bottom-tabs + native-stack）。
- 会话基础设施：跟 `coordinator-app` Task 1 已验证过的结论一致——现有 Kakapo 后端是 Cookie/Session
  鉴权，React Native 的原生网络层（iOS `NSHTTPCookieStorage` / Android `CookieManager`）会自动
  接收并在同源请求上重新携带 Cookie，且默认持久化到磁盘、重启 App 也还在，不需要额外的 Cookie
  管理库或手动搬到 AsyncStorage。封装一个统一的 `apiFetch` 直接用平台默认 `fetch` 即可；登出调用
  `POST /api/auth/logout`。401/403 统一按 `开发规范.md` 2.2节的 `{code:403,...}` 结构处理，跳回
  登录页。`AsyncStorage` 只用来缓存"记住的登录名"（Task 2 的 remember me）和一个本地"大概率已登录"
  标记，真正的鉴权状态仍以一次真实请求的成败为准。
- 复用现有后端分页协议（`开发规范.md` 1.3节）：`data.list`/`total`/`page`/`pageSize`/`totalPages`，
  前端类型层要有对应的 `PagedResult<T>` 泛型（本 App 大部分列表接口实际返回的是裸数组而非分页结构，
  参照 `backend/Features/Hotel/HotelController.cs` 实际签名判断每个接口是否真的分页，不要臆造）。
- `.env`（`EXPO_PUBLIC_API_BASE_URL=http://localhost:5080`，跟 `coordinator-app/.env.example` 一致）
  不提交真实值到仓库，加进 `.gitignore`。
- README 写清楚 `npx expo start` 怎么跑、iOS/Android 模拟器怎么连、`npx expo start --web --port 8093`
  怎么跑（端口 8093，避开 coordinator-app 的 8091、guest-app 的 8092）；同时在
  `/Users/yangdongqing/it/Claude/.claude/launch.json` 里新增一条 `hotel-app-web` 配置
  （参照 `coordinator-app-web`/`guest-app-web` 两条现有配置的写法）。

## Task 2: 登录页 + 首次启动权限引导页

- 复用现有 `POST /api/auth/login`（`identifier`/`password`/`rememberMe`），`identifier` 输入框
  同时支持用户名(nickname)和邮箱。
- Remember me：本地记住 `identifier`（`AsyncStorage`），不落盘明文密码；密码输入框要有显示/隐藏
  切换图标。
- 登录成功后校验角色必须是 `hotel`（`AuthUserDto.Role`），不是则拒绝登录并提示
  "This app is for hotel staff accounts only."（这是酒店端专属工具，不做多角色支持）。
- 首次启动权限引导页：只需要请求通知权限（本 App 没有通话功能，不需要麦克风权限）；用户拒绝后
  要有兜底提示，引导去系统设置里手动开，不能死循环弹权限请求。

## Task 3: 待办（Inbox）页

对齐现有 Web 端 `frontend/src/features/hotel/HotelHomePage.tsx` 的"待办"tab，复用现有
`backend/Features/Hotel/HotelController.cs` 接口（不新建后端接口——这些接口已经存在且服务于
Web 前端的同一批数据）。

- 待处理询单列表：`GET /api/hotel/inquiries?status=pending`（先读一遍 `HotelRepository.cs` 确认
  实际用来筛"待处理"的 status 字面值，不要臆造）。每条卡片展示客人昵称、入住/退房日期、房型、
  等待时长（`WaitTime`）、逾期标记（`Overdue`）、回头客/高价值客人标记（`IsReturningGuest`/
  `IsHighValueGuest`）。
  - 确认：`POST /api/hotel/inquiries/{id}/confirm`，body 支持可选的 `NewCheckIn`/`NewCheckOut`/
    `Note`——UI 上展示 `ProposedNewCheckIn`/`ProposedNewCheckOut`（DTO 已给出的系统预估新日期）
    供参考，酒店可以直接采用或手动改。
  - 拒绝：`POST /api/hotel/inquiries/{id}/reject`，必填 `Reason`。
- 待处理已选方案列表：`GET /api/hotel/selected-options`（客人已确认某方案、等酒店执行时出现，
  `GuestCommitted` 字段可用于额外提示"客人已拍板"）。
  - 确认前可选：附加权益，`PUT /api/hotel/options/{optionId}/perks`（body 是权益名字列表，
    来自 Task 6 建的权益目录）。
  - 确认：`POST /api/hotel/selected-options/{optionId}/confirm`。
  - 拒绝：`POST /api/hotel/selected-options/{optionId}/reject`，必填 `Reason`。
- 发起自定义方案：`POST /api/hotel/cases/{caseId}/custom-option`，body 含 `Title` 和可选权益列表
  （从案件详情/待办卡片里能触发这个入口，具体触发点参照 Web 端 `HotelHomePage.tsx` 的自定义方案
  弹窗设计）。
- 客人标签管理：`GET /api/tags/guest/{guestUserId}`（两类卡片的 DTO 都带 `GuestUserId`），自定义
  标签 CRUD 走 `GET/POST /api/tags/custom`、`DELETE /api/tags/custom/{id}`，打标签/摘标签走
  `POST/DELETE /api/tags/custom/{id}/guests/{guestUserId}`。
- 待办 Tab 角标：显示待处理询单数 + 待处理已选方案数之和。

## Task 4: 已处理（History）页

对齐 Web 端 `HotelHomePage.tsx` 的"已处理"tab。

- 已处理询单历史：`GET /api/hotel/inquiries`（不传 `status` 或传非 pending 的实际状态值——
  先读代码/实测确认 Inquiry 被确认/拒绝后 Status 具体变成什么字符串，据此筛选，不要猜）。
  展示 `RespondedAt`、`RejectReason`（如有）、`FinalOutcome`（客人最终是否留在本店，"stayed"/
  "moved"/结案前为 null，null 时不展示这一项而不是显示"null"字面量）。
- 已选方案历史：`GET /api/hotel/selected-options/history`，展示 `Availability`/
  `UnavailableReason`（如有）。

## Task 5: 酒店资料页 — 第一部分（基本信息 / 图片 / 房型）

对齐 Web 端 `frontend/src/features/hotel/HotelProfilePanel.tsx` 的 Profile / Hotel / Rooms 三个
tab，复用 `GET/PUT /api/hotel/profile`。

- 基本信息：`Name`、`Address`、`Lat`/`Lng`（地图选点用现成的地图组件或简单经纬度输入均可，不
  强求跟 Web 端一样接 Google Maps）。
- 酒店图片：`ImageUrls` + `PrimaryImageIndex`。图片"上传"实际做法要跟 Web 端一致——
  `HotelProfilePanel.tsx` 里图片是前端读成 base64 data URL 直接存进 `ImageUrls` 数组（单张
  上限 2MB），后端没有独立的图片上传/对象存储接口。App 侧用 `expo-image-picker` 选图后转
  base64 data URL，同样做单张大小限制，不要另起一套机制。
- 房型管理：`POST /api/hotel/profile/room-types`（新增）、`PUT .../room-types/{id}`（编辑）、
  `DELETE .../room-types/{id}`（删除），字段：`Name`/`Description`/`Amenities`（标签形式增删）/
  `Capacity`/`PriceAmount`/`Currency`/`ImageUrls`（同上 base64 方案）。

## Task 6: 酒店资料页 — 第二部分（退改政策 / 权益目录）

对齐 Web 端 `HotelProfilePanel.tsx` 的 Policy / Perks 两个 tab。

- 退改政策：`GET /api/hotel/profile/refund-policy`（可能为 null，代表还没配置过）、
  `PUT .../refund-policy`（手动编辑保存：`Content`/`StructuredRulesJson`/`EffectiveFrom`/
  `EffectiveUntil`/`IsActive`）。
- 上传政策文档：`POST .../refund-policy/file`（multipart，字段名 `file`，用
  `expo-document-picker` 选 PDF/Word/Markdown/纯文本文件），成功后调
  `POST .../refund-policy/extract`（body 是文档提取出的 `Content` 文本）走 AI 规则抽取，
  返回的 `ExtractedRefundRulesDto` 里非 null 的字段才回填表单（`AiUsed=false` 时要提示
  "AI unavailable — prefill may be incomplete"，这是后端在 LLM 不可用时的本地正则兜底信号，
  不是错误）。
- 权益目录：`POST /api/hotel/profile/perks`（新增）、`DELETE .../perks/{id}`（删除），
  只是名字列表（`Name`），没有编辑接口——改名等于删掉重建一条（正确行为，不要臆造一个不存在
  的编辑接口）。

## Task 7: 通知中心页 + 设置页 + 网络异常兜底

- 通知中心页：`GET /api/notifications`（支持 `unreadOnly` 参数）、`GET /api/notifications/unread-count`、
  `POST /api/notifications/{id}/read`。点一条通知能跳转到对应案件/待办项（`CaseId` 字段可用）。
  待办 Tab 角标（Task 3）和通知 Tab 角标分别对应各自的未读来源，不要混用同一个数字。
  轮询间隔参照 Web 端现有轮询频率（读代码确认，不要凭感觉定一个数字）。
- 设置页：通知开关（本地偏好，分类可关，纯前端行为，不需要新后端字段）、账号信息/改密码入口
  （复用现有后端接口——先确认后端是否已有改密码接口，没有就走"忘记密码"邮件流程复用，不新建
  后端能力）、登出、App 版本信息/权限状态一览。
- 网络异常兜底（全局状态，非独立路由）：断网时确认/拒绝/上传等操作按钮置灰并提示；上传政策
  文件失败时给出重试入口（不强求做到断网自动重试队列，明确说明降级为"手动重试"即可，比造一个
  过度设计的离线队列更合适——这是纯前端展示型 App，不像 coordinator-app 有通话录音上传那种
  强依赖后台可靠性的场景）。

## Task 8: 页面功能与体验优化 Loop（第 1 轮，动态展开）

对 Task 1-7 建成的每一个页面（`src/features/*/` 下的 Screen 组件），依次套用
`/Users/yangdongqing/it/Claude/通用功能优化需求.txt`（分页/搜索/图形化报表/通知机制/额外实用
功能/前后端及 AI 工程可加的进阶技术）和 `/Users/yangdongqing/it/Claude/通用页面优化需求.txt`
（用 impeccable 和 taste-skill:redesign-skill 做视觉/交互优化：loading 效果、渐变过渡、布局
紧凑度、空白率、有没有让人眼前一亮的效果）。

- 先动态发现当前系统所有页面（列出 `src/features/*/`下所有 Screen 文件），为每个页面按固定
  模板（同时应用上述两份文档的检查项）构造一个 `{max_iterations, completion_promise, prompt}`
  任务字典，写成 JSON 数组落一个 scratch 文件。
- 执行 `python3 ~/.claude/ralph-wiggum/scripts/expand-ralph-queue.py .claude/ralph-queue.local.json <scratch文件>`，
  把这批页面级子任务插进当前队列，紧跟在本任务后面。
- 每个页面子任务改代码要遵循 ponytail 的极简原则（能用现成的就不新造），且不能违反
  `/Users/yangdongqing/it/Claude/常见问题.txt` 里的反模式（权限泄露、操作入口只能靠猜、空白率
  超标、覆盖遮挡等）。
- 插入完子任务后再输出本任务自己的完成承诺。

## Task 9: 页面功能与体验优化 Loop（第 2 轮，动态展开）

跟 Task 8 完全相同的机制，重新发现一遍系统所有页面（第 1 轮可能已经改过页面结构/新增了子
页面），再跑一轮 `通用功能优化需求.txt` + `通用页面优化需求.txt`。第 2 轮的目的是让第 1 轮
引入的新元素也经过一次同样的优化检查，而不是只优化最初的版本。

## Task 10: 页面功能与体验优化 Loop（第 3 轮，动态展开）

跟 Task 8/9 完全相同的机制，第三次重新发现系统所有页面并跑一轮同样的优化检查。三轮跑完后，
页面功能和体验应该收敛（第 3 轮如果发现某页面已经没有可优化点，直接在该页面子任务里说明
"检查过，已满足两份文档的要求，无需改动"即可，不用硬凑改动）。

## Task 11: 生成测试用例并执行测试（动态展开）

- 先动态发现系统所有页面，为每个页面构造一个子任务：按
  `/Users/yangdongqing/it/Claude/通用测试用例需求.txt` 的要求，写一份该页面的测试用例文件
  （`hotel-app/test-cases/{page}.md`），覆盖所有用户可触达的功能点（不只是需求描述里写到的），
  每个功能点拆到最终可执行的具体测试点。
- 同一个子任务里，生成完用例后紧接着按 `/Users/yangdongqing/it/Claude/通用测试需求.txt` 用
  `webapp-testing` 这个 skill（通过 `npx expo start --web --port 8093` 跑起来后用浏览器测）
  逐个测试点实际跑一遍并截图确认最终结果正确；发现 bug 立刻修复，回归测试同样要用
  `webapp-testing` skill 的截图确认修复后正确。
- 用 `python3 ~/.claude/ralph-wiggum/scripts/expand-ralph-queue.py .claude/ralph-queue.local.json <scratch文件>`
  把这批"生成用例+执行测试"合一的页面级子任务插入队列，再输出本任务自己的完成承诺。
