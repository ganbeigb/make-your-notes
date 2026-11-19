# -*- coding: utf-8 -*-
"""生成《Make Your Notes 项目说明手册》.docx（随后导出 PDF）"""
import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

ROOT = r"D:\dshwork\课件知识点助手"
OUT_DIR = os.path.join(ROOT, "docs")
os.makedirs(OUT_DIR, exist_ok=True)
OUT = os.path.join(OUT_DIR, "项目说明手册-MakeYourNotes.docx")

CN = "微软雅黑"
MONO = "Consolas"
ACCENT = RGBColor(0x2F, 0x5D, 0x4B)
ACCENT2 = RGBColor(0x6F, 0x8F, 0x7C)
INK = RGBColor(0x1F, 0x24, 0x21)
MUTED = RGBColor(0x66, 0x6F, 0x69)
CODEBG = "F4F1EA"


def cn(run, font=CN):
    run.font.name = font
    run._element.rPr.rFonts.set(qn("w:eastAsia"), font)


def shade(paragraph, color=CODEBG):
    pPr = paragraph._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), color)
    pPr.append(shd)


def style_doc(doc):
    st = doc.styles["Normal"]
    st.font.name = CN
    st.font.size = Pt(10)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), CN)
    st.paragraph_format.line_spacing = 1.4
    st.paragraph_format.space_after = Pt(3)
    for lvl, size in ((1, 15), (2, 11.5), (3, 10.5)):
        h = doc.styles["Heading %d" % lvl]
        h.font.name = CN
        h.font.size = Pt(size)
        h.font.color.rgb = ACCENT
        h.font.bold = True
        h.element.rPr.rFonts.set(qn("w:eastAsia"), CN)
        h.paragraph_format.space_before = Pt(13 if lvl == 1 else 9)
        h.paragraph_format.space_after = Pt(5)


def p(doc, text, size=10, color=INK, bold=False, align=None, indent=True, after=3, before=0):
    par = doc.add_paragraph()
    if align is not None:
        par.alignment = align
    if indent:
        par.paragraph_format.first_line_indent = Pt(size * 2)
    par.paragraph_format.space_after = Pt(after)
    par.paragraph_format.space_before = Pt(before)
    r = par.add_run(text)
    r.font.size = Pt(size)
    r.font.color.rgb = color
    r.bold = bold
    cn(r)
    return par


def code(doc, lines, size=8.2):
    """等宽代码/树状图块（ASCII 对齐，中文不进代码块）"""
    for line in lines:
        par = doc.add_paragraph()
        par.paragraph_format.space_after = Pt(0)
        par.paragraph_format.space_before = Pt(0)
        par.paragraph_format.line_spacing = 1.12
        par.paragraph_format.left_indent = Cm(0.35)
        shade(par)
        r = par.add_run(line if line else " ")
        r.font.name = MONO
        r._element.rPr.rFonts.set(qn("w:eastAsia"), MONO)
        r.font.size = Pt(size)
        r.font.color.rgb = INK
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def bullet(doc, text, size=10):
    par = doc.add_paragraph(style="List Bullet")
    par.paragraph_format.space_after = Pt(2)
    r = par.add_run(text)
    r.font.size = Pt(size)
    r.font.color.rgb = INK
    cn(r)


def table(doc, rows, widths, size=8.6, header=True):
    t = doc.add_table(rows=0, cols=len(rows[0]))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    t._tbl.tblPr.append(layout)
    # 显式写 tblGrid 列宽，否则 LibreOffice 会按内容自动分配
    grid = t._tbl.find(qn("w:tblGrid"))
    if grid is not None:
        for gc, wd in zip(grid.findall(qn("w:gridCol")), widths):
            gc.set(qn("w:w"), str(int(Cm(wd).twips)))
    for i, row in enumerate(rows):
        cells = t.add_row().cells
        for j, val in enumerate(row):
            cells[j].text = ""
            par = cells[j].paragraphs[0]
            par.paragraph_format.space_after = Pt(1)
            par.paragraph_format.line_spacing = 1.15
            r = par.add_run(str(val))
            r.font.size = Pt(size)
            r.bold = header and i == 0
            r.font.color.rgb = ACCENT if (header and i == 0) else INK
            cn(r)
    for row in t.rows:
        for j, wd in enumerate(widths):
            row.cells[j].width = Cm(wd)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


doc = Document()
style_doc(doc)
sec = doc.sections[0]
sec.left_margin = sec.right_margin = Cm(1.9)
sec.top_margin = Cm(1.8)
sec.bottom_margin = Cm(1.8)

