# Make Your Notes（网页版）交接

> 给接手者：这是 Make Your Notes 网页版的唯一事实来源。开始任何改动前先读完这份文件，改完要回来更新它；
> 不要从聊天记录里推断项目状态，以磁盘上的文件和本文件为准。

## 一、任务与身份

- 谁：个人项目，作者 ganbeigb。使用者主要是作者本人（学生场景：课件 → 知识点复习）。
- 做什么：本机运行的网页应用。上传课件截图 → DeepSeek 逐页提取知识点 → 按自定义标准整理分类 → 思维导图 / 导出 / 备份。附带安卓「手机本地版」APK（Node 运行时 + 服务端 + 前端全部塞进 APK，不需要电脑）。
- 验收标准：双击 `启动.bat` 能在 `http://127.0.0.1:8713` 打开；手机上能用同一套界面；数据全部存本机；不依赖除 DeepSeek 之外的服务。

## 二、当前状态

- 已完成：功能完整可用，最新版本 `v3.10.23`（APK versionCode 78）。共 78 个历史版本，已全部写入 `CHANGELOG.md` 并打上同名 Git tag。
- 进行中：无。远端 `ganbeigb/make-your-notes` 已建（public），main 与 78 个 tag 已推送；APK 已用新图标重出。
- 未开始 / 已放弃：曾尝试把整套应用重写为纯原生 Android（View + SQLite，仓库 `make-your-notes-native`），因 UI 与稳定性问题在第 80 轮后停手，**用户已决定回归网页版**，原生版不再推进。

## 三、已定决策

1. 技术栈保持 `Node.js 原生 http 服务 + 原生 JS 前端 + KaTeX`，不引入构建工具与框架 —— 原因：双击 .bat 就能跑，作者自己维护成本最低。
2. 数据存本机 JSON 文件（`server/data`），不引数据库 —— 原因：单用户、几千条量级，JSON 足够且方便备份。
3. AI 只走 DeepSeek（可选中转地址），识图靠同一套 OpenAI 兼容接口 —— 原因：作者只有 DeepSeek 的 Key。
4. 版本号 `x.y.z` + APK `versionCode` 单调递增，两者一起改 —— 原因：覆盖安装靠 versionCode 判断新旧。
5. 更新记录只写「用户能感知的变化」，不写实现细节 —— 原因：CHANGELOG 是给人看的，不是代码注释。
6. 图标使用作者提供的新图（青色圆角方 + 白色 M + 便签），已生成 web 与 Android 各尺寸 —— 原因：原 favicon 是内联 SVG 占位图。

## 四、未决项

- [x] ~~GitHub 远端~~ —— 已配：`https://github.com/ganbeigb/make-your-notes`（main + 78 个 tag 都已推送）。
- [x] ~~APK 新图标~~ —— 已重出：`MakeYourNotes-v3.10.23.apk`（19.9 MB，versionCode 78），已解包核对 `res/mipmap-xxxhdpi-v4/ic_launcher.png` 为新图标。
- [ ] GitHub Release 是否挂 APK —— 为什么要：APK 20 MB 未入库（`.gitignore` 排除），要发布只能挂 Release 附件。

## 五、文件清单

| 路径 | 说明 | 状态 |
|---|---|---|
| `D:\dshwork\课件知识点助手\public\app.js` | 前端主逻辑（视图、AI 调用、导出） | 现行 |
| `D:\dshwork\课件知识点助手\public\draw.js` | 画图板 / 电路画布 | 现行 |
| `D:\dshwork\课件知识点助手\public\symbols.js` | 41 个电路元件定义 | 现行 |
| `D:\dshwork\课件知识点助手\public\styles.css` | 全部样式与设计变量 | 现行 |
| `D:\dshwork\课件知识点助手\public\index.html` | 页面骨架 + 图标 link | 已改（新图标） |
| `D:\dshwork\课件知识点助手\public\manifest.webmanifest` | PWA 图标与主题色 | 新增 |
| `D:\dshwork\课件知识点助手\public\icon-192.png` / `icon-512.png` / `favicon*.png` / `apple-touch-icon.png` | 新图标各尺寸 | 新增 |
| `D:\dshwork\课件知识点助手\assets\icon-512.png` | 图标原件（512） | 新增 |
| `D:\dshwork\课件知识点助手\server\server.js` | 后端：静态服务、上传、AI 代理、备份 | 现行 |
| `D:\dshwork\课件知识点助手\android\` | 手机本地版外壳与打包脚本 | 现行 |
| `D:\dshwork\课件知识点助手\README.md` | 使用说明（更新记录已改为摘要 + 指向 CHANGELOG） | 已改 |
| `D:\dshwork\课件知识点助手\CHANGELOG.md` | 78 个版本的完整更新日志 | 新增 |
| `D:\dshwork\课件知识点助手\MakeYourNotes-v3.10.23.apk` | 手机本地版安装包（新图标，19.9 MB，未入库） | 已重出 |
| `D:\dshwork\课件知识点助手\handoff\web-version-handoff.md` | 本文件 | 新增 |

## 六、约束与红线

- 格式：中文注释与文案；不改动 `public/vendor/` 里的第三方 KaTeX。
- 不可编造：CHANGELOG 里每条必须来自 README 原有记录，不得凭印象新增版本。
- 用户拒绝过：继续推进原生 Android 版本（`make-your-notes-native`），不要再主动提起或继续开发。
- 数据：`server/data` 与图片是用户真实数据，本地测试不要覆盖。

## 七、下一步

1. 若用户要继续开发：先 `git log --oneline -5` 与 `git tag -l | tail -3` 确认版本位置，再在 `public/` 改，改完更新 `CHANGELOG.md` 与本文第二节。
2. 需要重新出 APK 时：`cd android` → `powershell -ExecutionPolicy Bypass -File build.ps1`，产物在 `android/dist/`。
3. 远端已是 `origin = https://github.com/ganbeigb/make-your-notes.git`，直接 `git push` + `git push --tags`。
4. 每轮结束：更新本文件「二、当前状态」与「七、下一步」，提交时一起 commit。
