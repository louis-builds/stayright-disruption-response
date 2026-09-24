# Options Flow（重订方案）页测试用例

## TC-O01 上下文信息
- TC-O01-1: 顶部展示 "← Back to Case Conversation"，点击返回案件对话页
- TC-O01-2: 展示酒店名、入离日期、可用方案数/总方案数

## TC-O02 方案对比（Compare 步骤）
- TC-O02-1: 每个方案卡片展示类型图标、标题、描述、可用性徽章（Available now/Awaiting hotel confirmation/Not available）
- TC-O02-2: 方案详情字段（酒店/房型/距离/费用差/退款金额/取消费/处理时长/新入离日期/推荐理由）按方案类型正确展示，缺失字段不显示
- TC-O02-3: 不可用方案（unavailable）置灰且 Select 按钮禁用，显示 "This option is no longer available."
- TC-O02-4: 费用对比条形图仅在方案数≥2 且至少两个方案有费用/退款字段时展示
- TC-O02-5: 费用对比条：多花钱方向为红色，省钱/退款方向为绿色，条形长度与金额成比例
- TC-O02-6: StepDots 步骤指示器在 compare 步骤高亮 "Compare"

## TC-O03 选择方案
- TC-O03-1: 点击 "Select this option" 后该方案卡片高亮边框，按钮文案变为 "Selected ✓ — change"
- TC-O03-2: 选择方案会真实调用 POST /api/cases/{id}/options/{id}/select
- TC-O03-3: 底部 "Your selection" 卡片同步展示当前选中方案标题
- TC-O03-4: 未选择任何方案时 "Continue to confirm →" 按钮禁用

## TC-O04 查看政策
- TC-O04-1: 点击 "View policy & fees" 进入政策详情面板，展示政策原文摘录（如有）
- TC-O04-2: 无匹配政策摘录时显示 "No specific policy excerpt matched — general terms apply."
- TC-O04-3: 展示费用明细键值对（过滤掉 hotel_id）
- TC-O04-4: 点击 "← Back to options" 返回 compare 步骤，StepDots 仍显示 Compare 阶段（不算进入过 Confirm）

## TC-O05 提议不同日期（仅 defer 方案）
- TC-O05-1: 仅 defer 类型方案展示 "Propose different dates" 入口
- TC-O05-2: 弹窗默认日期取自方案 payload 的 offset 天数换算结果
- TC-O05-3: 日期格式非法或结束日期早于/等于开始日期时 "Send to hotel" 按钮禁用
- TC-O05-4: 提交合法日期后真实调用 POST /api/cases/{id}/options/{id}/propose-dates 并关闭弹窗
- TC-O05-5: 点击 Cancel 关闭弹窗不提交

## TC-O06 确认执行（Confirm 步骤）
- TC-O06-1: 点击 "Continue to confirm →" 进入 confirm 步骤，StepDots 高亮 "Confirm"
- TC-O06-2: 展示选中方案的费用/退款摘要与提示文案（cancel 类型文案不同于其它类型）
- TC-O06-3: 点击 "Confirm & submit" 真实调用 POST /api/cases/{id}/options/{id}/confirm-execution
- TC-O06-4: 提交中按钮显示 loading
- TC-O06-5: success 结果展示新确认号与新入离日期
- TC-O06-6: failed/processing 结果展示对应提示文案与返回对话页链接
- TC-O06-7: 案件已经结案时进入此页直接展示 "This case has already been resolved" 只读结果，不出现任何可操作按钮

## TC-O07 已结案案件的只读视图
- TC-O07-1: 案件已结案时页面顶部展示 "This case is resolved" 横幅与最终选择方案
- TC-O07-2: 展示所有历史方案卡片为只读态（无 Select/Propose 按钮），标注 "Final pick"/"Not chosen"

## TC-O08 视觉与过渡
- TC-O08-1: compare→policy→confirm 步骤切换时有淡入过渡动画
- TC-O08-2: 所有按钮（Select/Continue/Confirm/modal 按钮/policy 与 propose-dates 链接）都有按压态反馈
