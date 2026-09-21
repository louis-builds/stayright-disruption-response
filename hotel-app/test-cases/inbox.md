# InboxScreen 测试用例

页面: `src/features/inbox/InboxScreen.tsx` + `useInbox.ts`（待办工作队列）
覆盖范围: 不仅限于需求背景，包含所有用户可触达的交互点。

## 1. 统计卡片

- TP1.1 "Disruption requests" 数字与实际 pending inquiry 条数一致。
- TP1.2 "Guest selections" 数字与实际 pending selected option 条数一致。
- TP1.3 "Returning guests" 数字统计正确（inquiry + option 中 `isReturningGuest` 之和）。
- TP1.4 存在 overdue 项时，第一张统计卡片显示红色 "N overdue" 徽标 + 边框脉动动画。

## 2. KindFilter 三态切换

- TP2.1 默认选中 "All"，展示全部待办。
- TP2.2 切到 "Disruption requests" → 只显示 inquiry 类型卡片。
- TP2.3 切到 "Guest selections" → 只显示 option 类型卡片。

## 3. 搜索（必须点按钮触发）

- TP3.1 在搜索框输入内容但不点击 Search → 列表不应立即过滤（验证不是 onChangeText 即触发）。
- TP3.2 点击 "Search" 按钮 → 按 confirmation no. 或 guest 昵称过滤生效。
- TP3.3 过滤后出现 "Clear" 按钮，点击后过滤条件、kind filter 都重置为初始态。
- TP3.4 搜索无匹配结果时展示 "No matches" 空态（区别于完全无数据的 "You're all caught up"）。

## 4. 待办排序

- TP4.1 overdue 项排在非 overdue 项之前（`todoItems` 排序逻辑第一优先级）。

## 5. Guest tag 管理

- TP5.1 卡片上展示已有的 guest tag chips。
- TP5.2 点击管理入口打开 TagManageModal，可看到全部自定义 tag 列表。
- TP5.3 应用/移除一个 tag 后卡片上的 chip 实时更新。
- TP5.4 创建一个新 tag 并应用后立即生效。

## 6. Confirm deferral 并发防抖（inquiry）

- TP6.1 "Confirm deferral" 按钮点击后进入 loading 态（spinner 替代文字），按钮 disabled。
- TP6.2 同一张卡片快速双击 "Confirm deferral"（`inFlightIds` ref 同步拦截）不应触发两次请求。
- TP6.3 两张不同卡片先后点 Confirm，`busyIds`（Set）保证互不影响彼此的按钮状态（不会被后点的覆盖成"可再点"）。

## 7. Reject 弹窗（inquiry / option 共用）

- TP7.1 点击 "Reject" 打开弹窗，标题包含对应 confirmation no.。
- TP7.2 理由为空时 "Confirm reject" 按钮 disabled。
- TP7.3 填写理由后按钮可点击，提交中显示 loading spinner。
- TP7.4 点击 Cancel 关闭弹窗且不提交任何请求。

## 8. +Custom option 弹窗

- TP8.1 点击 "+ Custom option" 打开弹窗，标题含 confirmation no.。
- TP8.2 标题为空时 "Offer option" 按钮 disabled。
- TP8.3 可勾选/取消勾选 perks 复选框（多选）。
- TP8.4 无 perks 数据时展示 "No perks yet — add some in Hotel Profile." 提示。
- TP8.5 点击 Cancel 关闭弹窗不提交。

## 9. Guest selection 的 Confirm/Reject/Add perks

- TP9.1 "Confirm availability" 按钮同样有 busyIds 并发防抖（同 TP6 逻辑，作用于 option）。
- TP9.2 "Add perks" 按钮打开 PerksModal，已选 perks 数量会显示在按钮文案上（如 "Add perks (2)"）。
- TP9.3 PerksModal 中的选中状态初始值来自 `option.perkNames`。

## 10. 徽章颜色语义

- TP10.1 "high value" 徽章使用成功色（绿色系），不与 overdue 卡片的红色边框/"overdue" 警示文字混淆。
- TP10.2 "guest confirmed" 徽章使用警示色（黄/橙），与 "returning"（蓝紫）、"high value"（绿）视觉区分明确，三者互不撞色。

## 11. 更新时效性（30 秒轮询）

- TP11.1 页面进入后每 30 秒静默刷新一次（`refresh({silent:true})`），刷新时不应弹出整屏 loading（`showLoading` 只在首次挂载生效）。
- TP11.2 静默轮询进行时，若某张卡片正处于 busy（正在提交）状态，轮询触发的数据更新不应打断/中止这次提交。

## 12. 空队列 / 下拉刷新

- TP12.1 队列完全为空时展示 "You're all caught up" + 酒店概况快照（room types / perks / 地址）。
- TP12.2 下拉刷新（`RefreshControl`）触发 `refresh({silent:true})`，不整屏 loading。

## 13. 本轮测试发现并修复的 bug

- TP13.1 三个弹窗（RejectModal / PerksModal / CustomOptionModal）在各自 target 为 null 时使用了同一个字面量 `key="none"` fallback，导致同时渲染时 React 报 "Encountered two children with the same key" 警告（实测 400+ 次）。已修复为各自专属的 `"reject-empty"` / `"perks-empty"` / `"custom-empty"`。回归验证：打开控制台，正常浏览/操作页面，确认不再出现该报错。
- TP13.2 "Confirm deferral" / "Confirm availability" 按钮（`primaryButton` 样式）没有 `minWidth`，进入 loading 态时文字换成小圆 spinner 会让按钮明显变窄，同一行的 "+ Custom option" / "Reject" 跟着往左挤——真机上快速连点两下，第二下有概率误触到挤过来的邻居按钮，而不是被 `inFlightIds` 拦在原按钮位置上不动。用 Playwright 真实测量：修复前按钮从 123.7px 收缩到 spinner 宽度；已加 `minWidth: 124` 修复，回归测量按钮 loading 前后宽度一致（124px → 124px），"+ Custom option"/"Reject" 不再位移。
