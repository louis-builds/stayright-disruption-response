# Settings（设置）页测试用例

## TC-S01 个人资料入口
- TC-S01-1: 展示当前用户头像首字母、昵称、邮箱
- TC-S01-2: 点击 "Edit profile →" 跳转 Profile 页

## TC-S02 通知分类开关
- TC-S02-1: 展示 3 个通知分类开关（New disruption alerts / Case status changes / Options ready），默认全部为开
- TC-S02-2: 关闭某个开关后，本地持久化生效（AsyncStorage），退出重进/刷新后状态保持
- TC-S02-3: 每个开关独立切换，互不影响

## TC-S03 权限与 App 信息
- TC-S03-1: 展示 Push notifications 权限状态（Granted/Denied/Checking…），带对应颜色圆点
- TC-S03-2: 展示 App version（来自 Constants.expoConfig.version）
- TC-S03-3: 页面重新获得焦点（useFocusEffect）时会刷新权限状态显示

## TC-S04 联系支持
- TC-S04-1: 展示 "Need help? Contact support →" 入口
- TC-S04-2: 点击后调用 Linking.openURL 打开 mailto:support@traveldisruption.example

## TC-S05 登出流程
- TC-S05-1: 点击 Sign Out 前，若本地存有 push token，真实调用 DELETE /api/push/register 注销
- TC-S05-2: 登出过程中按钮显示 loading 指示，禁止重复点击
- TC-S05-3: 登出后真实调用 POST /api/auth/logout，本地会话状态清空
- TC-S05-4: 登出后 Cookie 真的失效（再次访问受保护接口应返回 401/403）
- TC-S05-5: 登出后跳转回 Login 页

## TC-S06 视觉细节
- TC-S06-1: 页面进场有淡入动画
- TC-S06-2: 头像/Edit profile 链接/Contact support 链接均为 violet 品牌色
- TC-S06-3: 所有可点元素（Profile 卡片、Contact support、Sign Out）都有按压态反馈
