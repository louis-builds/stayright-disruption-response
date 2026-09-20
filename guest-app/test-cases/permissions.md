# Permissions（权限引导）页测试用例

## TC-P01 展示时机
- TC-P01-1: 未登录状态不会显示此页（登录后才出现）
- TC-P01-2: 已完成过 onboarding 的用户再次登录不会再看到此页
- TC-P01-3: 首次登录成功后立即展示此页

## TC-P02 通知权限请求
- TC-P02-1: 初始状态显示 "Not requested"，按钮文案为 "Request"
- TC-P02-2: 点击 Request 后触发系统权限弹窗（或浏览器权限行为）
- TC-P02-3: 授权通过后状态变为 "Granted"，图标背景变绿，出现放大回弹（bump）动画
- TC-P02-4: 拒绝后状态变为 "Denied"，按钮文案变为 "Retry"，且出现 "Open system settings to enable →" 链接
- TC-P02-5: 点击 "Open system settings to enable" 会调用 Linking.openSettings()

## TC-P03 通知预览卡片
- TC-P03-1: 页面展示 "WHAT YOU'LL SEE" 预览卡片，包含示例通知内容
- TC-P03-2: 预览卡片视觉上与实际 Home 页通知卡片风格一致

## TC-P04 授权成功后的推送注册
- TC-P04-1: 授权通过后（非 web 平台）会调用 Notifications.getExpoPushTokenAsync() 并 POST /api/push/register
- TC-P04-2: Web 平台上授权通过后不会因拿不到 push token 而报错阻断流程

## TC-P05 继续按钮
- TC-P05-1: 无论授权与否，Continue 按钮始终可点击
- TC-P05-2: 点击 Continue 后进入 App 主界面（底部 4 个 Tab）
- TC-P05-3: 再次冷启动不会重复展示此页

## TC-P06 布局与空间利用率
- TC-P06-1: 800×450 视口下内容垂直居中，无大片空白
- TC-P06-2: 1440×900 宽视口下内容仍垂直居中，无超过 30% 的死区空白
