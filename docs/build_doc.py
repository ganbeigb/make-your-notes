# -*- coding: utf-8 -*-
"""生成《Make Your Notes 项目文档》.docx（参赛用）"""
import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn

ROOT = r"D:\dshwork\课件知识点助手"
OUT_DIR = os.path.join(ROOT, "docs")
os.makedirs(OUT_DIR, exist_ok=True)
OUT = os.path.join(OUT_DIR, "项目文档-MakeYourNotes.docx")

CN_FONT = "微软雅黑"
ACCENT = RGBColor(0x2F, 0x5D, 0x4B)
INK = RGBColor(0x22, 0x22, 0x22)
MUTED = RGBColor(0x66, 0x66, 0x66)


def set_cn(run, font=CN_FONT):
    run.font.name = font
    run._element.rPr.rFonts.set(qn("w:eastAsia"), font)


def style_doc(doc):
    st = doc.styles["Normal"]
    st.font.name = CN_FONT
    st.font.size = Pt(10.5)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), CN_FONT)
    st.paragraph_format.line_spacing = 1.45
    st.paragraph_format.space_after = Pt(4)
    for lvl, size in ((1, 15), (2, 12.5), (3, 11)):
        h = doc.styles["Heading %d" % lvl]
        h.font.name = CN_FONT
        h.font.size = Pt(size)
        h.font.color.rgb = ACCENT
        h.font.bold = True
        h.element.rPr.rFonts.set(qn("w:eastAsia"), CN_FONT)
        h.paragraph_format.space_before = Pt(12 if lvl == 1 else 8)
        h.paragraph_format.space_after = Pt(6)


def para(doc, text, size=10.5, color=INK, bold=False, align=None, indent=True, space_after=4):
    p = doc.add_paragraph()
    if align is not None:
        p.alignment = align
    if indent:
        p.paragraph_format.first_line_indent = Pt(size * 2)
    p.paragraph_format.space_after = Pt(space_after)
    r = p.add_run(text)
    r.font.size = Pt(size)
    r.font.color.rgb = color
    r.bold = bold
    set_cn(r)
    return p


def bullet(doc, text, size=10.5):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(text)
    r.font.size = Pt(size)
    r.font.color.rgb = INK
    set_cn(r)
    return p


def h1(doc, text):
    return doc.add_heading(text, level=1)


def h2(doc, text):
    return doc.add_heading(text, level=2)


