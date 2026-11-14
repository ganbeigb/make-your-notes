# 给 AI 助手的项目约定

这个仓库是 **Make Your Notes 网页版**。任何对话开始动手之前，按下面顺序做：

## 一、开始任何工作前

1. 先读 **`handoff/web-version-handoff.md`** —— 任务目标、已定决策、未决项、下一步都在里面，它是唯一事实来源。
2. 再看 **`CHANGELOG.md`** 最上面几条，确认当前版本号。
3. 用 `git log --oneline -5` 和 `git tag -l | tail -5` 核对磁盘状态与文档是否一致；不一致时以磁盘为准，并在回复里说明差异。
4. 不要从聊天记录推断项目状态，也不要重做 `handoff` 里已标记「已完成」的事。

## 二、改代码时的规矩

- 前端在 `public/`（`app.js` 视图与逻辑、`draw.js` 画板、`styles.css` 样式、`index.html` 骨架），后端在 `server/server.js`。
- 不引入构建工具、框架或数据库；保持「双击 `启动.bat` 就能跑」。
- 不修改 `public/vendor/` 里的第三方资源。
- 不动 `server/data/` 与用户图片（真实数据）。

## 三、每次改动结束前

1. 在 `CHANGELOG.md` **顶部**加一条新版本（版本号 `x.y.z` 递增；出了 APK 就同时给 `versionCode`），写明用户能感知的变化。
2. 同步更新 `handoff/web-version-handoff.md` 的「二、当前状态」和「七、下一步」。
3. `AndroidManifest.xml` 与 `android/build.ps1` 里的 versionCode / versionName 要一起改（如果要出 APK）。
4. Git：`git add -A` → 提交信息写清「改了什么」→ 打同名 tag（`git tag -a vX.Y.Z -m "一句话说明"`）。
5. 如果远程可用再 push；没有 remote 时只做本地提交，并在回复里说明。

## 四、回复风格

- 中文，直接给结论和操作步骤，不复述需求。
- 改动要说清「改了什么文件、为什么改」，不夸大验证范围：没有真机/浏览器实测的就说明只是静态改动。
