# Register 页测试用例

## TC-R01 表单字段完整性
- TC-R01-1: 页面展示 Nickname / Gender / Language / Email / Phone / Password / Confirm password 七个字段，无地址/地图字段
- TC-R01-2: Gender 默认选中 "Prefer not to say"，Language 默认选中 "English"
- TC-R01-3: 切换 Gender/Language pill，选中态样式（violet 填充）正确切换，且只有一个选中

## TC-R02 字段校验
- TC-R02-1: 邮箱格式错误时，字段下方即时显示 "Invalid email format"
- TC-R02-2: 手机号格式错误时，字段下方即时显示 "Invalid phone format"
- TC-R02-3: 两次密码不一致时，显示 "Passwords do not match"
- TC-R02-4: 任意必填字段为空时提交，显示 "Please fill in all fields"
- TC-R02-5: 密码少于 8 位时提交，显示 "Password must be at least 8 characters"

## TC-R03 密码强度条
- TC-R03-1: 未输入密码时不显示强度条
- TC-R03-2: 输入弱密码（如 "abc"）显示 "Weak" 红色条
- TC-R03-3: 输入强密码（大小写+数字+符号+12位以上）显示 "Strong" 绿色条
- TC-R03-4: 密码可见性切换（Show/Hide）对密码和确认密码框同步生效

## TC-R04 注册成功流程
- TC-R04-1: 全部字段合法后点击 Create Account，真实调用 POST /api/auth/register 成功
- TC-R04-2: 注册成功后自动调用登录并跳转进入已登录态（Home 或权限引导页），不停留在注册页
- TC-R04-3: 提交中按钮显示 loading spinner

## TC-R05 注册失败
- TC-R05-1: 邮箱已被注册时，显示后端返回的错误信息
- TC-R05-2: 昵称已被占用时，显示后端返回的错误信息

## TC-R06 跳转与视觉细节
- TC-R06-1: 点击 "Already have an account? Sign in" 跳转 Login 页
- TC-R06-2: 错误提示有渐变+抖动动画
- TC-R06-3: 进场时整体表单有淡入+上移动画
- TC-R06-4: 所有 pill 和按钮都有按压态反馈
