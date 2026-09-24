# CallSummaryScreen 测试用例

## 1. 结果展示
- 1.1 通话成功(completed)时显示绿色对勾图标+ "Connected" 文案
- 1.2 通话失败(failed)时显示红色叉号图标+ "Call failed" 文案
- 1.3 无人接听(no_answer)时显示对应图标+ "No answer" 文案
- 1.4 显示通话时长(秒数),无时长数据时显示 "—"
- 1.5 页面加载时结果卡片有弹入式的缩放+淡入动画(spring 效果)

## 2. 录音处理(仅 completed 状态)
- 2.1 录音处理中,显示 loading 指示器和当前处理阶段文案(pending/transcribing/summarizing)
- 2.2 处理状态切换时(如 pending → transcribing → done)卡片内容有淡入过渡,不是生硬替换
- 2.3 处理完成(done)后,显示 "Recording processed" 文案和 "View Recording" 按钮
- 2.4 点击 "View Recording" 跳转到 RecordingDetail 页面

## 3. 失败重试(仅 failed/no_answer 状态)
- 3.1 显示 "Call Again" 按钮
- 3.2 点击后按钮文案变为 "Calling…" 且禁用,防止重复点击
- 3.3 重试成功后跳转到 InCall 页面

## 4. 返回
- 4.1 "Back to Case" 按钮始终显示,点击后返回到案件详情页(popToTop)
- 4.2 按下有透明度反馈

## 5. 边界
- 5.1 completed 但 processingStatus 尚未返回时(初次渲染),不应崩溃,应显示 pending 态
