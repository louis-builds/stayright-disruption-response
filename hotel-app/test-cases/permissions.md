# PermissionsScreen 测试用例

页面: `src/features/auth/PermissionsScreen.tsx`（一次性 onboarding 引导页，`RootNavigator` 在
`onboardingDone` 为 false 时展示）。
覆盖范围: 不仅限于需求背景，包含所有用户可触达的交互与状态分支。

## 1. Notifications 权限 — unknown 态

- TP1.1 首次进入页面，权限状态显示 "Not requested"（灰点），操作按钮显示 "Request"。

## 2. Notifications 权限 — 拒绝路径（denied）

- TP2.1 点击 "Request" 后浏览器拒绝授权 → 状态变为 "Denied"（红点），操作按钮文案变为 "Check again"，且额外出现 "Open system settings to enable →" 链接。
- TP2.2 点击 "Open system settings to enable →" 链接不应导致页面崩溃或白屏（Web 端 `Linking.openSettings()` 行为可能是 no-op，属预期）。
- TP2.3 再次点击 "Check again" 应重新触发一次请求流程（loading 态可见）。

## 3. Notifications 权限 — 授权路径（granted）

- TP3.1 浏览器预先授权（通过自动化工具的 context 权限预授予，而不是人工点浏览器弹窗）→ 点击 "Request" → 状态变为 "Granted"（绿点），操作按钮整行隐藏（`state !== "granted"` 才渲染按钮），图标背景变成成功色，图标有轻微 bump 弹性动画。

## 4. 请求中 loading 态

- TP4.1 点击 "Request"/"Check again" 后按钮内显示 `ActivityIndicator` 而非文字，按钮 disabled，请求结束后恢复。

## 5. 通知原因说明列表

- TP5.1 页面展示 3 条 "What you'll be notified about" 条目：New inquiry / Guest confirmed an option / Policy processing updates，且有交错（stagger）淡入动画。

## 6. Continue 按钮 / onboarding 完成流程

- TP6.1 点击 "Continue" → 引导页消失，跳转到登录页（未登录）或已登录主界面（如果本来就有有效 session）。
- TP6.2 完成一次 Continue 后，AsyncStorage（web 端为 localStorage polyfill）写入 `onboardingDone=true`。

## 7. onboarding 完成后的持久化

- TP7.1 完成一次 Continue 后刷新/重新打开页面 → 不再展示 PermissionsScreen，直接进入 Login 或已登录主界面。
- TP7.2（反向验证）清空该来源的本地存储模拟"全新设备首次打开" → 重新打开确实会展示 PermissionsScreen（证明这条持久化逻辑是真的在生效，不是巧合从未触发过判断分支）。

## 8. 页面视觉 / 进场动画

- TP8.1 页面挂载时 body 区块有淡入 + 轻微上移的进场动画（450ms）。
- TP8.2 通知原因三条以 90ms 间隔交错淡入 + 上移。
- TP8.3 背景为浅色渐变（`theme.background → theme.accentSoft → theme.background`），与 LoginScreen 的深紫色背景形成对比（引导页 vs 登录页视觉区分明确，不会让人误以为是同一个页面）。

## 9. 权限依赖检查（常见问题.txt 第7条）

- TP9.1 already-granted 状态下，"Request"/"Check again" 操作按钮应完全不显示（不能出现"已授权还提示可以再请求一次"这种冗余/越权操作入口）。
