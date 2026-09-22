# SettingsScreen 测试用例

页面: `src/features/settings/SettingsScreen.tsx`（单用户固定配置页）
覆盖范围: 不仅限于需求背景，包含所有用户可触达的交互点。

## 1. 个人资料卡

- TP1.1 头像展示昵称首字母（大写）。
- TP1.2 展示昵称、邮箱；有手机号时额外展示手机号行。

## 2. 通知偏好

- TP2.1 3 个开关（New inquiry / Guest confirmed an option / Policy processing updates）初始状态与 AsyncStorage 中已持久化的值一致。
- TP2.2 切换任意开关后短暂展示绿色 "Saved" 文案（1.5s 后自动消失）。
- TP2.3 刷新页面后开关状态保持（AsyncStorage 持久化生效）。

## 3. Change password 表单

- TP3.1 current 为空 → 提交显示 "Enter your current password"。
- TP3.2 current 已填、next 长度 < 8 → 提交显示 "New password must be at least 8 characters"。
- TP3.3 任一字段重新输入后，旧的错误消息立即清除。
- TP3.4 提交中按钮显示 "Updating…" 并 disabled（本轮不真的提交成功修改真实密码，只验证校验/loading/清错行为，保护测试账号）。
- TP3.5（代码走查，本轮不故意断网复现）网络失败态已有 try/catch/finally 包裹，`submitting` 不会卡死在 true——此前 round 已修复的 bug，本轮走查代码确认 try/catch/finally 结构仍在（`SettingsScreen.tsx:41-54`）。

## 4. 密码字段 autofill 属性

- TP4.1 current password 字段有 `autoComplete="current-password"` / `textContentType="password"`。
- TP4.2 new password 字段有 `autoComplete="new-password"` / `textContentType="newPassword"`。

## 5. Permission status 焦点刷新

- TP5.1 离开 Settings 页再返回，权限状态重新查询一次（`useFocusEffect`，而非只在首次挂载查一次）。

## 6. About

- TP6.1 展示 "App version X.X.X"（来自 `Constants.expoConfig.version`）。

## 7. Sign out

- TP7.1 点击 "Sign out" → 按钮显示 "Signing out…" → 跳转回登录页。
- TP7.2 登出后重新用同一账号登录，确认账号/密码未被破坏。

## 8. 页面挂载动画

- TP8.1 页面挂载时有淡入 + 轻微上移动画（450ms，纯 mount 触发，不依赖任何数据加载）。
