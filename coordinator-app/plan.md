> 更正（Task 7 执行中途，用户指出）：这是个英文系统——所有用户可见 UI 文案（按钮/标题/占位符/提示语）一律英文，
> 跟现有 Web 前端一致；代码注释仍用中文。后端存的中文分类字符串（如转人工原因、结案原因）保留原值不改，
> 只在展示层用 `escalationReasonLabel`/`CLOSE_REASONS.label` 这类映射转英文再显示。Task 1-7 已按此改完。

## Task 1: 项目脚手架（Expo React Native App + 导航骨架 + 会话基础设施）

新建移动端项目，产出物为可运行的空壳（能起、能登录联调、导航能跳）。脑图见 `/Users/yangdongqing/it/Claude/协调员App.xmind`。

- 用 Expo（React Native + TypeScript）在 `Kakapo/coordinator-app/` 下初始化项目，`tsconfig.json` 开 `strict: true`，禁用隐式 any。
- 目录分层按 `/Users/yangdongqing/it/Claude/开发规范.md` 第1.1/1.5节的四层模型落地：`src/features/{module}/`（`types.ts`、`api.ts`、`useXxx.ts` hook、`XxxScreen.tsx`、`index.ts`），视图层不得直接调服务层，必须经过 hook。
- 导航按 `/Users/yangdongqing/it/Claude/常见问题.txt`「app底部横排一级导航，顶部横排二级导航」：用 `react-navigation`，底部 Tab 一级导航（案件 / 通话 / 通知 / 我的），案件 Tab 内部按需二级导航（如队列 Tab 切换）。
- 会话基础设施（关键技术决策，务必做对——曾经想错过一版，这里记录修正后的结论）：现有 Kakapo 后端是 Cookie/Session 鉴权。最初设想"手动从响应里读 Set-Cookie 存 AsyncStorage 再手动带上"技术上行不通——Fetch 规范本身禁止 JS 读取 `Set-Cookie` 响应头，React Native 的 `fetch` 完全一样受限，不是平台差异。实际可行且更简单的方案：React Native 的原生网络层（iOS `NSHTTPCookieStorage` / Android `CookieManager`）本来就会自动接收并在同源请求上重新携带 Cookie，且默认持久化到磁盘、重启 App 也还在——不需要额外的 Cookie 管理库，也不需要手动搬到 AsyncStorage。封装一个统一的 `apiFetch` 直接用平台默认 `fetch` 即可；登出调用现有后端 `POST /api/auth/logout`（会下发一个过期的 `Set-Cookie` 由原生层自动清掉，不用额外代码）。401/403 统一按 `开发规范.md` 2.2节的 `{code:403,...}` 结构处理，跳回登录页。`AsyncStorage` 只用来缓存"记住的登录名"（Task 3 的 remember me）和一个本地"大概率已登录"标记，用于启动画面决定先显示哪个界面，真正的鉴权状态仍以一次真实请求的成败为准。
- 复用现有后端分页协议（`开发规范.md` 1.3节）：`data.list`/`total`/`page`/`pageSize`/`totalPages`，前端类型层要有对应的 `PagedResult<T>` 泛型。
- `.env`（`API_BASE_URL` 指向本地/联调环境的 Kakapo 后端地址）不提交真实值到仓库，加进 `.gitignore`。
- README 写清楚 `npx expo start` 怎么跑、iOS/Android 模拟器怎么连。

## Task 2: 后端 Calls 模块（呼叫/录音/转录/AI 总结全链路，电话服务先 mock）

在现有 `backend/Features/Calls/` 新建模块，仿照仓库里其它 `Features/*` 的分层写法（`开发规范.md` 2.1/2.5节：Controller → Service → Repository → Entity，DTO 单独文件）。

