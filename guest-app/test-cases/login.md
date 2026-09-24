# Login 页测试用例

## TC-L01 基础登录成功
- TC-L01-1: 邮箱 + 正确密码登录成功，跳转到 Home（或权限引导页，视 onboarding 状态）
- TC-L01-2: 用户名（非邮箱格式的 identifier）+ 正确密码登录成功
- TC-L01-3: 登录中按钮显示 loading spinner，禁止重复提交
- TC-L01-4: 登录成功后跳转前，进场动画（渐变背景+光晕+卡片淡入）已完整播放

## TC-L02 登录失败
- TC-L02-1: 密码错误，显示错误提示（渐变+抖动动画）
- TC-L02-2: 账号不存在，显示错误提示
- TC-L02-3: 空邮箱/空密码时提交按钮点击不触发请求（本地校验拦截）
- TC-L02-4: 非 guest 角色账号登录，提示"This app is for travellers only"并自动登出

## TC-L03 密码可见性切换
- TC-L03-1: 默认密码框为密文
- TC-L03-2: 点击 Show 切换为明文，文字变为 Hide
- TC-L03-3: 再次点击 Hide 切回密文

## TC-L04 记住我
- TC-L04-1: 勾选 Remember me 并登录成功后，登出再回登录页，identifier 自动回填且开关保持打开
- TC-L04-2: 不勾选 Remember me 登录，登出后 identifier 为空

## TC-L05 忘记密码
- TC-L05-1: 点击 Forgot password? 展开面板（渐变滑入动画）
- TC-L05-2: 再次点击变为 Hide，收起面板
- TC-L05-3: 输入邮箱点击 Send reset link，调用真实 POST /api/auth/forgot-password，显示成功提示
- TC-L05-4: 空邮箱时 Send reset link 按钮不可点击

## TC-L06 跳转注册
- TC-L06-1: 点击 "New here? Create an account" 跳转 Register 页

## TC-L07 视觉与交互细节
- TC-L07-1: 所有可点元素（Show/Hide、Forgot password、Sign In、Create an account 链接）都有按压态反馈
- TC-L07-2: 品牌徽标背后光晕动画持续循环播放
- TC-L07-3: 深色渐变背景在宽视口（1440×900）下无异常空白/断层
