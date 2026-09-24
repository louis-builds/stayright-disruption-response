# Home（首页/仪表盘）页测试用例

## TC-H01 欢迎区块
- TC-H01-1: 展示 "Kia ora, {nickname}"，nickname 来自当前登录用户
- TC-H01-2: "Live monitoring" 徽章常驻显示，绿色圆点

## TC-H02 统计卡片
- TC-H02-1: Upcoming stays 数字等于未取消且未过期的订单数
- TC-H02-2: Action required 数字等于未结案案件数，>0 时卡片变粉红底色
- TC-H02-3: Unread notices 数字等于未读通知数
- TC-H02-4: Next check-in 展示最近一次入住日期；有值时下方出现紧迫度进度条（越近颜色越深：teal→amber→red）
- TC-H02-5: 无未来入住时 Next check-in 显示 "—" 且不显示进度条
- TC-H02-6: 数据加载中统计卡片显示 "—" 占位

## TC-H03 优先提醒条 / 全部正常卡片
- TC-H03-1: 存在未结案案件时展示 "⚠️ Priority: your stay may be affected" 卡片，含倒计时（"Xd to check-in" / "Check-in due now"）
- TC-H03-2: 点击优先提醒卡跳转到对应案件的 Case Conversation 页
- TC-H03-3: 无未结案案件时展示绿色 "No action is required right now" 卡片
- TC-H03-4: 优先卡片按压时有视觉反馈

## TC-H04 即将入住列表
- TC-H04-1: 最多展示 3 条即将到来的订单
- TC-H04-2: 有关联案件的订单点击后跳转 Case Conversation，无关联案件的跳转 Bookings Tab
- TC-H04-3: 无未来订单时显示空状态提示
- TC-H04-4: 点击 "View all bookings →" 跳转 Bookings Tab（跨 Tab 导航）

## TC-H05 通知列表与搜索
- TC-H05-1: 默认展示最近 4 条通知
- TC-H05-2: 搜索框按标题/正文/灾害类型过滤，大小写不敏感
- TC-H05-3: 搜索无匹配结果时显示 "No matches" 空状态
- TC-H05-4: 点击未读通知会标记已读并（若关联案件）跳转 Case Conversation
- TC-H05-5: 通知每 20 秒自动轮询刷新
- TC-H05-6: 下拉刷新可手动触发数据重新加载

## TC-H06 三步说明卡片
- TC-H06-1: 展示 "How StayRight helps" 三步说明，步骤序号徽章为 violet 圆形

## TC-H07 视觉与空间利用率
- TC-H07-1: 卡片列表在 1440×900 宽视口下无异常空白
- TC-H07-2: 深色欢迎卡片背景色与登录页渐变深色一致（#151126）
- TC-H07-3: 页面整体有进场淡入动画