- 新增两个实体（EF Core Migration）：`Call`（Id、CaseId、CalleeType: guest|hotel、InitiatedByCoordinatorId、StartedAt、EndedAt、Status: connecting|in_progress|completed|failed|no_answer）、`CallRecording`（Id、CallId、FileUrl、DurationSeconds、TranscriptText、AiSummary、ProcessingStatus: pending|transcribing|summarizing|done|failed）。
- 定义 `ITelephonyProvider` 接口（`InitiateCallAsync(coordinatorUserId, caseId, calleeType)` 返回一个 call 句柄/状态、`EndCallAsync`），当前只写 `MockTelephonyProvider` 实现：模拟状态机 connecting→in_progress→completed，几秒后"生成"一段占位录音文件（可以是仓库自带的静态测试音频，存对象存储或直接放 `wwwroot`/静态目录），写入 `CallRecording`。真实 Twilio 对接点留空但接口契约要清楚（后续换 `TwilioTelephonyProvider` 实现同一接口即可接入，不改上层代码）——这一点在代码注释里写明白。
- 转录管道：`IAsrProvider` 接口，mock 阶段用规则/固定文本生成一段"转录文本"（不接真实 Whisper/Speech API，等真实通话接入时再实现真实 ASR provider）。
- AI 总结：复用现有 `backend/Features/Chat/GeminiClient.cs` 的调用模式（这个是真的，不 mock），prompt 传入呼叫对象类型、时长、转录全文，要求结构化输出（诉求/关键信息/后续待办）。
- API：`POST /api/cases/{caseId}/calls`（发起呼叫，body 含 calleeType）、`GET /api/cases/{caseId}/calls`（该案件下通话列表）、`GET /api/calls/mine`（当前协调员本人的通话记录，支持按案件/呼叫对象/日期区间/状态筛选，分页协议对齐 1.3节）、`GET /api/calls/{id}/recording`（录音详情：url/时长/转录/总结/处理状态）。
- 鉴权：全部 `[Authorize(Roles = "coordinator")]`，`GET /api/calls/mine` 只能查到 `InitiatedByCoordinatorId` 等于当前登录用户的记录，不能查到别人的（"我的通话记录"明确只本人，全体协调员的审计视角留 Web，App 不做）。

## Task 3: 登录页 + 首次启动权限引导页

- 复用现有 `POST /api/auth/login`（`identifier`/`password`），按 `/Users/yangdongqing/it/Claude/常见问题.txt`：`identifier` 输入框本来就同时支持用户名和邮箱，直接复用不用改后端。
- Remember me：本地记住 `identifier`（`AsyncStorage`），不落盘明文密码；密码输入框要有显示/隐藏切换图标。
- 登录成功后校验角色必须是 `coordinator`，不是则拒绝登录并提示"此 App 仅供协调员使用"（这是协调员专属工具，不做多角色支持）。
- 首次启动权限引导页：请求麦克风权限（呼叫功能要用）、通知权限，每项权限配一句人话说明用途；用户拒绝后要有兜底提示，引导去系统设置里手动开，不能死循环弹权限请求。

## Task 4: 案件队列页

- Tab 分类对齐现有 Web 端协调员案件页的口径：待处理 / 我的待办 / 处理中 / 已结案 / 全部，复用现有 `/api/cases` 系列接口（不新建后端接口）。
- 筛选：状态、优先级、中断事件类型；搜索：客人昵称、酒店名、案件号。
- 下拉刷新；新转人工案件到达时列表顶部/Tab 上要有角标提醒（轮询现有通知或案件计数接口，间隔参考现有 Web 端轮询频率）。
- 每条 case 卡片自带「呼叫客户」「呼叫酒店」两个按钮，点击直接调 Task 2 的 `POST /api/cases/{caseId}/calls` 发起呼叫并跳转到呼叫中页面，不需要先进详情页。

## Task 5: 案件详情页

- 案件基本信息（客人、酒店、中断类型、当前状态），对齐 Web 端 `CoordinatorCaseWorkspacePage` 的信息密度。
- 与客人对话（coordinator 线程，收发消息，复用现有 `/api/cases/{id}/messages` 系列）。
- 查看 AI 对话记录（ai 线程，只读展示，不可在这里回复）。
- AI 转人工理由展示 + 协调员复核（合理/不合理，不合理需要填理由），复用现有 `/api/cases/{id}/escalation-review` 接口。
- 重订方案审核：查看/选择/确认重订方案，复用现有 Options 系列接口（对齐 Web 端 `OptionsAdminPage` 的核心操作，不用照搬全部管理功能，只要协调员能看方案、选方案、确认执行）。
- 结案操作（标记案件已解决 + 填结果摘要）。
- 「呼叫客户」「呼叫酒店」两个呼叫按钮 + 该案件下的历史通话记录列表（`GET /api/cases/{caseId}/calls`），点某条录音跳转录音详情页（Task 7）。

## Task 6: 呼叫中页面 + 通话结束小结页

- 呼叫中页面：基于 Task 2 的 Mock 状态机驱动 UI——通话计时器、静音/免提切换、结束通话按钮、录音状态指示（明显的"正在录音"提示，合规要求让协调员知情）、对方号码/角色展示（客户 or 酒店，避免呼错）。
- 通话结束小结页：本次通话时长、呼叫结果（接通/未接/占线/失败），"录音正在处理中"状态要轮询 `GET /api/calls/{id}/recording` 的 `ProcessingStatus` 直到变成 `done` 才允许跳转录音详情页；未接通/失败时提供「重新呼叫」按钮直接重新发起。

## Task 7: 录音详情页 + 我的通话记录页 + 通知中心页 + 设置页 + 网络异常兜底

