# 鸿蒙端开发验证记录

日期：2026-09-06。工程位于 `harmony/`，应用标识 `com.moxing1616.medication`。

## 已执行

| 验证 | 结果 | 边界 |
| --- | --- | --- |
| `npm test` | 29/29 通过 | 后台及客户端逻辑；设备接口使用替身 |
| `npm run build` | 通过 | TypeScript + Vite 网站构建，不是鸿蒙 HAP |
| `npm run test:e2e` | 4/4 通过 | 桌面、平板、手机网站回归，不是原生设备 UI |
| API/DeviceServices 严格 TypeScript + 官方 API12 d.ts | 通过 | 只核对服务层签名，不能替代 ArkTS 编译 |
| `powershell -NoProfile -ExecutionPolicy Bypass -File harmony/build.ps1` | 工具链检查失败并明确退出 | 没有 DevEco Studio，未执行 HAP 构建 |

客户端 HTTP 适配器通过测试连接真实 Express/SQLite 内存实例，完成注册、识别返回、人工确认后保存药品、查询今日、记录服药、读取历史及注销。识别调用使用明确的测试替身，未发送真实照片至外部 AI。

提醒逻辑覆盖排序/30条限制、设备绝对时刻、部分发布失败清理、退出作废在途同步；原生认证覆盖 token 摘要存储、网页Cookie与Bearer互相不能冒充、401失效、退出与账号隔离。夏令时覆盖纽约和柏林春季顺延、秋季首次发生。

## 编译阻塞证据

本机 PATH 与常见安装目录中未发现 DevEco Studio、HarmonyOS SDK、ohpm、hvigor、hdc、JDK。当前官方[下载中心](https://developer.huawei.com/consumer/cn/download/)的新工具元数据接口匿名访问返回 401；浏览器打开该页面会跳转到华为账号登录。历史页可下载的 2023 Command Line Tools 不能作为 API12 工具链使用。

因此尚无可安装或可上架的 HAP 产物。下一步是登录官方开发者账号取得 Windows DevEco Studio，然后完成工具安装、实际编译、签名及真机数据流验证。

## 待真实环境核验

ArkUI 页面编译和渲染、系统相机/相册、通知授权拒绝与恢复、App 退出后代理提醒、重启与时区变化、真实 AI 识别、正式 HTTPS 服务、发布签名及市场审核均未验证。鸿蒙 Push Kit 尚未接入，当前只使用本地系统代理提醒；其他端修改要打开本 App 后才能同步到设备。
