# NotificationCenterScreen 测试用例

页面: `src/features/notifications/NotificationCenterScreen.tsx` + `useNotifications.ts`
覆盖范围: 不仅限于需求背景，包含所有用户可触达的交互点。

**DB 现状（本轮测试前已确认）**: 全库仅 2 条 `guest_selection` 类型通知，且均已读（`readAt` 非空）。后端未暴露"标记未读"接口（`markNotificationRead` 单向不可逆），因此本轮无法在不伪造/污染真实种子数据的前提下构造出真实的未读通知——涉及未读专属视觉的测试点（unreadDot、rowUnread 背景、Mark all read 按钮出现、markAllRead 批量操作本身）本轮**只能代码走查**，如实标注，不假装测过。

## 1. 未读数展示

- TP1.1 页头 "Unread N" 数字与后端 `/api/notifications/unread-count` 返回值一致（当前应为 0）。

## 2. Mark all read（代码走查，DB 现状为 0 未读无法触发真实点击）

- TP2.1 `unreadCount > 0` 时才渲染 "Mark all read" 按钮——当前 0 未读，验证按钮确实不渲染（这本身就是可验证的真实断言）。
- TP2.2（代码走查）`markAllRead()` 用 `Promise.allSettled` 而非 `Promise.all`，单条失败不阻断整批；`finally` 保证 `markingAll` 不会卡死在 true。

## 3. 单条通知点击标记已读 + 跳转

- TP3.1 点击一条已读通知（`caseId` 存在）→ 跳转到 Inbox（不依赖未读状态，`caseId` 存在就跳转）。
- TP3.2（代码走查）点击未读通知会先 `markRead()` 再跳转，`markRead` 失败被 catch 吞掉不阻断导航（`NotificationCenterScreen.tsx:36-42`，本轮已修复的 bug，无未读数据可现场复现失败场景，走查代码确认 try/catch 结构仍在）。

## 4. Unread only 开关切换（回归重点）

- TP4.1 切换 "Unread only" 开关时，页面不应变成整屏 loading spinner（此前 round 已修复：`isFirstLoad` ref 保证只有挂载首次非 silent，切换开关时走 silent reload）——真实测量切换前后 header/switch 是否全程保持挂载。
- TP4.2 开启 "Unread only" 后（当前 0 未读）→ 展示 "All caught up" 空态。
- TP4.3 关闭 "Unread only" → 恢复展示全部 2 条已读通知。

## 5. 空态区分

- TP5.1 "Unread only" 开启且无未读 → "All caught up" + "switch off Unread only" 提示文案。
- TP5.2 完全无通知的 "No notifications" 空态本轮 DB 有 2 条真实记录，无法在不清空真实数据的前提下触发——代码走查确认分支存在（`unreadOnly ? "All caught up" : "No notifications"`）。

## 6. 更新时效性（20 秒轮询）

- TP6.1 页面停留 21+ 秒后，静默轮询应触发一次刷新，全程不出现整屏 loading。

## 7. 文本截断

- TP7.1 `rowTitle` 单行截断（`numberOfLines={1}`）。
- TP7.2 `rowText` 两行截断（`numberOfLines={2}`）。

## 8. 行样式区分

- TP8.1 已读行背景为默认 surface 色，不带 `rowUnread` 的 accentSoft 背景 tint，也没有 unreadDot 圆点（当前 2 条都已读，正好验证"已读"分支本身的正确渲染）。

## 9. 下拉刷新

- TP9.1（代码走查）`onRefresh` 调用 `refresh({silent:true})`，与轮询同一套 silent 约定，不整屏 loading。