- 录音详情页：音频播放器（用 `expo-av`，进度条拖动、倍速播放、暂停/继续，播放 Task 2 mock 生成的占位音频）、转文本全文展示（按时间戳跳转对应播放位置）、AI 总结展示（结构化要点）、下载录音/分享转录文本、标记"已处理"+协调员自己的备注（本地或后端存一个备注字段，二选一均可，但要能持久化）。
- 我的通话记录页：只汇总当前登录协调员本人发起的通话（`GET /api/calls/mine`），按案件/呼叫对象/日期区间/处理状态筛选，支持搜索。
- 通知中心页：新转人工案件提醒、转录/总结完成提醒、转录/上传失败提醒，复用现有 `/api/notifications`（含 `unreadOnly` 参数）。
- 设置页：通知开关（本地偏好，分类可关）、账号信息/改密码入口（复用现有后端接口）、登出、App 版本信息/权限状态一览——这些都是个人偏好设置，系统级配置（阈值等）不做，那是 Web 端的事。
- 网络异常兜底（全局状态，非独立路由）：断网时呼叫/发消息按钮置灰并提示；通话中掉线要有重连/重呼提示；录音上传失败时本地暂存（文件系统或 `AsyncStorage` 记一条待重试记录）+ App 恢复网络后自动重试上传。

## Task 8: 页面功能与体验优化 Loop（第 1 轮，动态展开）

对 Task 1-7 建成的每一个页面（`src/features/*/` 下的 Screen 组件），依次套用 `/Users/yangdongqing/it/Claude/通用功能优化需求.txt`（分页/搜索/图形化报表/通知机制/额外实用功能/前后端及 AI 工程可加的进阶技术）和 `/Users/yangdongqing/it/Claude/通用页面优化需求.txt`（用 impeccable 和 taste-skill:redesign-skill 做视觉/交互优化：loading 效果、渐变过渡、布局紧凑度、空白率、有没有让人眼前一亮的效果）。

- 先动态发现当前系统所有页面（列出 `src/features/*/`下所有 Screen 文件），为每个页面按固定模板（同时应用上述两份文档的检查项）构造一个 `{max_iterations, completion_promise, prompt}` 任务字典，写成 JSON 数组落一个 scratch 文件。
- 执行 `python3 ~/.claude/ralph-wiggum/scripts/expand-ralph-queue.py .claude/ralph-queue.local.json <scratch文件>`，把这批页面级子任务插进当前队列，紧跟在本任务后面。
- 每个页面子任务改代码要遵循 ponytail 的极简原则（能用现成的就不新造），且不能违反 `/Users/yangdongqing/it/Claude/常见问题.txt` 里的反模式（权限泄露、操作入口只能靠猜、空白率超标、覆盖遮挡等）。
- 插入完子任务后再输出本任务自己的完成承诺。

## Task 9: 页面功能与体验优化 Loop（第 2 轮，动态展开）

跟 Task 8 完全相同的机制，重新发现一遍系统所有页面（第 1 轮可能已经改过页面结构/新增了子页面），再跑一轮 `通用功能优化需求.txt` + `通用页面优化需求.txt`。第 2 轮的目的是让第 1 轮引入的新元素（比如新加的图表/通知机制）也经过一次同样的优化检查，而不是只优化最初的版本。

## Task 10: 页面功能与体验优化 Loop（第 3 轮，动态展开）

跟 Task 8/9 完全相同的机制，第三次重新发现系统所有页面并跑一轮同样的优化检查。三轮跑完后，页面功能和体验应该收敛（第 3 轮如果发现某页面已经没有可优化点，直接在该页面子任务里说明"检查过，已满足两份文档的要求，无需改动"即可，不用硬凑改动）。

## Task 11: 生成测试用例并执行测试（动态展开）

- 先动态发现系统所有页面，为每个页面构造一个子任务：按 `/Users/yangdongqing/it/Claude/通用测试用例需求.txt` 的要求，写一份该页面的测试用例文件（`coordinator-app/test-cases/{page}.md`），覆盖所有用户可触达的功能点（不只是需求描述里写到的），每个功能点拆到最终可执行的具体测试点。
- 同一个子任务里，生成完用例后紧接着按 `/Users/yangdongqing/it/Claude/通用测试需求.txt` 用 `webapp-testing` 这个 skill 逐个测试点实际跑一遍并截图确认最终结果正确；发现 bug 立刻修复，回归测试同样要用 `webapp-testing` skill 的截图确认修复后正确。
- 用 `python3 ~/.claude/ralph-wiggum/scripts/expand-ralph-queue.py .claude/ralph-queue.local.json <scratch文件>` 把这批"生成用例+执行测试"合一的页面级子任务插入队列，再输出本任务自己的完成承诺。
