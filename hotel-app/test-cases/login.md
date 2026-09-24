# LoginScreen 测试用例

页面: `src/features/auth/LoginScreen.tsx`
覆盖范围: 不仅限于需求背景条目，包含所有用户可触达的交互点（含视觉特效、动画、hitSlop 等）。

## 1. 用户名/邮箱双登录

- TP1.1 输入合法**用户名**（如无对应用户名字段则用邮箱本地部分测试跳过）+ 正确密码 → 点击 Sign In → 登录成功，跳转到 Inbox 主界面。
- TP1.2 输入合法**邮箱**（如 `donwhotel@gmail.com`）+ 正确密码 → 点击 Sign In → 登录成功。

## 2. 密码显示/隐藏切换

- TP2.1 密码框默认 `secureTextEntry`，字符以圆点遮罩显示。
- TP2.2 点击 "Show" → 密码明文显示，按钮文案变为 "Hide"。
- TP2.3 再次点击 "Hide" → 恢复遮罩，按钮文案变回 "Show"。

## 3. Remember me

- TP3.1 勾选 Remember me 后登录成功 → 该次登录的 identifier 被写入 AsyncStorage(`hotel-app:rememberedIdentifier`)，同时 session 标记(`hotel-app:wasLoggedIn`)写入 → 刷新页面后因 session 仍有效直接进入已登录态（比\"预填用户名\"更强的记忆效果）。
- TP3.2 不勾选 Remember me 登录后手动登出 → 重新打开登录页，identifier 输入框不应预填任何内容。

## 4. Forgot password 流程

- TP4.1 点击 "Forgot password?" → 下方展开邮箱输入框 + Send reset link 按钮。
- TP4.2 邮箱为空时，"Send reset link" 按钮为 disabled 态（不可点击/视觉变暗）。
- TP4.3 填写邮箱后点击 "Send reset link" → 按钮文案变 "Sending…" → 成功后展示绿色成功文案（demo 环境提示不真实发邮件）。
- TP4.4 再次点击 "Forgot password?" → 收起表单。

## 5. 无效凭证 / 被禁用账号报错

- TP5.1 正确 identifier + 错误密码 → 点击 Sign In → 展示红色错误提示文案，文本带轻微左右抖动动画，密码/用户名框内容不被清空（不清空是为了方便用户核对，只在两个 onChangeText 里显式清 error，不清字段本身）。
- TP5.2 使用非 `hotel` 角色账号登录（如 seed 数据里的 coordinator 账号）→ 后端登录本身成功但角色校验失败 → 提示 "This app is for hotel staff accounts only"，且不会真的进入已登录态。

## 6. 空字段校验

- TP6.1 identifier 和 password 都为空 → Sign In 按钮为 disabled 态。
- TP6.2 只填 identifier、密码为空 → Sign In 按钮仍为 disabled。

## 7. 键盘导航 / Enter 提交

- TP7.1 identifier 框内按 Enter（`returnKeyType="next"`）→ 焦点跳转到 password 框。
- TP7.2 password 框内按 Enter（`returnKeyType="go"`）→ 触发提交。**已用 Playwright 真实键盘事件验证：会正确触发提交并登录成功**（此前某次用另一套浏览器自动化工具的模拟按键没有触发，是那个工具按键模拟方式的限制，不是这里的代码 bug——用真实键盘事件测试后确认 `onSubmitEditing` 工作正常）。

## 8. Remember-me 行 hitSlop

- TP8.1 点击 "Remember me" 文字本身（而非仅限 Switch 控件）也能切换勾选状态（`rememberRow` 整行都是 Pressable）。

## 9. 提交按钮 loading 态

- TP9.1 点击 Sign In 后（网络请求进行中）按钮显示 `SpinningDot` 旋转动画而非文字，且按钮 disabled，请求完成后恢复正常。

## 10. 页面视觉 / 动画（"眼前一亮"特效，超出核心需求）

- TP10.1 背景为深紫色 `LinearGradient`（`#151126 → #24183f → #422879`）。
- TP10.2 品牌徽标（"SR"）背后有缓慢明暗脉动的光晕动画（2.2s 一个周期）。
- TP10.3 卡片和品牌区块挂载时有淡入 + 轻微上移的进场动画（500ms）。
- TP10.4 页脚展示 App 版本号 + 联系方式（邮箱/电话），且页脚不会遮挡卡片内容。
