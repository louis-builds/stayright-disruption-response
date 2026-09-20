# Case Conversation（案件对话）页测试用例

## TC-C01 案件基本信息
- TC-C01-1: 展示案件编号（CASE-xxxxxxxx）、优先级徽章、状态徽章、灾害标题与描述
- TC-C01-2: High priority 案件徽章为粉红色系（#ffedf2/#d33e63）
- TC-C01-3: 展示酒店、确认号、入离日期、指派协调员信息

## TC-C02 线程切换
- TC-C02-1: 默认进入 AI conversation 线程
- TC-C02-2: 点击 Coordinator conversation 切换线程，内容不串（AI 消息不出现在协调员线程）
- TC-C02-3: 切换线程时有淡入过渡动画
- TC-C02-4: 未读消息数徽章正确显示在对应 Tab 上，切到该线程后清零

## TC-C03 AI 线程只读
- TC-C03-1: AI 线程下方展示只读提示文案，不出现输入框
- TC-C03-2: AI 线程历史消息正确按时间顺序展示，发送者头像/标签正确（System/AI Assistant/You）

## TC-C04 协调员线程收发消息
- TC-C04-1: 协调员线程下方展示输入框和 Send 按钮
- TC-C04-2: 输入框为空时 Send 按钮禁用
- TC-C04-3: 发送消息后立即在列表末尾显示，气泡有淡入动画
- TC-C04-4: 发送中 Send 按钮显示 loading 指示
- TC-C04-5: 无消息时显示 "No messages with your coordinator yet."

## TC-C05 消息气泡样式
- TC-C05-1: 自己发的消息（You/guest）气泡右对齐、violet 底色
- TC-C05-2: 对方消息左对齐、浅灰底色
- TC-C05-3: 每条消息展示发送时间

## TC-C06 重订方案入口
- TC-C06-1: 案件未结案时展示 "Review Recovery Options →" 按钮，点击跳转 Options Flow 页
- TC-C06-2: 案件已结案时不展示该按钮，改为展示 "This case is resolved" 提示

## TC-C07 下拉刷新与轮询
- TC-C07-1: 下拉刷新可手动触发消息与案件信息重新加载
- TC-C07-2: 后台每 8 秒自动轮询刷新（不影响当前输入内容）

## TC-C08 导航与视觉
- TC-C08-1: 页面头部有原生返回按钮，点击返回上一页
- TC-C08-2: 新消息到达时自动滚动到底部
