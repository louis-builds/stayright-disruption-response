# Hotel App

酒店端专属移动端：待办处理（询单/已选方案）+ 酒店资料管理（房型/退改政策/权益）。技术选型与页面
结构见 `/Users/yangdongqing/it/Claude/Kakapo/docs/proposals/hotel-app-requirements.xmind`；实现计划
见本目录 `plan.md`/`verifier.md`。技术栈跟 `coordinator-app`/`guest-app` 保持一致。

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
- 网页版固定端口：`npx expo start --web --port 8093`（避开 `coordinator-app` 的 8091、
  `guest-app` 的 8092）。

## 网页版调试时的一个坑

后端 CORS 只放行一个固定的 `FRONTEND_ORIGIN`（默认 `http://localhost:5173`，配的是现有 Web 前端）。
用 `npx expo start --web` 在浏览器里跑这个 App 时，如果端口不是 5173，需要给后端另起一个实例并
临时指定：

```bash
FRONTEND_ORIGIN=http://localhost:8093 ASPNETCORE_URLS=http://localhost:5080 dotnet run
```

真机/模拟器上跑（iOS/Android）不受这个限制——CORS 只影响浏览器里的网页，原生 App 不走这一套。

## 目录结构

按 `/Users/yangdongqing/it/Claude/开发规范.md` 第1.1/1.5节分层：

```
src/
  features/{module}/
    types.ts    # 类型定义
    api.ts      # 后端接口调用
    useXxx.ts   # hook，承载状态与业务逻辑
    XxxScreen.tsx
    index.ts    # 对外导出
  navigation/   # react-navigation 路由结构
  shared/       # 跨 feature 复用（api client、网络状态等）
```

视图层（`Screen.tsx`）不直接调用 `api.ts`，必须经过 hook。

## 会话与鉴权

现有 Kakapo 后端是 Cookie/Session 鉴权。React Native 的原生网络层（iOS `NSHTTPCookieStorage` /
Android `CookieManager`）会自动接收并在同源请求上重新携带 Cookie，且默认持久化到磁盘、重启 App
也还在——不需要额外的 Cookie 管理库。`AsyncStorage` 只用来缓存"记住的登录名"和一个本地"大概率
已登录"标记，真正的鉴权状态以每次请求的成败为准。
