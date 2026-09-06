# 服药提醒智能体 · 鸿蒙原生客户端

ArkTS + ArkUI Stage 工程，目标 HarmonyOS 5.0.0 / API 12 起的手机和平板。共用本仓库 Express 后台、邮箱账号、药品和服药记录。

**当前状态：客户端源码、后台适配与逻辑测试已完成；本机没有 DevEco Studio / HarmonyOS SDK，尚未完成 ArkTS 编译、签名、安装及真机验收，不是已上线的 App。**

## 已实现的数据流

- 服务器设置 → 邮箱注册/登录 → 今日列表、药箱、最近 30 天服药记录。
- 系统相机/相册 → 本地预览 → 单独同意发送 → 压缩 JPEG → 真实后台 AI 接口 → 人工确认 → 保存药品与服药时间。
- 手动新增/编辑/归档，已服用/延后 15 分钟/跳过 → 后台持久化 → 刷新列表与设备提醒。
- 鸿蒙通知授权 → 从后台取得未来 7 天最早 30 条计划 → 系统代理提醒。部分发布失败时清理整批，不报告成功。

## 开发与安装

1. 从[华为官方下载中心](https://developer.huawei.com/consumer/cn/download/)登录下载 Windows DevEco Studio，完成配套 HarmonyOS SDK 安装。旧版 2023 Command Line Tools 不适用于此 API 12 工程。
2. 在 DevEco Studio 选择 Open，打开本目录 `harmony`，同步工程。工程不包含签名密钥；实际开发者账号下的签名通过 IDE 配置，不能将签名文件或密码提交到公开仓库。
3. 在项目根目录运行 `npm install`、`npm run build`、`npm start` 启动后台。默认端口 3001。
4. 用 IDE 选择鸿蒙模拟器或已开启开发者调试的真机运行。调试版 App 中填写电脑的局域网 IP，例如 `http://192.168.1.10:3001`；手机和电脑须互通且防火墙允许该端口。手机的 `localhost` 是手机自己。
5. 正式版本只能使用 HTTPS 服务器。当前仓库没有预设线上 API 域名；GitHub 公开不等于后端已部署。

安装 DevEco Studio 后也可以在 PowerShell 中执行：

```powershell
cd harmony
.\build.ps1 -DevEcoHome 'C:\Program Files\Huawei\DevEco Studio'
```

脚本使用 IDE 自带的 Node/JDK/ohpm/hvigor，仅修改当前进程环境，不写全局环境变量。未配置发布签名时，构建产物不能作为可上架安装包；具体产物以脚本与 IDE 的真实输出为准。

## 提醒的实际边界

- 用户授权后，由系统代理已经登记的日历提醒，App 退出后仍可触发；不使用网页 Web Push 冒充鸿蒙推送。
- 第三方应用最多 30 条有效代理提醒，因此只同步未来 7 天中最早 30 条，设置页显示覆盖时间。后续提醒需要再打开 App 同步。
- 当前没有接入需要开发者凭据的华为 Push Kit。App 关闭时，网站上的改动不能立刻撤销本机已登记提醒；重新进入前台或手动刷新才会更新。多设备不能宣称实时撤销。
- 网络失败不会把服药操作标为成功。操作已保存但后续刷新/提醒失败时会显示错误，可以刷新核对；服务端已服用/跳过终态及延后操作保持幂等。
- 关闭通知不是“已服用”；通知按钮仅关闭，点击通知进入 App 核对并记录。过期药只产生有效期警示，不产生催服提醒。
- 系统时间、设备通知开关、省电策略和设备状态可能影响提醒；正式发布前必须真机验证。日历提醒按设备本地时间登记；旅行变更设备时区后需打开 App 重新同步。

## 账号与隐私

原生注册/登录使用 `/api/native/auth/register` 和 `/api/native/auth/login`，返回随机 Bearer token；服务端只保存其 SHA-256 摘要，和网页 Cookie 分开识别。原生端复用 `/api/auth/me`、`/api/auth/logout` 及业务接口。

客户端只将服务器地址和提醒开关写入 Preferences；令牌仅在内存中，密码不持久化，冷启动需要重新登录。退出撤销服务器会话并清理本机提醒。选择照片不自动上传，也不申请整库相册读取权限。

正式上架仍需补充实际运营主体、隐私政策/联系与数据删除渠道，并根据最终服务配置如实说明 AI 服务及数据处理方式；App 内当前说明是开发版功能说明，不能替代最终上架材料。

本项目遵循根目录 [LICENSE](../LICENSE) 和 [NOTICE](../NOTICE)，源码公开、非商业许可。

## 验证

根目录 `npm test` 包含原生会话/权限/时区/提醒计划测试，以及鸿蒙客户端 HTTP、服务器地址策略、代理提醒并发取消与失败清理逻辑测试。设备模块通过替身执行：这些测试不等于 ArkTS 构建或真机验证。

真机验收需要完成：邮箱登录 → 手动新增 → 拍照识别并核对 → 服药三种状态 → 网站读取同一记录 → 编辑/归档后旧提醒取消 → 授权拒绝 → 杀进程提醒 → 断网/退出/账号切换 → 重启/设备时区变化。

官方依据：[鸿蒙文档中心](https://developer.huawei.com/consumer/cn/doc/)、[代理提醒](https://github.com/openharmony/docs/blob/OpenHarmony-5.0.0-Release/zh-cn/application-dev/task-management/agent-powered-reminder.md)、[API 12 接口定义](https://github.com/openharmony/interface_sdk-js/tree/OpenHarmony-5.0.0-Release)、[华为应用分发](https://developer.huawei.com/consumer/cn/appgallery/devstart/)。