# ============ 封面 ============
for _ in range(4):
    doc.add_paragraph()

t = doc.add_paragraph()
t.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = t.add_run("Make Your Notes")
r.font.size = Pt(30)
r.bold = True
r.font.color.rgb = ACCENT
cn(r)

t = doc.add_paragraph()
t.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = t.add_run("项目说明手册")
r.font.size = Pt(20)
r.font.color.rgb = INK
cn(r)

t = doc.add_paragraph()
t.alignment = WD_ALIGN_PARAGRAPH.CENTER
t.paragraph_format.space_before = Pt(6)
r = t.add_run("结构 · 模块 · 数据 · 流程 · 核对清单")
r.font.size = Pt(11)
r.font.color.rgb = MUTED
cn(r)

doc.add_paragraph()
table(doc, [
    ["项目", "内容"],
    ["当前版本", "v2.9.10（APK versionCode 83）"],
    ["作品形态", "本机网页应用（Windows 一键启动）+ 手机本地版 APK（Android 8.0+，arm64）"],
    ["代码仓库", "https://github.com/ganbeigb/make-your-notes"],
    ["技术栈", "Node.js 原生 http 服务 + 原生 JavaScript 前端 + KaTeX；无框架、无构建工具、无数据库"],
    ["手册版本", "2026-11 第 1 版（随项目结构变化更新）"],
], widths=[3.0, 12.6], size=9)

p(doc, "本手册用于逐项核对项目结构：第二节给出完整目录树，第三节按编号解释每个文件/目录的职责与核对要点，"
       "第四、五节说明一次请求如何流转与数据如何存放，第八节是可以直接打勾的核对清单。", indent=True)

toc_head = doc.add_heading("本手册目录", level=2)
toc_head.paragraph_format.page_break_before = True
toc_rows = [
    ["一", "整体结构总览", "四层结构与各自规模"],
    ["二", "目录树（图示）", "上下两张图示 + 矢量源 SVG"],
    ["三", "逐项职责说明", "按 #1–#24 编号逐一解释"],
    ["四", "一次操作怎么走", "8 条主要操作对应的接口与落点"],
    ["五", "数据模型", "data/db.json 的 10 个顶层键"],
    ["六", "启动、部署与打包", "电脑端、手机 APK、发版约定"],
    ["七", "想改某处该动哪个文件", "速查表"],
    ["八", "核对清单", "12 项可打勾的验证步骤"],
    ["九", "常见问题", "6 类典型故障与处理"],
]
table(doc, toc_rows, widths=[1.4, 5.4, 8.8], size=9)

# ============ 一、总览 ============
doc.add_heading("一、整体结构总览", level=1)
p(doc, "项目是一个「前端 + 后端 + 手机外壳 + 数据」四层结构，全部放在一个目录里，没有编译步骤："
       "双击 启动.bat 起 Node 服务，浏览器访问本机端口即是应用；手机版把这套代码与 Node 运行时一起打进 APK。")
table(doc, [
    ["层", "目录", "作用", "规模"],
    ["前端", "public/", "界面、交互、画板、公式渲染", "app.js 3361 行 + draw.js 2316 行 + CSS 1153 行"],
    ["后端", "server/", "HTTP 接口、AI 调用、数据读写、导出与备份", "server.js 2406 行 + deepseek.js 1028 行"],
    ["手机外壳", "android/", "WebView + 内嵌 Node 运行时，打包成 APK", "Java 583 行 + C++ 104 行 + build.ps1 187 行"],
    ["数据", "data/", "全部业务数据与图片（运行时生成）", "db.json + images/"],
    ["文档", "docs/ · handoff/ · 截图/", "参赛文档、上下文交接、界面截图", "—"],
], widths=[1.9, 3.6, 6.2, 5.4])


doc.add_heading("二、目录树（图示）", level=1)
p(doc, "下面两张图是同一棵树的上下两部分：矩形是目录或文件，浅绿为目录、米黄为关键文件、白底为普通文件，"
       "右侧标注规模与职责。矢量源文件为 docs/目录树.svg，位图为 docs/tree-1.png 与 tree-2.png。")

_pic = doc.add_picture(os.path.join(OUT_DIR, "tree-1.png"), width=Cm(17.2))
doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
_cap = doc.add_paragraph()
_cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
_r = _cap.add_run("图 1  目录树（一）：项目根 · public/ 前端 · server/ 后端")
_r.font.size = Pt(8.5)
_r.font.color.rgb = MUTED
cn(_r)

