# HistoryScreen 测试用例

页面: `src/features/history/HistoryScreen.tsx`（只读审计存档）
覆盖范围: 不仅限于需求背景，包含所有用户可触达的交互点。

## 1. 统计卡片 + RatioBar

- TP1.1 "Disruption requests answered" 数字与 accepted+rejected 之和一致，下方展示 "N accepted · M rejected"。
- TP1.2 "Guest selections resolved" 数字与 confirmed+declined 之和一致，下方展示 "N confirmed · M declined"。
- TP1.3 两条 RatioBar 按比例渲染绿/红两段，且带 `accessibilityRole="progressbar"` 语义。
- TP1.4 完全无数据时（0 条记录），统计卡片整个不渲染（`history.doneItems.length > 0` 门控）。

## 2. KindFilter 三态切换

- TP2.1 默认 "All"，展示全部已结案记录。
- TP2.2 切到 "Disruption requests" → 只显示 inquiry 类型。
- TP2.3 切到 "Guest selections" → 只显示 option 类型。
- TP2.4 filter pill 有 `accessibilityRole="button"` + `aria-selected`，当前选中项 `aria-selected="true"`，其余为 `"false"`。

## 3. 搜索（按钮触发）

- TP3.1 输入内容但不点击 Search → 列表不立即过滤。
- TP3.2 点击 "Search" → 按 confirmation no. 或 guest 昵称过滤生效。
- TP3.3 无匹配时展示 "No matches" 空态（区别于完全无数据的 "No history yet"）。
- TP3.4 点击 "Clear" 重置 kind filter + 搜索条件。

## 4. resolvedFooter 签收行

- TP4.1 非负面结果（accepted/confirmed）显示绿色 "✓ Resolved"。
- TP4.2 负面结果（rejected/declined）显示红色 "✕ Closed"。
- TP4.3 签收行附带相对时间（如 "9h ago"）。

## 5. Guest tag 管理

- TP5.1 卡片展示已有 tag chips，点击管理入口打开 TagManageModal。
- TP5.2 弹窗展示该 guest 的全部自定义 tag，可勾选/取消。

## 6. 徽章颜色语义

- TP6.1 "high value" 徽章使用成功色（绿色系），不与该卡片可能同时存在的 rejected/declined 状态标签（红色系）撞色。

## 7. 更新时效性 / 下拉刷新

- TP7.1 下拉刷新触发 `refresh({silent:true})`，不整屏 loading。

## 8. 空态区分

- TP8.1 完全无历史记录（真实 0 条）→ "No history yet" + 说明文案，无统计卡片/过滤/搜索区域。
- TP8.2 有历史记录但筛选/搜索无匹配 → "No matches"。
