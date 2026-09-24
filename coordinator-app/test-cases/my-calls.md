# MyCallsScreen 测试用例

## 1. 列表展示
- 1.1 加载中显示居中 loading 指示器
- 1.2 加载完成后展示当前协调员本人的历史通话列表,每条显示客人昵称、被叫类型(Guest/Hotel)、酒店名、确认号、状态、时间、时长
- 1.3 顶部显示统计文案 "N calls"(单数/复数正确处理,1 条时显示 "1 call")
- 1.4 列表为空时显示 "No calls yet"
- 1.5 列表内容加载完成后有淡入过渡

## 2. 搜索
- 2.1 在搜索框输入客人/酒店/确认号相关文字,列表按输入实时过滤

## 3. 筛选
- 3.1 被叫类型筛选(All types/Guest/Hotel)可正确切换,列表相应过滤,当前选中项高亮
- 3.2 状态筛选(All statuses/Completed/Failed/No answer)可正确切换,列表相应过滤,当前选中项高亮
- 3.3 两种筛选可同时生效(交集)
- 3.4 筛选 chip 按下时有透明度反馈

## 4. 列表行状态
- 4.1 状态为 completed 的行可点击,点击后跳转到 RecordingDetail 页面
- 4.2 状态为 connecting/in_progress/failed/no_answer 的行不可点击(disabled),整行呈现变淡的视觉效果以区分可点/不可点
- 4.3 failed 状态文字显示为红色,no_answer 状态文字显示为灰色,与 completed(强调色)区分
- 4.4 可点击行按下时有背景变化反馈

## 5. 下拉刷新
- 5.1 下拉可触发刷新,刷新指示器正确显示和消失
