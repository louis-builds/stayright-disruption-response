# Coordinator App

协调员专属移动端：案件处理 + 呼叫。技术选型与页面结构见 `/Users/yangdongqing/it/Claude/协调员App.xmind`；实现计划见本目录 `plan.md`/`verifier.md`。

## 环境准备

```bash
npm install
cp .env.example .env   # 按需修改 EXPO_PUBLIC_API_BASE_URL，指向本地/联调环境的 Kakapo 后端
```

后端需已在跑（默认 `http://localhost:5080`，参考仓库根目录 `backend/README` 或直接 `dotnet run`）。

## 本地启动

```bash
npx expo start
```

- 按 `i` 用 iOS 模拟器打开（需要装了完整 Xcode，不是只有 Command Line Tools）。
- 按 `a` 用 Android 模拟器打开（需要 Android Studio + 一个已建好的虚拟设备）。
- 按 `w` 用浏览器打开网页版（`react-native-web`，本仓库开发环境没有 Xcode/模拟器时验证功能用这个）。
- 也可以装 Expo Go App 扫码在真机上跑。

## 网页版调试时的一个坑

后端 CORS 只放行一个固定的 `FRONTEND_ORIGIN`（默认 `http://localhost:5173`，配的是现有 Web 前端）。用 `npx expo start --web` 在浏览器里跑这个 App 时，如果端口不是 5173，需要给后端另起一个实例并临时指定：

```bash
FRONTEND_ORIGIN=http://localhost:<expo-web-端口> ASPNETCORE_URLS=http://localhost:5080 dotnet run
```

真机/模拟器上跑（iOS/Android）不受这个限制——CORS 只影响浏览器里的网页，原生 App 不走这一套。

## 目录结构

按 `/Users/yangdongqing/it/Claude/开发规范.md` 第1.1/1.5节分层：

```
src/
  shared/
    api/          # apiFetch 封装、分页/响应通用类型
  features/
    auth/          # 登录、权限引导、会话状态(AuthContext)
    cases/         # 案件队列/详情
    calls/         # 呼叫、我的通话记录
    notifications/ # 通知中心
    settings/      # 设置页
  navigation/      # 底部 Tab 一级导航 + 根导航(登录态路由)
```

每个 feature 模块内部：`types.ts`（类型）→ `api.ts`（服务层）→ hook/Context（状态/逻辑层）→ `Screen.tsx`（视图层）→ `index.ts`（对外导出）。视图层不直接调用 `api.ts`，一律经过 hook/Context。

## 会话与鉴权

后端是 Cookie/Session 鉴权。React Native 的原生网络层（iOS `NSHTTPCookieStorage` / Android `CookieManager`）会自动接收并在同源请求上持续携带 Cookie，且默认持久化到磁盘——不需要额外的 Cookie 管理库，也不需要手动把 Cookie 值搬进 `AsyncStorage`（这条路线技术上就走不通：Fetch 规范本身禁止 JS 读取 `Set-Cookie` 响应头，是规范层面的限制，不是 React Native 特有的）。

`AsyncStorage` 只用来存两件跟真正鉴权无关的本地偏好：记住的登录名（勾选"记住我"时）、一个"大概率已登录"标记（决定 App 冷启动时先显示 loading 还是直接尝试免登录）。真正的登录状态永远以一次真实请求（`GET /api/notifications/unread-count`）的成败为准。

此 App 只给 `coordinator` 角色用，登录成功后会校验角色，非协调员账号会被立即登出并提示。
