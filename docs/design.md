# 服药提醒智能体 · MVP 设计与实施计划

目标：邮箱账户 → 拍照识别 → 人工确认 → 药品与每日时间 → 今日列表 → 已服用、延后、跳过 → 历史记录、过期提醒。

## 已确定的技术路线
React + TypeScript + Vite，Express + Node 22 内置 SQLite。单服务生产部署，API 和网站同源，SQLite 持久卷；无需额外数据库服务。Phosphor 图标，原生 CSS，浅米白背景与鼠尾草绿主色。桌面侧边栏、手机底部导航。

用户已授权直接开发，技术选型由开发者完成。实现计划与设计在本文件一并维护，不增加确认流程。

## 数据与 API 合同
所有响应 `{data: ...}`；错误 `{error: "中文可读错误"}`。HttpOnly SameSite Cookie 会话，邮箱规范化，scrypt 密码散列；修改请求校验来源。所有药品、记录、推送订阅按当前账户隔离。

User: `{id,email,name,timeZone}`。注册 POST `/api/auth/register` `{email,password,name,timeZone}`；登录 POST `/api/auth/login` `{email,password}`；GET `/api/auth/me`；POST `/api/auth/logout`。

Medication: `{id,name,specification,expiryDate,instructions,dose,times:string[],startDate,endDate,notes,color,active,createdAt}`。日期为 YYYY-MM-DD，expiryDate/endDate 未填写时空字符串。dose 为用户自行填写的文字（例如每次1片），times 每日时间 HH:mm，1–8 个，升序去重。color 为 sage / amber / blue / rose。开始日后每天生成服药事件；截止日包含当天。
GET `/api/medications` → Medication[]；POST `/api/medications`、PUT `/api/medications/:id` → Medication；DELETE `/api/medications/:id` 为归档，保留记录。

GET `/api/today?date=YYYY-MM-DD` → Occurrence[]。Occurrence: `{id,medicationId,date,time,scheduledAt,status,snoozedUntil,medication}`；status=pending/taken/snoozed/skipped，scheduledAt 与 snoozedUntil 为 ISO UTC。今天按账户时区生成。
POST `/api/records` `{medicationId,date,time,status}`，status=taken/skipped/snoozed，延后固定15分钟。不得记录未来的服药日，单事件幂等更新，终态不重复服用。
GET `/api/records?from=YYYY-MM-DD&to=YYYY-MM-DD` → `{id,medicationId,medicationName,dose,date,time,status,recordedAt,snoozedUntil}`[]。

GET `/api/config` → `{aiEnabled,pushEnabled,vapidPublicKey}`。
POST `/api/recognize` `{image:base64DataUrl}` → `{name,specification,expiryDate,instructions,warnings:string[]}`，只读图片文字，未知值留空。必须登录，8MB 限制。没有 AI 密钥时清楚报错并可手动添加，不返回虚假识别。
POST `/api/push/subscribe` PushSubscription JSON；POST `/api/push/unsubscribe` `{endpoint}`；POST `/api/push/test`。

## 推送与医疗边界
服务端每30秒扫描并通过 Web Push 推送每日到点及延后事件、30天内过期提醒。成功发送去重，过期订阅清除。页面内到点横幅作为不支持推送的降级。浏览器后台不支持精确定时本地闹钟，不能承诺关机或离线送达。HTTPS 是手机推送前提，iOS 需添加到主屏幕，用户主动开启通知。
剂量及频次由用户遵照医嘱/原说明填写；AI 不提供治疗方案。照片只在识别请求内处理，不存入药柜；识别按钮提示图片发送至所配置 AI 服务。

## 实施与验收
1. 主 Agent 创建前端、PWA、配置与说明文件；后端子 Agent 仅写 server/（ai.mjs 除外）、tests/backend.test.mjs；AI 子 Agent 仅写 server/ai.mjs、tests/ai.test.mjs。
2. 后端验证注册登录、权限隔离、非法字段/日期、记录去重、跨日延后、历史保留、到期逻辑与通知去重。
3. 前端实现今日任务、我的药箱、服药记录、提醒设置；新增/编辑向导、识别预览与确认、账户弹窗、空/加载/失败状态。
4. `npm run typecheck`、`npm test`、`npm run build`；Playwright 实测注册→新增→已服用/延后/跳过→历史→刷新持久化→登出登录，以及桌面/手机无横向溢出。
5. 无实际 AI 凭证及物理手机时，不将真实识别质量和系统推送送达标记为已验收。完整记录本地已测范围与外部条件。

## 一手技术依据
- https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- https://developers.openai.com/api/docs/guides/images-vision
