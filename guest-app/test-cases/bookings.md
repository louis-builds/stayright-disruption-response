# Bookings（我的订单）页测试用例

## TC-B01 加载与空状态
- TC-B01-1: 加载中显示 loading 占位
- TC-B01-2: 账号下无任何订单时显示空状态提示

## TC-B02 状态分布条
- TC-B02-1: 有订单时展示分布条，Confirmed 分段为绿色、Action needed 为橙色、Rebooked 为蓝色、Cancelled 为灰色
- TC-B02-2: 分布条各分段宽度比例与实际订单数量比例一致

## TC-B03 筛选
- TC-B03-1: 5 个筛选 pill（All/Confirmed/Action needed/Rebooked/Cancelled）各自数字与实际数据一致
- TC-B03-2: 点击筛选 pill 后列表联动过滤，选中态高亮（violet）
- TC-B03-3: 筛选切换会重置分页到第 1 页

## TC-B04 搜索
- TC-B04-1: 按酒店名搜索能过滤出匹配订单
- TC-B04-2: 按确认号搜索能过滤出匹配订单
- TC-B04-3: 搜索与筛选可叠加生效（AND 逻辑）
- TC-B04-4: 无匹配结果时显示 "No matching bookings" 并提供 "Clear filters" 按钮
- TC-B04-5: 点击 Clear filters 重置搜索词和筛选为 All

## TC-B05 订单卡片信息
- TC-B05-1: 卡片展示酒店名、房型、入离日期、晚数、总价、入住人数、确认号、状态徽章
- TC-B05-2: 有关联未结案案件的订单显示 "A linked case needs your review" 提示并展示 "Open case →" 按钮
- TC-B05-3: 已结案且有退款的订单显示退款金额信息
- TC-B05-4: 点击 "Open case →" 跳转到对应 Case Conversation（跨 Tab 导航）

## TC-B06 复制确认号
- TC-B06-1: 点击确认号旁 Copy 按钮，调用 expo-clipboard 写入剪贴板
- TC-B06-2: 点击后按钮文案短暂变为 "Copied ✓"，1.4 秒后恢复 "Copy"

## TC-B07 分页
- TC-B07-1: 每页 5 条，超过 5 条时展示分页控件
- TC-B07-2: Prev/Next 按钮在边界页正确禁用（灰色不可点）
- TC-B07-3: 翻页后 "Showing X–Y of Z" 文案与实际范围一致，数据不丢失

## TC-B08 视觉细节
- TC-B08-1: 下拉刷新可手动触发重新加载
- TC-B08-2: 页面进场有淡入动画
- TC-B08-3: 所有可点元素（筛选 pill、Copy、Open case、分页按钮）都有按压态反馈
