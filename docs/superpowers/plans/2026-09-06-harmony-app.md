# Harmony App Implementation Plan

> **For agentic workers:** Use subagent-driven-development with explicit file ownership; root owns integration and verification.

**Goal:** 在现有服药提醒项目上新增可连接真实后台的鸿蒙原生客户端。

**Architecture:** ArkTS/ArkUI Stage 工程共享 Express API。网页 Cookie 保持兼容，原生增加摘要存储的 Bearer 会话；本地代理提醒按真实后台计划同步。

**Tech Stack:** HarmonyOS SDK、ArkTS、ArkUI、NetworkKit、MediaLibraryKit、CameraKit、BackgroundTasksKit、现有 Node/SQLite。

## 任务与验收

- [x] 环境：已检查 DevEco/SDK/ohpm/hvigor/hdc，工具均缺失；官方下载需要账号登录。不把普通 TypeScript 编译当作 ArkTS 编译。
- [ ] 后台（独占 server/app.mjs、tests/native.test.mjs）：新增原生注册登录返回 `{data:{user,accessToken,expiresAt}}`；requireAuth 根据 Bearer 摘要找 session，非法 header 不回退 Cookie；测试注销、过期、账号隔离和网页兼容。命令 `node --test tests/native.test.mjs`。
- [ ] 提醒 API：返回未来七天最早三十条 `{key,kind,title,body,at,medicationId,date,time}`，同时返回 total/hasMore/generatedAt/timeZone；测试跳过终态、跨午夜延后、过期安全、时区和截断。
- [ ] 工程：创建 harmony/ 下 build-profile、oh-package、hvigor 配置、AppScope、entry 模块和资源；不提交签名/SDK绝对路径/构建目录。
- [ ] 客户端：类型化 API 封装、内存会话、服务器设置、真实注册登录、今日/药箱/历史、药品编辑确认、拍照/相册识别、系统代理提醒和失败状态展示。
- [ ] 集成：核对客户端字段和服务端 DTO、权限与生命周期；运行 `npm test`、`npm run build`、`npm run test:e2e`；检查实际 SDK 后执行 ohpm install 和 hvigor assembleHap；没有工具时记录原始阻塞证据。
- [ ] 交付：更新 harmony/README.md 与主 README；记下构建产物或未完成编译的实际原因，以及开发者签名与上架的唯一下一步。

## 执行结果

后台、客户端、设备服务、工程配置和文档均已写入。29 项逻辑/API测试、网站构建、4 项网站E2E通过。服务层另通过官方 API12 声明类型核对；HAP 构建尚被缺失 SDK 阻塞，集成验收不标为完成。完整边界见 `docs/harmony-verification.md`。