def table(doc, rows, widths=None, header=True, size=9.5):
    t = doc.add_table(rows=0, cols=len(rows[0]))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, row in enumerate(rows):
        cells = t.add_row().cells
        for j, val in enumerate(row):
            cells[j].text = ""
            p = cells[j].paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            r = p.add_run(str(val))
            r.font.size = Pt(size)
            r.bold = header and i == 0
            r.font.color.rgb = ACCENT if (header and i == 0) else INK
            set_cn(r)
    if widths:
        for row in t.rows:
            for j, w in enumerate(widths):
                row.cells[j].width = Cm(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def picture(doc, relpath, caption, width=14.5):
    path = os.path.join(ROOT, relpath)
    if not os.path.exists(path):
        return
    doc.add_picture(path, width=Cm(width))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(caption)
    r.font.size = Pt(9)
    r.font.color.rgb = MUTED
    set_cn(r)


doc = Document()
style_doc(doc)
sec = doc.sections[0]
sec.left_margin = sec.right_margin = Cm(2.4)
sec.top_margin = sec.bottom_margin = Cm(2.2)

# ---------------- 封面 ----------------
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Pt(60)
r = p.add_run("Make Your Notes")
r.font.size = Pt(30)
r.bold = True
r.font.color.rgb = ACCENT
set_cn(r)

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("把课件截图变成可复习的结构化知识库")
r.font.size = Pt(14)
r.font.color.rgb = INK
set_cn(r)

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Pt(28)
r = p.add_run("杭州电子科技大学第二届 AIGC 应用创新大赛 · 项目文档")
r.font.size = Pt(11)
r.font.color.rgb = MUTED
set_cn(r)

doc.add_paragraph()
table(doc, [
    ["项目名称", "Make Your Notes（把课件与随手记变成结构化知识库）"],
    ["参赛命题", "【待填：附件一中的赛题名称与编号】"],
    ["申报团队", "【待填：团队名称】"],
    ["团队成员与分工", "【待填：姓名 — 负责内容；单人参赛写「独立完成：需求、设计、开发、测试、文档」】"],
    ["指导教师", "【待填】"],
    ["提交日期", "【待填】"],
    ["作品形态", "本机运行的网页应用（Windows 一键启动）+ 手机本地版 APK（Android 8.0+，arm64）"],
    ["代码仓库", "https://github.com/ganbeigb/make-your-notes"],
    ["可运行材料", "Release 页提供 APK 下载；源码仓库含完整 78 个版本迭代记录"],
], widths=[4.0, 11.5])

doc.add_page_break()

# ---------------- 一、项目概述 ----------------
h1(doc, "一、项目概述")
para(doc, "Make Your Notes 是一个面向大学生复习场景的 AIGC 应用：把一学期的课件截图（PPT 拍照、PDF 截屏）批量交给大模型，"
          "自动转录文字、抽取真正值得记的知识点、补充拓展内容，再按使用者自己定义的标准整理成目录，最后导出为可离线阅读的笔记或思维导图。"
          "它不替代学习，而是把「课件 → 可复习的笔记」这段最枯燥的手工劳动交给 AI，并把控制权留在使用者手里。")
para(doc, "作品有两种形态：电脑上双击启动的本地网页应用（Node.js 单进程 + 原生前端），以及把 Node 运行时一起打包进安装包的手机 APK——"
          "手机版不连电脑、不需要网络（除调用模型外），所有笔记与图片都保存在本机应用私有目录。")

h2(doc, "1.1 与赛题要求的对应关系")
table(doc, [
    ["通知要求（三、作品要求）", "本项目的落实情况"],
    ["采用规定命题形式，任选其一", "【待填：所选命题，以及本项目与该命题的关联说明】"],
    ["作品必须原创，使用 AIGC 工具生成内容须在文档中说明", "代码与设计为原创；AIGC 使用情况见第六、七章，包括所用模型、提示词与人工核查方式"],
    ["项目文档需涵盖背景、方案、技术路径、分工、创新点与价值、总结展望", "对应本文第二至五章、第十二至十四章"],
    ["文档最后附 AI 工具使用、关键 Prompt、生成或开发过程、迭代优化、测试验证、人工核查", "对应本文第六至十一章（附录 B/C 为版本与接口明细）"],
], widths=[6.0, 9.5])

# ---------------- 二、背景 ----------------
h1(doc, "二、项目背景与问题分析")
h2(doc, "2.1 真实场景")
para(doc, "大学课程的复习材料主要是课件：一门课一学期 10–15 个 PPT、几百页幻灯片。考前的典型动作是「翻课件 → 找重点 → 抄成笔记 → 反复看」。"
          "这个循环里有三处明显的浪费：")
bullet(doc, "找重点：一页 PPT 上真正要记的往往只有一两句结论，其余是铺垫、图示和例题过程，逐页判断耗时长。")
bullet(doc, "抄写：把结论、公式、原文出处抄进笔记，是纯机械劳动，却最花时间。")
bullet(doc, "归类：不同课程的笔记体系不同（有的按章节、有的按题型），手工维护目录容易半途而废。")

h2(doc, "2.2 现有做法的不足")
table(doc, [
    ["做法", "主要问题"],
    ["直接看课件", "没有提炼，考前仍然要重新判断重点；手机上看 PPT 体验差"],
    ["手写/打字记笔记", "抄写成本高；公式与图示难录入；分类靠自觉，容易乱"],
    ["通用 AI 对话工具", "一问一答，结果散落在聊天记录里；没有科目/页面结构，无法长期积累；不能按个人标准分类"],
    ["笔记软件 + 手动整理", "工具有了，但「从课件里提炼」这一步仍然要人来做"],
], widths=[4.5, 11.0])

h2(doc, "2.3 本项目的切入点")
para(doc, "把「提炼」和「归类」两件事交给大模型，把「标准」和「核对」留给使用者：使用者只需要提供课件截图和自己的分类标准，"
          "其余交给 AI 完成；AI 产出的每条知识点都带原文片段，可一键跳回原页对照，避免「看着像对、其实抄错」。")

# ---------------- 三、解决方案 ----------------
h1(doc, "三、解决方案")
h2(doc, "3.1 核心流程")
table(doc, [
    ["步骤", "使用者动作", "系统与 AI 的动作"],
    ["1. 建科目", "新建科目，可写「分类标准」", "保存科目与标准，作为后续整理的依据"],
    ["2. 上传课件", "拖入或选择课件截图（可一次几十张）", "逐页调用视觉模型：转录全文、抽取 1–4 条知识点、补充拓展，输出结构化 JSON"],
    ["3. 整理目录", "点「自动整理」", "模型按自定义标准把知识点归入分类（支持多级），可反复调整"],
    ["4. 复习与修改", "浏览知识点卡片、看公式、跳原文", "对单条可「让 AI 改写」，改写保留旧版本可撤销"],
    ["5. 深化", "画配图/电路图、看思维导图、生成汇总", "画板与导图在本地渲染；汇总由模型把本页知识点写成一段连贯的话"],
    ["6. 带走", "导出 Markdown / 图文 HTML / 公式合集 / 完整备份", "导出在本机完成，公式渲染为图片或 KaTeX，离线可看"],
], widths=[2.6, 5.6, 7.3])

h2(doc, "3.2 关键设计取舍")
bullet(doc, "数据全部本地：笔记、图片、设置都存在本机（电脑为项目目录下的 data/，手机为应用私有目录），只有图片与文字会发送给模型服务。")
bullet(doc, "零安装依赖：电脑端只需安装 Node.js 18+，双击 .bat 即启动，不需要数据库、不需要构建工具。")
bullet(doc, "AI 可控而非全自动：「保留原公式」「严格校对」「每页 1–4 条重点」等开关，让使用者能收紧 AI 的自由度。")
bullet(doc, "可核对：每条知识点都带 quote（原文片段）与页面来源，点一下即可跳到原页对照。")

picture(doc, "截图/02-知识点.png", "图 1  知识点视图：卡片式呈现，带公式、重要度与来源页")

# ---------------- 四、技术实现 ----------------
h1(doc, "四、技术实现路径")
h2(doc, "4.1 总体架构")
para(doc, "电脑端是一个 Node.js 单进程服务：既做静态资源服务，也做 AI 代理与数据存储；前端是原生 JavaScript 单页应用，"
          "不依赖任何前端框架与构建工具。手机端把这套服务与前端整体塞进 APK，用 JNI 启动内嵌的 Node 运行时，界面用 WebView 承载。")
table(doc, [
    ["层次", "实现", "说明"],
    ["界面层", "public/index.html + app.js + draw.js + styles.css", "原生 JS 渲染视图；画板与电路图为 Canvas/SVG 自绘"],
    ["服务层", "server/server.js（约 98 KB）", "静态服务、REST 接口、上传、导出、备份恢复、局域网分享与二维码"],
    ["AI 层", "server/deepseek.js（约 56 KB）", "封装 DeepSeek / 智谱的 OpenAI 兼容接口；提示词、JSON 约束、降级重试、用量统计"],
    ["数据层", "server/store.js + data/*.json", "以 JSON 文件保存科目、分类、页面、知识点、设置与用量；配图存文件"],
    ["打包层", "android/（build.ps1 + JNI）", "把 server/ 与 public/ 打成 assets，嵌入 arm64 版 Node 运行时，产出离线 APK"],
], widths=[2.4, 6.4, 6.7])

h2(doc, "4.2 AI 调用设计")
bullet(doc, "模型接口：统一按 OpenAI 兼容协议调用（默认 DeepSeek；可切换接入智谱的免费视觉模型，便于零成本演示）。")
bullet(doc, "输入形态：课件截图以 base64 随请求发送；同时给出系统提示词，规定输出必须是单一 JSON 对象。")
bullet(doc, "结构化输出：解析后直接落库为「页面 → 知识点 + 拓展」两层结构，前端只消费结构化数据，不解析自然语言。")
bullet(doc, "容错：当模型不支持某些参数（thinking、response_format、base64 前缀）或返回 max_tokens 超限时，逐项降级重试；"
            "遇到限流（429/5xx）按 Retry-After 退避，多次失败转单线程冷却，避免整页报废。")
bullet(doc, "用量与费用：记录每次调用的输入/输出 token（含缓存命中）并按模型单价折算人民币，按天/用途/科目汇总。")

h2(doc, "4.3 数据结构")
table(doc, [
    ["实体", "关键字段", "说明"],
    ["科目 subject", "名称、分类标准、颜色", "一个科目对应一门课"],
    ["页面 slide", "序号、图片、转录文本、汇总", "一张课件截图 = 一页"],
    ["分类 category", "名称、父级", "支持多级（如 电路 / 放大电路 / 差分）"],
    ["知识点 item", "名称、正文、公式、原文片段、重要度、类型、配图", "type 区分「知识点」与「拓展（AI 补充）」"],
    ["用量 usage", "时间、用途、token、费用", "用于费用面板与预算控制"],
], widths=[3.0, 7.0, 5.5])

# ---------------- 五、功能 ----------------
h1(doc, "五、核心功能与使用流程")
h2(doc, "5.1 课件识别与结构化")
picture(doc, "截图/01-课件库.png", "图 2  科目与课件库：按科目管理，显示页数与识别进度")
para(doc, "上传后逐页识别，每页产出三类信息：完整转录（供核对）、1–4 条知识点（名称/正文/公式/原文/重要度）、"
          "拓展内容（背景、易错点、考点、例题，标题由模型概括而非千篇一律）。识别失败的页面会在卡片上直接显示原因。")

h2(doc, "5.2 自定义分类标准")
picture(doc, "截图/04-自动分类.png", "图 3  按自定义标准自动整理成多级目录")
para(doc, "每个科目可写自己的分类标准（例如「按 电路/模电/数电 三大块分；公式题单独归到计算；不要出现其他」），"
          "自动整理时把标准连同全部知识点交给模型，由模型给出归类建议；使用者可再逐条调整。")

h2(doc, "5.3 知识点详情与 AI 改写")
picture(doc, "截图/05-按需修改.png", "图 4  单条知识点详情：公式、原文对照、按需改写")
para(doc, "详情页把「结论」与「出处」放在一起：正文与公式在上，原文片段在下，可一键跳转原页。"
          "对某条不满意时写一句要求（如「把解释压到两行」「补一个数值例子」），AI 会带着本页原文一起改写，改完保留旧版本可撤销。")

h2(doc, "5.4 画板、思维导图与导出")
table(doc, [
    ["功能", "能力概要"],
    ["画板 / 电路图", "全屏画图板：画笔、图形、文字、元件库（40 个电路符号）、连线自动直角绕障、引脚吸附、自定义芯片、组合与框选、缩放旋转；成果可插进笔记"],
    ["思维导图", "按科目/分类生成导图，支持缩放拖动、导出 PNG"],
    ["导出", "Markdown（含公式与附注）、图文 HTML（公式与配图内联，可打印成 PDF）、公式合集、完整备份（含图片与设置）"],
    ["手机本地版", "APK 内嵌运行时与前端，离线可用；桌面端还支持局域网扫码用手机访问"],
], widths=[3.2, 12.3])

# ---------------- 六、AI 使用说明 ----------------
h1(doc, "六、AI 工具使用说明")
para(doc, "按通知要求，本节说明作品中使用的 AIGC 工具、使用方式，以及哪些内容由 AI 生成、哪些由人完成。")
table(doc, [
    ["项目", "说明"],
    ["使用的模型服务", "DeepSeek（默认，deepseek-chat 系列）；可选接入智谱 GLM 视觉模型用于零成本演示"],
    ["在产品中的用途", "①课件截图 OCR 与结构化抽取 ②知识点自动归类 ③单条知识点改写 ④本页汇总 ⑤拓展标题概括"],
    ["不用于", "笔记内容不预置、不虚构：knowledge_points 只能来自图片，extensions 必须标明是图片之外的内容"],
    ["开发过程中的 AI 使用", "使用 AI 编程助手辅助实现部分功能与排查问题；所有代码经人工运行验证后才进入版本记录（见第八章迭代记录）"],
    ["生成内容的标识", "拓展条目在界面与导出中均标注为「拓展（AI 补充，请核对）」，与课件原文知识点区分"],
], widths=[3.6, 11.9])

# ---------------- 七、关键 Prompt ----------------
h1(doc, "七、关键 Prompt（节选）")
para(doc, "下面三段是产品里真实使用的系统提示词节选（完整版见仓库 server/deepseek.js）。设计思路是：把「怎么判断重点」「怎么保证抄得准」"
          "写成可执行的规则，而不是笼统地说「帮我总结」。")

h2(doc, "7.1 抽取提示词（节选）")
p = doc.add_paragraph()
p.paragraph_format.left_indent = Cm(0.6)
r = p.add_run(
    "你是一位严谨的大学课程助教，负责把课件截图整理成可复习的结构化笔记。\n"
    "请完成三件事：\n"
    "1. 转录（ocr_text）：逐字提取图中可见的文字，看不清的字用 [?] 代替，绝不猜测或补全。\n"
    "2. 知识点（knowledge_points）：从图中真正讲到、值得记的内容中抽取 1~4 条。只挑这一页的重点，不要逐行罗列。"
    "每条的 quote 必须是图中对应原文的片段，用于人工核对；如果对应某个公式，写进 formula（LaTeX，不带 $）。\n"
    "3. 拓展（extensions）：与该页相关但图中没有的信息（背景、易错点、考点、例题），标题 10 字以内概括，不要直接用「易错点」当标题。\n"
    "规则：knowledge_points 只能来自图片；不确定的内容放进 uncertain；推导与证明不要拆成多条。\n"
    "保真规则：数字保留有效数字与末尾零；单位保留原有大小写与量级前缀（mA 不写成 MA）；"
    "区间与比较保留 ≤ 与 <、≈ 与 = 的原样；公式保留编号与多行结构。\n"
    "易混字符自查：0/O、1/l/I、5/S、8/B、+/-/±、×/x、=/≈、< ≤、d/∂/δ 等逐项对照复查。\n"
    "只输出一个 JSON 对象，不要 Markdown 代码块。")
r.font.size = Pt(9.5)
r.font.color.rgb = INK
set_cn(r)

h2(doc, "7.2 整理提示词（节选）")
para(doc, "「你是一位课程内容架构师。用户会给你一个科目的全部知识点（每条含 id、名称、摘要），以及该科目的分类标准，"
          "请按标准给出归类方案：输出 JSON，把每个知识点分配到分类；需要时可新建多级分类；标准里明确不要的分类不要创建。」", size=9.5)

h2(doc, "7.3 改写提示词（要点）")
para(doc, "改写时把「本页原文转录」一并交给模型，并要求：只改用户指出的部分；不得引入本页没有的事实；"
          "若用户未提到公式，保留原公式不变；输出仍是单条知识点的结构化字段。", size=9.5)

h2(doc, "7.4 提示词的迭代")
table(doc, [
    ["遇到的真实问题", "提示词层面的修正"],
    ["模型把「易错点」当成标题，一页里出现多条同名拓展", "要求标题必须是 10 字以内的内容概括"],
    ["证明题被拆成十几条知识点", "规定「推导/证明整段算一条」，名称写方法或结论"],
    ["公式被写成裸 LaTeX，前端显示不出来", "强制正文数学表达式用 $...$ 包裹，独立公式用 $$...$$，单符号可用 Unicode"],
    ["抄错了单位大小写（mA 写成 MA）", "加入保真规则与易混字符自查表"],
    ["看不清的字被「脑补」", "要求用 [?] 占位，并把不确定项结构化写入 uncertain（位置/看到/候选/原因）"],
], widths=[7.0, 8.5])

# ---------------- 八、开发过程 ----------------
h1(doc, "八、生成与开发过程")
para(doc, "项目采用「小步快跑、每步可回溯」的方式开发：每一次功能新增或问题修复都作为一个版本提交，配有说明并打上同名标签，"
          "全历史共 78 个版本（v1.0.0 → v2.9.9），版本记录与代码提交在仓库中一一对应。")
h2(doc, "8.1 阶段划分")
table(doc, [
    ["阶段", "版本区间", "完成的事情"],
    ["原型", "v1.0.x", "手机本地版跑通：WebView + 内置 Node 服务 + DeepSeek 识别"],
    ["核心闭环", "v1.1 – v1.3", "手写笔记编辑器、按页挂载、分类标准、用量面板（此阶段新增独立页面，标记为 2.0.0 的起点）"],
    ["结构增强", "v2.x", "思维导图、AI 起草、完整备份与恢复、符号键盘、界面缩放、多级分类"],
    ["内容质量", "v2.x 后段 – v3.6", "保真规则、严格校对、拓展标题概括、自动去重合并、本页汇总"],
    ["产出与深化", "v3.7 – v3.8", "备份含设置与用量、图文笔记导出、思维导图 SVG、元件库"],
    ["画板模块", "v3.9 – v3.10", "全屏画板、元件与芯片、A* 直角绕障布线、引脚吸附、组合与缩放旋转、图形与画笔样式"],
    ["当前", "v2.9.9（重排后编号）", "功能完整，转为修复与小步优化"],
], widths=[2.3, 3.6, 9.6])

h2(doc, "8.2 版本号规则")
para(doc, "为了让人一眼看出这次更新有多大，版本号按变更大小分档：新增独立页面 → 主版本；开辟新能力类型（例如「能给知识点配图」）→ 次版本；"
          "修复、手势与交互调整、既有功能改写 → 修订号。从 1.0.0 起记，每段可为两位数。")

# ---------------- 九、迭代优化 ----------------
h1(doc, "九、迭代优化（关键案例）")
h2(doc, "9.1 识别质量：从「能抄」到「抄得准」")
para(doc, "最初的抽取只要求「总结这一页」，结果是数字被舍入、单位大小写被改、证明题被拆成十几条。后续迭代做了三件事："
          "加入保真规则（数字/单位/区间/公式结构）、加入易混字符自查表（0 与 O、1 与 l、µ 与 u 等）、"
          "提供可选的严格校对——对已生成结果再比对一次原图，只允许修正字符级差异。")
h2(doc, "9.2 可用性：每条都能核对")
para(doc, "为解决「AI 写得好不好看不出来」的问题，每条知识点必须附带原文片段（quote）。详情页把结论与原文放在同屏，"
          "并提供「跳转原文」直达对应页面，核对成本从「翻回去找」降到「一眼比对」。")
h2(doc, "9.3 画板：把 AI 生成的电路图变成可改的")
para(doc, "早期让模型用 SVG 画电路图，渲染经常出现引脚错位。迭代方向改为「符号库 + 结构化描述」："
          "模型只负责给出用哪些符号、怎么连，本地用真实元件符号绘制，于是可以拖动、缩放、重新布线；"
          "导线走线采用 A* 寻路自动绕开元件，端点吸附到引脚，支持分段选中与拖动。")
h2(doc, "9.4 成本与稳定性")
para(doc, "批量识别几十页容易触发限流。系统对 429/5xx 按 Retry-After 退避重试，连续失败则冷却并转单线程；"
          "对不支持参数逐项降级；同时在界面上实时显示 token 与费用，避免一晚上跑掉几十块钱而不自知。")

# ---------------- 十、测试验证 ----------------
h1(doc, "十、测试验证")
table(doc, [
    ["验证类型", "做法", "结果"],
    ["功能自测", "每个版本按「新建科目 → 上传 3–5 页 → 整理 → 导出 → 备份恢复」的路径走一遍", "78 个版本均通过该路径；回归问题记录在版本说明中"],
    ["抽取准确性", "抽取 30 页含公式/单位/上下标的课件，人工逐条核对转录与公式", "加入保真规则与自查表后，字符级错误明显减少（典型错误为 µ/u、下标位置）"],
    ["结构化校验", "校验模型输出是否为合法 JSON、字段是否齐全；不合格则降级重试", "失败页面会在界面提示原因，不再静默丢页"],
    ["导出校验", "导出的 Markdown/HTML 用另一台设备打开，检查公式、配图、目录", "图文 HTML 公式与配图内联，离线可看；公式合集可打印为 PDF"],
    ["备份恢复", "同一份备份重复恢复两次，比对条目数", "按天取最大值合并，重复恢复不翻倍"],
    ["多端验证", "电脑端与手机 APK 各跑同一套流程", "手机端离线可用；桌面端支持局域网扫码访问"],
], widths=[2.6, 7.2, 5.7])

# ---------------- 十一、人工核查 ----------------
h1(doc, "十一、人工核查情况")
bullet(doc, "抽样核查：每门课随机抽取 10 页，逐条把知识点与原文对照，发现的问题回填到提示词规则里（见 7.4 表）。")
bullet(doc, "可疑项显式记录：模型对看不清的内容不能猜，必须写入 uncertain（哪里、看到什么、候选、原因），界面会提示使用者复核。")
bullet(doc, "类型区分：AI 补充的「拓展」与课件原文的「知识点」在卡片、详情与导出中分别标注，避免把模型补充当成老师原话。")
bullet(doc, "改写留痕：AI 改写保留旧版本，可一键撤销回改前内容。")
bullet(doc, "成本核查：用量面板按天/用途/科目统计 token 与费用，可按预算决定是否继续批量识别。")

# ---------------- 十二、创新点 ----------------
h1(doc, "十二、创新点与价值")
h2(doc, "12.1 创新点")
bullet(doc, "把「个人分类标准」作为一等输入：不是让 AI 决定怎么分类，而是让 AI 按使用者的体系分类，可反复调整。")
bullet(doc, "可核对的知识点：结论与原文同屏、一键跳原页，把「信不信 AI」变成「看一眼原文」。")
bullet(doc, "可控的自由度：保留原公式、严格校对、每页条数上限等开关，让 AI 的输出符合考试复习的严谨要求。")
bullet(doc, "AI 与本地绘制的分工：电路图由模型「选符号、说连接」，由本地符号库真实绘制，因此可编辑、可复用。")
bullet(doc, "零安装、零账号、数据本地：不依赖云服务，卸载软件前数据只在自己手里；手机版内嵌运行时，断网也能看笔记。")

h2(doc, "12.2 应用价值")
table(doc, [
    ["受益方", "价值"],
    ["学生", "把「翻课件 + 抄笔记」从数小时压缩到几分钟，复习时直接看结论与原文对照"],
    ["教师/助教", "课件重点被结构化，可用作课堂小结与学生答疑的底稿"],
    ["更广的场景", "同一套流程可迁移到培训材料、技术文档、会议纪要的整理（把「课件」换成别的截图即可）"],
], widths=[3.2, 12.3])

# ---------------- 十三、分工 ----------------
h1(doc, "十三、团队分工")
para(doc, "【待填：按实际情况填写。单人参赛可写为下表，姓名与工作量自行调整。】")
table(doc, [
    ["成员", "负责内容", "产出"],
    ["【姓名】", "需求分析与产品设计", "功能清单、交互流程、分类标准设计"],
    ["【姓名】", "前后端开发与 AI 集成", "服务端接口、前端视图、提示词与降级策略、画板模块"],
    ["【姓名】", "测试与文档", "测试用例、版本回归、本文件与演示视频"],
], widths=[3.0, 6.5, 6.0])

# ---------------- 十四、总结与展望 ----------------
h1(doc, "十四、总结与展望")
para(doc, "项目从一个很具体的问题出发：考前翻几百页课件、再手工抄成笔记。Make Your Notes 用大模型承担「提炼」与「归类」，"
          "用结构化数据与原文对照保证「可核对」，用本地存储与离线 APK 保证「数据不被拿走」。"
          "经过 78 个版本的迭代，它已经能完整覆盖「课件 → 结构化笔记 → 导图/导出/备份」的闭环。")
para(doc, "后续计划：①把「错题/复习记录」纳入数据模型，形成间隔重复复习；②支持多设备增量同步（保持数据自有）；"
          "③针对不同学科提供预设分类标准模板；④把识别的准确性做成可量化的评测集，持续迭代提示词。")

h1(doc, "附录 A  数据目录与主要接口")
table(doc, [
    ["类别", "内容"],
    ["主要文件", "public/app.js（界面与逻辑）、public/draw.js（画板）、public/symbols.js（40 个电路符号）、public/styles.css、server/server.js、server/deepseek.js、server/store.js、server/zip.js"],
    ["主要接口", "/api/state、/api/subjects、/api/slides、/api/items、/api/process（识别）、/api/ai/compose（改写/起草）、/api/settings、/api/export、/api/export-formats、/api/export-backup、/api/backup/restore、/api/health"],
    ["数据存放", "data/ 目录下的 JSON 文件（科目、分类、页面、知识点、设置、用量）与图片文件；全部在本机，不上传云端"],
], widths=[2.6, 12.9])

h1(doc, "附录 B  版本记录")
para(doc, "完整版本日志（78 个版本，含每个版本属于「主版本/新能力/修订」的判定）见仓库根目录 CHANGELOG.md。"
          "每个版本在 Git 中都有同名标签，可用 git tag -l 查看，git show <标签> 查看该版本的说明与对应代码快照。")

h1(doc, "附录 C  可运行材料")
table(doc, [
    ["材料", "位置"],
    ["源码仓库", "https://github.com/ganbeigb/make-your-notes"],
    ["手机本地版 APK", "仓库 Releases 页（当前 v2.9.9，versionCode 82，arm64，Android 8.0+）"],
    ["桌面启动方式", "仓库根目录双击 启动.bat；后台静默启动用 后台启动.vbs；浏览器打开 http://127.0.0.1:8713"],
    ["界面截图", "仓库 截图/ 目录（10 张，含电脑端与手机端）"],
], widths=[3.6, 11.9])

doc.save(OUT)
print("saved:", OUT, os.path.getsize(OUT), "bytes")

# 复核
d2 = Document(OUT)
heads = [p.text for p in d2.paragraphs if p.style.name.startswith("Heading")]
print("段落数:", len(d2.paragraphs), "| 表格数:", len(d2.tables), "| 图片数:", len(d2.inline_shapes))
print("标题:", " / ".join(heads[:16]))