_pic2 = doc.add_picture(os.path.join(OUT_DIR, "tree-2.png"), width=Cm(17.2))
doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
_cap2 = doc.add_paragraph()
_cap2.alignment = WD_ALIGN_PARAGRAPH.CENTER
_r2 = _cap2.add_run("图 2  目录树（二）：android/ 手机外壳 · data/ 数据 · docs/ 文档 · 根目录文件")
_r2.font.size = Pt(8.5)
_r2.font.color.rgb = MUTED
cn(_r2)

# ============ 三、逐项说明 ============
doc.add_heading("三、逐项职责说明（按编号核对）", level=1)

doc.add_heading("3.1 启动与运行", level=2)
table(doc, [
    ["#", "文件", "职责", "核对要点"],
    ["1", "启动.bat", "检测 Node 18+，前台运行 server/server.js", "缺 Node 会给出提示并退出；窗口关闭即停止"],
    ["2", "后台启动.vbs", "静默启动，无命令行窗口", "任务管理器可见 node.exe"],
    ["3", "停止.bat", "读 data/server.pid 结束进程", "执行后 8713 端口释放"],
    ["4", "安装/卸载开机自启.bat", "写入/删除启动项", "重启后可自动拉起"],
], widths=[0.9, 4.0, 6.2, 6.0])

doc.add_heading("3.2 后端 server/", level=2)
table(doc, [
    ["#", "文件", "职责", "关键位置 / 核对要点"],
    ["5", "server.js", "全部 HTTP 处理：静态资源、约 20 个 /api 接口、导出、备份恢复、局域网分享（二维码 + 令牌）",
     "路由集中在文件后段 serve() 的判断链；isLoopback / allowRequest 做本机与局域网鉴权；cleanSvg / cleanDraw 清洗模型输出"],
    ["6", "deepseek.js", "模型调用层：extractSlide 识别、organize 分类、refine 改写、compose 起草、verifyExtraction 校对、summarizeDeck 本节总结、digestSlide 本页汇总、extensionTitles 拓展标题",
     "10 段系统提示词都在文件开头附近（EXTRACT_SYSTEM、ORGANIZE_SYSTEM 等）；含限流退避、参数降级、token 计费常量 PRICE"],
    ["7", "store.js", "数据层：init / normalize / persist / get / save；增删科目、课件、页面；用量累计；图片删除", "所有读写都指向 data/db.json，写入前做结构归一化"],
    ["8", "zip.js", "不依赖第三方库的 zip 打包与解包", "备份导出、备份恢复都走这里"],
    ["9", "secret.js", "API Key 与局域网分享令牌的加密与校验", "明文不落盘，只有密文与校验值"],
], widths=[0.9, 2.8, 7.0, 6.4])

doc.add_heading("3.3 前端 public/", level=2)
table(doc, [
    ["#", "文件", "职责", "关键位置 / 核对要点"],
    ["10", "index.html", "四个容器骨架 + 引入 KaTeX、样式、图标、PWA 清单", "36 行；所有逻辑在 app.js"],
    ["11", "app.js", "视图与交互：renderSidebar / renderTopbar / renderViewbar / deckView / itemsView / categoriesView；后台识别进度轮询（ensurePolling、updateQueueBar）；公式渲染 renderMath；导出与设置弹窗",
     "3361 行，没有任何组件框架；api() 是唯一请求出口"],
    ["12", "draw.js", "画板引擎：画笔、图形（SHAPES）、元件放置、连线（直角 + A* 绕障）、引脚吸附、自定义芯片、框选/组合/缩放旋转、撤销重做",
     "2316 行；超时/避障逻辑与 symbols.js 的引脚表配合"],
    ["13", "symbols.js", "41 个元件符号（SVG <g id=\"sym-…\">）+ SYMBOL_PINS 引脚表", "约定两端器件引脚在 (-20,0) 与 (20,0)"],
    ["14", "styles.css", "配色变量、卡片、按钮、手机端重排", "1153 行；换主题主要改文件顶部变量"],
    ["15", "vendor/", "KaTeX 与二维码库", "第三方资源，不修改"],
], widths=[0.9, 2.8, 7.4, 6.0])

doc.add_heading("3.4 手机外壳 android/", level=2)
table(doc, [
    ["#", "文件", "职责", "关键位置 / 核对要点"],
    ["16", "MainActivity.java", "WebView 外壳：随机端口 → 解压 assets → 起 Node → 轮询 /healthz → 切界面；启动动画；返回键、文件选择、下载处理",
     "showSplash() 是启动动画；showLogScreen() 只在失败时调用（解压失败 / 缺入口 / Node 异常 / 60 秒超时）"],
    ["17", "NodeRunner.java + jni/node_bridge.cpp", "JNI 调 node::Start 启动内嵌 Node 运行时", "arm64-v8a 专用；.so 由 NDK 交叉编译"],
    ["18", "build.ps1", "打包流水线：打 payload → aapt2 → javac → d8 → 塞 .so → zipalign → apksigner", "产物名跟随 $VersionName；签名沿用 coursenotes.keystore"],
    ["19", "AndroidManifest.xml", "权限、主题、版本号", "当前 versionCode 83 / versionName 2.9.10"],
], widths=[0.9, 3.4, 7.2, 5.6])

