# 服药提醒智能体

手机和电脑都可访问的响应式服药管理网站。React + TypeScript 前端、Express API、SQLite 持久化和 Web Push 提醒，部署时由一个 Node 服务运行。

## 本地使用

已安装依赖并构建时，双击 **启动应用.cmd**，打开 **http://localhost:3001**。首次进入显示明确标注的示例空间，点击“登录 / 注册”建立真实账户；示例药品不会导入你的账户。

开发需要 Node.js **22.13 或更新版本**：

```powershell
cd E:\日常聊天\yongyaotixing
npm install
npm run dev
```

开发前端 http://localhost:5173，API http://localhost:3001，Vite 已配置同源代理。

正式构建并在本机运行：

```powershell
npm run build
npm start
```

数据保存在 `data/medications.sqlite`，VAPID 密钥保存在 `data/keys.json`。关闭服务会暂停后台提醒；重新启动会继续读取已有账户和记录。不要删除 `data` 目录。数据库备份请停服后备份整个 `data`，或使用 SQLite 在线备份方式，不要仅在运行时复制主数据库文件而遗漏 WAL。

## 已实现

- 邮箱 + 密码注册、登录、退出；密码 scrypt 散列，HttpOnly / SameSite 会话和账户隔离。
- 相机拍摄、图片选择、图片预览；JPEG / PNG / WebP，最大 8 MB。
- 服务端 AI 识别名称、规格、有效期及说明文字。真实接口适配器与错误处理已实现，密钥不进入前端。
- 识别结果可修改，核对后填写用量、每日 1–8 个时间、开始/结束日期与备注；明确确认后才保存药品和提醒。
- 今日列表、周历切换、待服用/已处理筛选、已服用/延后15分钟/跳过。
- 药箱搜索、编辑、归档；归档停止后续提醒，历史记录保留。历史药名和用量采用记录时快照。
- 服药记录时间范围筛选、状态筛选和 CSV 导出。
- 药品到期前 30 天起每日提醒；已过期继续提醒核查，过期药品不发送催服剂量文案。
- Web Push、PWA 清单、Service Worker、设备通知开关、测试通知、页面内到点提示。
- 根据账户注册时区计算计划；跨午夜延后、夏令时缺失时间顺延、重复时间只发送一次。

提醒只执行用户确认的计划，不生成处方、诊断、剂量、补服或停药建议。已服用与已跳过是终态，重复提交同一状态不会重复记账；延后从点击时刻起算，未到延后时点时重复点击保持幂等。

## 接通真实 AI

将 `.env.example` 复制为 `.env`，在本机填写：

```dotenv
OPENAI_API_KEY=你的服务端API密钥
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

支持兼容 OpenAI Chat Completions 的视觉模型服务，服务需支持图片输入和 `response_format: json_object`。修改后重启服务。未配置时会明确显示 AI 未连接并保留手动填写，不返回模拟识别结果。

点击“AI 识别药品”前会告知照片发送至所配置的 AI 服务。应用本身不保存药品照片，只保存用户确认后的文字；外部服务如何处理图片依其账户配置及条款。无法辨认的字段保持空值，只有年月的有效期不自动猜测日期。

## 手机访问与后台提醒

电脑与手机在同一局域网时，可用 `http://电脑局域网IP:3001` 浏览和操作药箱；普通 HTTP 局域网地址不能保证相机、PWA 和通知能力。完整的手机使用需要将本项目部署到 HTTPS 域名。

Web 网站无法像原生闹钟一样在关闭页面后精确定时执行本地任务。因此本项目采用 **系统 Web Push + 页面内到点提示**：服务端每 30 秒扫描，向已授权的设备订阅发送提醒。通知成功去重，失效订阅移除，退出当前账户时撤销当前设备订阅。

- Android / 桌面：支持 Web Push 的浏览器中打开设置，开启通知。
- iPhone / iPad：用 Safari 访问 HTTPS 网站，添加到主屏幕，再从主屏幕打开并开启通知。
- 网络中断、关机、省电、浏览器限制或推送服务不可达均可能影响送达。不是离线闹钟，不能承诺严格准时送达。
- 系统通知正文可能包含药品名与用量；注意设备锁屏通知的显示设置。

技术依据：[MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)、[MDN Service Worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)、[WebKit iOS Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)、[OpenAI 图片输入](https://developers.openai.com/api/docs/guides/images-vision)。

## 部署

本项目适合一台常驻 Node 服务配持久磁盘。不要直接放到无持久卷的 Serverless 环境：SQLite 和定时推送均需要持久化与常驻进程。

1. `npm ci && npm run build`。
2. 配置 `.env`：`NODE_ENV=production`、`APP_ORIGIN=https://你的域名`、AI 密钥及真实 `VAPID_SUBJECT` 联系邮箱。
3. 使用反向代理提供 HTTPS，将请求转发到 3001。生产 Cookie 使用 Secure，只有 HTTPS 环境才可正常认证。
4. 用进程管理器维持 `npm start`，保留 `data` 持久目录。当前设计只运行一个服务实例。

可选 Docker：

```sh
docker build -t medication-reminder .
docker run -d --name medication-reminder --restart unless-stopped \
  -p 127.0.0.1:3001:3001 --env-file .env \
  -v medication-data:/app/data medication-reminder
```

Docker 路径尚未在当前 Windows 环境实际构建验证。反向代理应与 APP_ORIGIN 一致；默认信任前方一层代理。

## 验证与已知边界

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

浏览器测试使用本机 Edge（`channel: msedge`），启动独立端口 3401、内存数据库，不往真实账户数据库写测试数据。其他环境可改 Playwright 配置为已安装的 Chromium。截图保存在 `docs/preview-1440.png` 和 `docs/preview-390.png`。

已测范围见 [验收记录](docs/verification.md)。真实 AI 调用与实体手机系统通知送达依赖实际密钥、HTTPS 和设备授权，不能以模拟测试代替验收。

MVP 的邮箱是登录标识，尚未提供邮箱验证邮件、密码找回或多因素认证。日期计划目前为“每日固定时间”，不含按周、隔日、按需用药或复杂疗程。历史页最多查询一年范围。服务端身份和请求限流在单进程中执行。

## 主要文件

| 位置 | 职责 |
| --- | --- |
| `src/App.tsx` | 账户状态、导航、API 接线和确认操作 |
| `src/Dashboard.tsx` | 今日服药、周历、进度和临期提醒 |
| `src/MedicationForm.tsx` | 拍照与人工核对向导 |
| `src/OtherPages.tsx` | 药箱、记录、设置 |
| `src/usePush.ts` | 设备权限及订阅开关 |
| `server/app.mjs` | SQLite、API、会话、药品和推送调度 |
| `server/ai.mjs` | 真实 AI 接口与严格字段提取 |
| `public/sw.js` | 系统通知显示与点击 |
| `tests/` | 后端、AI 适配器和浏览器端到端测试 |
