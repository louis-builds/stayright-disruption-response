# Profile（个人资料）页测试用例

## TC-PR01 基本信息展示与编辑
- TC-PR01-1: 页面加载时字段回填当前用户的 Nickname/Gender/Language/Phone
- TC-PR01-2: Gender/Language pill 切换选中态正确
- TC-PR01-3: Phone 格式错误时字段下方即时显示 "Invalid phone format"
- TC-PR01-4: Account type 字段为只读（disabled 样式）

## TC-PR02 资料完整度进度条
- TC-PR02-1: 完整度百分比 = 已填字段数/5（avatarUrl、nickname、gender≠unspecified、language、phone合法）
- TC-PR02-2: 修改字段（如切换 Gender 为非 unspecified）后完整度实时（未保存前）更新

## TC-PR03 保存基本信息
- TC-PR03-1: 点击 "Save Profile Changes" 真实调用 PUT /api/users/me/profile
- TC-PR03-2: 保存中按钮显示 loading
- TC-PR03-3: 保存成功后显示 "Profile saved" 淡入提示，且全局用户状态（如 Home 页昵称）同步更新
- TC-PR03-4: 保存失败时显示后端返回的错误信息
- TC-PR03-5: Phone 校验不通过时点击保存不会发起请求

## TC-PR04 修改邮箱
- TC-PR04-1: 展示当前邮箱（只读）
- TC-PR04-2: 输入新邮箱格式错误时显示 "Invalid email format"，"Send verification code" 按钮禁用
- TC-PR04-3: 点击 "Send verification code" 真实调用 POST /api/users/me/email/request-change，成功后切换到验证码输入阶段
- TC-PR04-4: 输入验证码点击 "Confirm change" 真实调用 POST /api/users/me/email/confirm-change
- TC-PR04-5: 邮箱修改成功后当前邮箱展示更新为新邮箱，且全局用户状态同步
- TC-PR04-6: 验证码错误时显示失败提示，不清空已输入内容

## TC-PR05 修改密码
- TC-PR05-1: 输入新密码时展示密码强度条（Weak/Fair/Strong 三档颜色）
- TC-PR05-2: 点击 "Update Password" 真实调用 POST /api/users/me/password
- TC-PR05-3: 修改成功后显示 "Password changed" 提示，并清空当前/新密码输入框
- TC-PR05-4: 当前密码错误时显示后端返回的失败提示

## TC-PR06 账号信息
- TC-PR06-1: 展示 Member since（注册日期格式化）与 Account type
- TC-PR06-2: 展示角色说明文案（Traveller services blurb）

## TC-PR07 视觉细节
- TC-PR07-1: 页面进场有淡入动画
- TC-PR07-2: 所有提示消息（Profile saved/Password changed/邮箱相关提示）都有淡入动画
- TC-PR07-3: 所有按钮和 pill 都有按压态反馈
- TC-PR07-4: 页面头部有原生返回按钮返回 Settings