doc.add_heading("3.5 数据与文档", level=2)
table(doc, [
    ["#", "位置", "内容"],
    ["20", "data/db.json", "顶层键：version、createdAt、settings、subjects、decks、slides、items、categories、usage、usageDaily"],
    ["21", "data/images/", "课件原图与 AI 生成配图；备份时随 db.json 一起打包"],
    ["22", "CHANGELOG.md", "79 个版本、三档版本号规则、「旧编号 → 新编号」对照"],
    ["23", "handoff/web-version-handoff.md", "任务与身份、当前状态、已定决策、未决项、文件清单、红线、下一步"],
    ["24", "docs/", "参赛项目文档、本手册、以及两者的生成脚本"],
], widths=[0.9, 5.2, 10.5])

# ============ 四、流程 ============
doc.add_heading("四、一次操作怎么走", level=1)
table(doc, [
    ["操作", "请求路径", "落到哪里"],
    ["打开界面", "GET / → public/index.html；GET /api/state 拉全量状态", "server.js 静态服务 + publicState()"],
    ["上传课件", "POST /api/slides（图片 base64 或表单）", "store.js 写 db.json，图片落 data/images/"],
    ["识别一页", "POST /api/process → performExtraction", "deepseek.extractSlide 出结构化 JSON → 清洗后写 items"],
    ["自动整理", "POST /api/organize", "deepseek.organize（带科目自定义分类标准）→ 写 categories"],
    ["改写一条", "POST /api/ai/compose 或条目更新接口", "deepseek.refine / compose，旧版本保留可撤销"],
    ["导出", "GET /api/export-notes（Markdown）/ export-notes-doc（图文 HTML）/ export-formulas / export-map", "server.js 内本地生成，KaTeX 资源内联"],
    ["备份 / 恢复", "GET /api/export-backup；POST /api/backup/restore", "zip.js 打包 db.json + images；恢复时按科目合并"],
    ["手机访问", "GET /api/state?k=<令牌>（局域网）", "isLoopback / allowRequest 校验令牌，二维码由前端绘制"],
], widths=[3.0, 6.6, 6.9])

# ============ 五、数据模型 ============
doc.add_heading("五、数据模型（data/db.json）", level=1)
table(doc, [
    ["键", "含义", "关键字段"],
    ["subjects", "科目", "id、name、标准（分类标准）、颜色、createdAt"],
    ["decks", "课件（一组页面）", "id、subjectId、title、createdAt"],
    ["slides", "页面", "id、deckId、idx、image（图片名）、ocr 文本、digest 汇总、状态"],
    ["items", "知识点 / 拓展", "id、slideId、name、content、formula、quote（原文片段）、importance、type、tags、draw（画板数据）、figure"],
    ["categories", "分类", "id、subjectId、parentId、name、order"],
    ["settings", "设置", "模型名、推理档位、界面缩放、折叠行数、显示开关、shareToken"],
    ["usage / usageDaily", "用量与费用", "时间、用途、输入/输出 token、缓存命中、折算人民币"],
], widths=[3.2, 4.4, 8.9])

# ============ 六、部署与打包 ============
doc.add_heading("六、启动、部署与打包", level=1)
doc.add_heading("6.1 电脑端", level=2)
code(doc, [
    "1) 安装 Node.js 18+",
    "2) 双击 启动.bat            -> 控制台运行 server/server.js",
    "3) 浏览器打开 http://127.0.0.1:8713   (端口被占用会自动顺延)",
    "4) 设置里填 DeepSeek API Key；演示模式可不开 Key",
], size=9)
doc.add_heading("6.2 手机 APK", level=2)
code(doc, [
    "cd android",
    "powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1",
    "-> 产物: MakeYourNotes-v<VersionName>.apk  (同时在 dist/ 留档)",
    "签名: coursenotes.keystore (务必单独备份；换签名会导致无法覆盖安装)",
], size=9)
doc.add_heading("6.3 发版约定", level=2)
bullet(doc, "版本号三档：新增独立页面 → 主版本；开辟新能力类型 → 次版本；修复与小改动 → 修订号。每段可为两位数。")
bullet(doc, "每次改动：更新 CHANGELOG 顶部条目 → 同步 handoff 当前状态 → 改 AndroidManifest 与 build.ps1 的 versionCode/versionName → 提交并打同名 tag。")
bullet(doc, "APK 通过 GitHub Releases 发布，不入库（.gitignore 排除 *.apk / *.zip / data/）。")

# ============ 七、目录速查 ============
doc.add_heading("七、想改某处该动哪个文件（速查）", level=1)
table(doc, [
    ["想改的东西", "动这里"],
    ["界面文字 / 卡片布局 / 交互逻辑", "public/app.js（视图函数）+ public/styles.css"],
    ["配色、圆角、间距", "public/styles.css 顶部设计变量"],
    ["提示词、模型参数、重试策略", "server/deepseek.js（文件开头的 SYSTEM 常量与调用函数）"],
    ["接口、导出格式、备份逻辑", "server/server.js（serve() 路由表 + export/backup 段）"],
    ["画板工具、连线算法、元件", "public/draw.js + public/symbols.js"],
    ["手机端启动行为、WebView 设置", "android/src/com/dshwork/coursenotes/MainActivity.java"],
    ["版本号 / 打包流程", "android/AndroidManifest.xml + android/build.ps1"],
], widths=[7.0, 8.6])

# ============ 八、核对清单 ============
doc.add_heading("八、核对清单（逐项打勾）", level=1)
table(doc, [
    ["#", "核对项", "怎么确认", "结果"],
    ["1", "项目能跑起来", "双击 启动.bat，浏览器打开 127.0.0.1:8713", "□"],
    ["2", "数据文件结构正确", "打开 data/db.json，看到 subjects / slides / items / categories / usage", "□"],
    ["3", "前端视图函数齐全", "app.js 搜 renderTopbar、itemsView、categoriesView", "□"],
    ["4", "提示词在指定位置", "deepseek.js 搜 EXTRACT_SYSTEM、ORGANIZE_SYSTEM", "□"],
    ["5", "关键接口存在", "server.js 搜 /api/state、/api/process、/api/export-backup", "□"],
    ["6", "元件符号数量", "symbols.js 搜 id=\"sym- 应命中 41 次", "□"],
    ["7", "画板图形定义", "draw.js 搜 SHAPES", "□"],
    ["8", "启动动画与失败兜底", "MainActivity.java 搜 showSplash、showLogScreen", "□"],
    ["9", "APK 版本号一致", "build.ps1 的 $VersionCode/$VersionName 与 Manifest 一致（83 / 2.9.10）", "□"],
    ["10", "参赛文档可打开", "docs/项目文档-MakeYourNotes.docx", "□"],
    ["11", "交接文件是最新状态", "handoff 第二节写着 v2.9.10（versionCode 83）", "□"],
    ["12", "版本历史完整", "CHANGELOG.md 顶部有 v2.9.10 条目，共 79 个版本", "□"],
], widths=[0.9, 4.4, 8.2, 1.6], size=8.4)

# ============ 九、常见问题 ============
doc.add_heading("九、常见问题", level=1)
table(doc, [
    ["现象", "原因与处理"],
    ["启动黑窗一闪就关", "没装 Node.js 18+；按提示安装后重试"],
    ["端口 8713 被占用", "程序会自动顺延端口，控制台会打印实际地址；也可先运行 停止.bat"],
    ["手机装 APK 提示「开发者身份未验证」", "Android 对非商店安装包的校验：选「仍然安装」，或在 Play Protect 里关闭应用扫描；签名未变可覆盖安装"],
    ["手机版一直停在启动页", "首次启动需解压资源（2~5 秒）；超过 60 秒会自动切到日志页显示 Node 输出"],
    ["识别报 429 / 5xx", "触发限流：系统会自动退避重试并转单线程；可稍后再试或减少一次上传页数"],
    ["备份恢复后图片丢失", "确认备份包含 images（新版备份会打包图片）；老备份只存路径，需要原图仍在"],
], widths=[5.0, 10.6], size=8.6)

p(doc, "本手册由项目结构自动核对生成，结构有变化时应同步更新；文件位置：docs/项目说明手册-MakeYourNotes.pdf。",
  size=9, color=MUTED, indent=False)

doc.save(OUT)
print("saved:", OUT, os.path.getsize(OUT))
d2 = Document(OUT)
print("段落:", len(d2.paragraphs), "| 表格:", len(d2.tables), "| 标题数:", len([x for x in d2.paragraphs if x.style.name.startswith('Heading')]))
