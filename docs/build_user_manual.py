# -*- coding: utf-8 -*-
"""生成《Make Your Notes 用户手册》.docx（随后导出 PDF）"""
import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

ROOT = r"D:\dshwork\课件知识点助手"
OUT_DIR = os.path.join(ROOT, "docs")
OUT = os.path.join(OUT_DIR, "用户手册-MakeYourNotes.docx")

CN = "微软雅黑"
ACCENT = RGBColor(0x2F, 0x5D, 0x4B)
INK = RGBColor(0x1F, 0x24, 0x21)
MUTED = RGBColor(0x66, 0x6F, 0x69)


def cn(r, font=CN):
    r.font.name = font
    r._element.rPr.rFonts.set(qn("w:eastAsia"), font)


def style_doc(doc):
    st = doc.styles["Normal"]
    st.font.name = CN
    st.font.size = Pt(10)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), CN)
    st.paragraph_format.line_spacing = 1.45
    st.paragraph_format.space_after = Pt(3)
    for lvl, size in ((1, 15), (2, 11.5)):
        h = doc.styles["Heading %d" % lvl]
        h.font.name = CN
        h.font.size = Pt(size)
        h.font.color.rgb = ACCENT
        h.font.bold = True
        h.element.rPr.rFonts.set(qn("w:eastAsia"), CN)
        h.paragraph_format.space_before = Pt(12 if lvl == 1 else 8)
        h.paragraph_format.space_after = Pt(5)
        h.paragraph_format.keep_with_next = True


def p(doc, text, size=10, color=INK, bold=False, indent=True, after=3, align=None):
    par = doc.add_paragraph()
    if align is not None:
        par.alignment = align
    if indent:
        par.paragraph_format.first_line_indent = Pt(size * 2)
    par.paragraph_format.space_after = Pt(after)
    r = par.add_run(text)
    r.font.size = Pt(size)
    r.font.color.rgb = color
    r.bold = bold
    cn(r)
    return par


def bullet(doc, text, size=10):
    par = doc.add_paragraph(style="List Bullet")
    par.paragraph_format.space_after = Pt(2)
    r = par.add_run(text)
    r.font.size = Pt(size)
    r.font.color.rgb = INK
    cn(r)


def steps(doc, items, size=10):
    for i, it in enumerate(items, 1):
        par = doc.add_paragraph()
        par.paragraph_format.left_indent = Cm(0.5)
        par.paragraph_format.space_after = Pt(2)
        r = par.add_run("%d. " % i)
        r.bold = True
        r.font.size = Pt(size)
        r.font.color.rgb = ACCENT
        cn(r)
        r2 = par.add_run(it)
        r2.font.size = Pt(size)
        r2.font.color.rgb = INK
        cn(r2)


def table(doc, rows, widths, size=9):
    t = doc.add_table(rows=0, cols=len(rows[0]))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, row in enumerate(rows):
        cells = t.add_row().cells
        for j, val in enumerate(row):
            cells[j].text = ""
            par = cells[j].paragraphs[0]
            par.paragraph_format.space_after = Pt(1)
            r = par.add_run(str(val))
            r.font.size = Pt(size)
            r.bold = i == 0
            r.font.color.rgb = ACCENT if i == 0 else INK
            cn(r)
    for row in t.rows:
        for j, wd in enumerate(widths):
            row.cells[j].width = Cm(wd)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def picture(doc, name, caption, width=13.6, max_h=15.5):
    path = os.path.join(ROOT, "截图", name)
    if not os.path.exists(path):
        return
    from PIL import Image as _Img
    w, h = _Img.open(path).size
    ratio = h / float(w)
    if width * ratio > max_h:          # 竖图限制高度，避免整张图挤到下一页
        width = max_h / ratio
    doc.add_picture(path, width=Cm(width))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    par = doc.add_paragraph()
    par.alignment = WD_ALIGN_PARAGRAPH.CENTER
    par.paragraph_format.space_after = Pt(6)
    r = par.add_run(caption)
    r.font.size = Pt(8.5)
    r.font.color.rgb = MUTED
    cn(r)


doc = Document()
style_doc(doc)
sec = doc.sections[0]
sec.left_margin = sec.right_margin = Cm(2.0)
sec.top_margin = Cm(1.9)
sec.bottom_margin = Cm(1.9)

# ---------------- 封面 ----------------
for _ in range(5):
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
r = t.add_run("用户手册")
r.font.size = Pt(20)
r.font.color.rgb = INK
cn(r)

t = doc.add_paragraph()
t.alignment = WD_ALIGN_PARAGRAPH.CENTER
t.paragraph_format.space_before = Pt(8)
r = t.add_run("从装上到每天用：建科目 · 传课件 · 看知识点 · 导出与备份")
r.font.size = Pt(10.5)
r.font.color.rgb = MUTED
cn(r)

doc.add_paragraph()
table(doc, [
    ["适用版本", "v2.9.10（APK versionCode 83）"],
    ["适用人群", "用它整理课件、复习知识点的同学与老师"],
    ["不涉及", "不需要懂代码；不需要数据库；不需要联网保存笔记"],
    ["配套文档", "《项目说明手册》（结构/模块）、《项目文档》（参赛材料）"],
], widths=[3.2, 12.4], size=9)

doc.add_heading("五分钟上手", level=2)
steps(doc, [
    "装 Node.js 18+，双击 启动.bat，浏览器会打开 http://127.0.0.1:8713。",
    "右下角「设置」→ 填 DeepSeek API Key（没有 Key 可先开「演示模式」）。",
    "左上角「+」新建科目，写一句你的分类标准（可留空）。",
    "「上传课件」，把上课拍的 PPT 照片拖进去，等识别完成。",
    "看「知识点」「分类」，用「导出」带走 Markdown，用「完整备份」留底。",
])
p(doc, "下面各章按实际操作顺序展开；遇到问题直接跳到最后一章「常见问题」。")

# ---------------- 目录 ----------------
toc_head = doc.add_heading("手册目录", level=2)
toc_head.paragraph_format.page_break_before = True

toc_rows = [
    ["一", "这是做什么的", "能做什么、不做什么"],
    ["二", "安装与启动", "电脑版 / 手机版"],
    ["三", "第一次使用：填 Key", "供应商、模型、并发、推理等级"],
    ["四", "建科目与分类标准", "分类标准怎么写"],
    ["五", "上传课件并识别", "拖拽 / 粘贴 / 选图，识别与校对"],
    ["六", "看知识点", "卡片、详情、让 AI 改这一条"],
    ["七", "自动整理目录", "按标准归类，可反复整理"],
    ["八", "分类视图与思维导图", "列表 / 导图切换"],
    ["九", "手写笔记与符号键盘", "自己写、LaTeX 预览"],
    ["十", "画板与电路图", "画笔、元件、连线、芯片"],
    ["十一", "导出", "Markdown / 图文 HTML / 公式合集 / SVG / JSON"],
    ["十二", "备份与恢复", "完整备份、换机器"],
    ["十三", "在手机上用", "APK 与扫码访问"],
    ["十四", "设置项速查", "每个开关的作用"],
    ["十五", "费用与用量", "花多少钱、怎么看"],
    ["十六", "常见问题", "10 类典型故障"],
    ["十七", "数据与隐私", "数据存在哪、发给谁"],
]
table(doc, toc_rows, widths=[1.3, 5.2, 9.1], size=9)

# ---------------- 一 ----------------
doc.add_heading("一、这是做什么的", level=1)
p(doc, "把一学期的课件截图（PPT 拍照、PDF 截屏）丢进来，程序会调用大模型逐页识别："
       "转录文字、抽出一页里真正值得记的 1~4 条知识点、再补充一些背景与考点（标为「拓展」）。"
       "之后可以按你自己的标准整理成多级目录，导出成可离线阅读的笔记，或者用手机随时翻。")
p(doc, "三件事需要你知道：")
bullet(doc, "图片和笔记全部存在你自己的电脑（或手机）里，只有截图和文字会发送给模型服务。")
bullet(doc, "AI 补充的「拓展」条目都带标注，和被老师讲到、有原文出处的「知识点」分开显示。")
bullet(doc, "每条知识点都带原文片段，点一下能跳回对应课件原页核对。")

doc.add_heading("二、安装与启动", level=1)
doc.add_heading("2.1 电脑版（Windows）", level=2)
steps(doc, [
    "安装 Node.js 18 或更高版本（nodejs.org，装默认选项即可，只需装一次）。",
    "解压项目文件夹，双击 启动.bat。会弹出一个黑色命令行窗口——它要一直开着。",
    "浏览器自动打开 http://127.0.0.1:8713。若 8713 被占用，程序会自动换到 8714、8715……实际地址看窗口里打印的那行。",
    "不想看到窗口：双击 后台启动.vbs（静默运行）。想让它开机就起来：双击 安装开机自启.bat。",
    "用完停止：关闭命令行窗口，或双击 停止.bat。",
])
p(doc, "提示：启动.bat 只在第一次需要联网安装依赖（如果有的话），日常使用断网也能打开界面，只是识别和改写需要联网。")

doc.add_heading("2.2 手机版（APK）", level=2)
steps(doc, [
    "把 MakeYourNotes-v2.9.10.apk 传到手机（微信文件传输助手、数据线都行）后点开安装。",
    "若提示「开发者身份未验证 / 未知来源」：在提示页选「仍然安装」，或在 Play 商店 → Play Protect 里关闭「扫描应用」再装。",
    "首次启动会解压资源，看到启动动画后约 2~5 秒进入界面。",
    "手机版不连电脑、不需要 WiFi（除调用模型外），数据存在手机应用私有目录。",
])
p(doc, "手机版只支持 arm64 机型（2017 年后的手机基本都满足）；卸载才会删数据，用同一签名覆盖安装会保留数据。")

# ---------------- 三 ----------------
doc.add_heading("三、第一次使用：填 Key", level=1)
p(doc, "右下角「设置」里有这几项（不同版本措辞略有差异，位置一致）：")
table(doc, [
    ["设置项", "怎么填"],
    ["供应商 / 接口地址", "默认 DeepSeek（https://api.deepseek.com）。用中转或本地模型时改成对方地址"],
    ["API Key", "在 platform.deepseek.com → API keys 创建，粘贴进来，点「测试」确认连通"],
    ["识别模型（要能读图）", "默认已填好；换模型时这里必须选能看图的模型，否则识别会报错"],
    ["文字模型（整理/改稿/起草）", "纯文本模型即可，默认 deepseek-chat"],
    ["并发数", "一次同时识别几页。默认 1~2 即可；免费模型建议设 1，避免触发限流"],
    ["推理等级", "关闭 / 低 / 高 / 最大。越高越慢越贵，一般「低」够用"],
], widths=[4.6, 11.0])
p(doc, "没有 API Key 也能先体验：设置里打开「演示模式」，识别会返回示例数据，不消耗额度。")

doc.add_heading("四、建科目与分类标准", level=1)
picture(doc, "08-新建科目.png", "图 1  左上角「+」新建科目，可顺手写下分类标准")
p(doc, "一个科目 = 一门课。建的时候可以填「你希望怎么分类」，例如：\n"
       "「按 电路 / 模电 / 数电 三大块分；公式题单独归到「计算」；不要出现「其他」。」\n"
       "这句话会在「自动整理」时交给模型，所以写得越具体，整理结果越合你意。留空也能用，之后随时在科目里改。")

# ---------------- 五 ----------------
doc.add_heading("五、上传课件并识别", level=1)
doc.add_heading("5.1 三种上传方式", level=2)
bullet(doc, "拖拽：把图片文件直接拖进窗口，会整屏高亮提示「松开上传」。")
bullet(doc, "粘贴：截图后按 Ctrl+V，直接粘进当前科目。")
bullet(doc, "选图：点「上传课件」按钮，从文件管理器多选（一次几十张没问题）。")
p(doc, "图片会被压缩到长边 1800px 再上传，原图只留在本机，所以拍歪、反光也能试，但清晰度会影响识别准确率。")

doc.add_heading("5.2 识别过程", level=2)
p(doc, "上传后程序逐页调用模型：先转录整页文字，再抽 1~4 条知识点（每条带原文片段），最后补充拓展内容。"
       "右下角会显示「后台识别中 3 / 12」的进度；关掉浏览器也不影响，回到页面结果已经在了。")
p(doc, "识别失败的页面会在卡片上直接写原因（例如 Key 不匹配、限流、模型不支持图片）。"
       "开了「严格校对」的话，模型会拿原图再比对一次草稿，只改字符级差异，更准但更慢更贵。")

# ---------------- 六 ----------------
doc.add_heading("六、看知识点", level=1)
picture(doc, "02-知识点.png", "图 2  「知识点」标签页：卡片式列出，带公式、重要度与来源页")
p(doc, "每张卡片显示：标题、正文前几行、公式（有的话）、标签、重要度圆点、来自第几页。"
       "卡片太长会自动折叠，折叠行数可以在设置里改（-1 不折叠、0 只看标题）。")
doc.add_heading("6.1 详情页", level=2)
picture(doc, "03-页面详情.png", "图 3  详情页：正文与公式在上，原文片段在下，可一键跳回原页")
p(doc, "点卡片进入详情。这里能看到完整正文、公式（可放大）、原文片段、标签、重要度，以及「跳转原文」直接看那页课件。")

doc.add_heading("6.2 让 AI 改这一条", level=2)
picture(doc, "05-按需修改.png", "图 4  写一句要求，AI 带着本页原文改写；改完可以撤销")
p(doc, "在详情页写一句要求，例如「把解释压到两行」「补一个数值例子」「把推导补上」，AI 会结合本页原文重写这一条。"
       "改完保留旧版本，弹窗里可以「撤销」。如果不希望公式被改动，设置或编辑器里的「保留原公式」打开即可。")

# ---------------- 七 ----------------
doc.add_heading("七、自动整理目录", level=1)
picture(doc, "04-自动分类.png", "图 5  按你的标准自动归入 2~3 层目录，不满意可重新整理")
p(doc, "点「自动整理」，程序把当前科目的全部知识点（连同你的分类标准）交给模型，由它给出归类方案，可建 2~3 层目录。"
       "整理结果不满意就再点一次；也可以手动把条目拖到别的分类，或改名、删分类。")

doc.add_heading("八、分类视图与思维导图", level=1)
picture(doc, "09-分类导图.png", "图 6  分类页可切换「列表 / 导图」，导图能缩放拖动")
p(doc, "「分类」标签页默认按目录列出；点右上角「导图」切换成树状导图，支持双指缩放、拖动、点节点跳到该知识点。"
       "导图可以导出成 PNG 或 SVG 放进 PPT。")

# ---------------- 九 ----------------
doc.add_heading("九、手写笔记与符号键盘", level=1)
picture(doc, "10-符号键盘.png", "图 7  手动新建的笔记可以用符号键盘快速输入数学符号")
p(doc, "除了从课件里提取，也可以「+ 新建笔记」自己写：标题、正文、公式三块，正文支持 LaTeX 实时预览。"
       "输入框聚焦时用符号键盘点选 μ、∂、∑ 这类符号，会插到光标处。"
       "手动笔记可以挂在某一页课件下，也可以只属于科目。")

doc.add_heading("十、画板与电路图", level=1)
p(doc, "详情页「配图」栏里点「✎ 画配图」进入画板：画笔、常用图形、文字、40 个电子元件、连线、自定义芯片都在这里。"
       "画完插进当前笔记，随笔记一起保存与导出。")
bullet(doc, "连线：点起点、再点终点，自动走直角并绕开元件；端点靠近引脚会自动吸附。")
bullet(doc, "芯片：先设名称和每边引脚数，再拖出矩形放置，引脚可改编号与名称。")
bullet(doc, "组合：框选多个元件后可整体移动、旋转 90°、成组缩放。")
bullet(doc, "撤销/重做：顶栏图标按钮，误操作随时退回。")

# ---------------- 十一 ----------------
doc.add_heading("十一、导出", level=1)
p(doc, "顶部「导出」菜单里有五种产物，按用途选：")
table(doc, [
    ["导出项", "适合什么场景", "说明"],
    ["Markdown", "粘到别的笔记软件、Notion、Obsidian", "公式写成 $$…$$；末尾附「来源与核验」段落"],
    ["学习笔记 HTML（图文文档）", "发给别人看、打印成 PDF", "公式与配图内联，双击即开，完全离线"],
    ["公式合集", "考前只背公式", "按分类汇总本页所有公式，带 KaTeX 渲染"],
    ["思维导图（SVG / PNG）", "放进 PPT 或打印", "矢量，放大不糊"],
    ["JSON（仅文字）", "自己写脚本处理", "不含图片"],
], widths=[4.6, 5.6, 5.4])

doc.add_heading("十二、备份与恢复", level=1)
steps(doc, [
    "「导出」→「完整备份（含设置与用量）」，得到一个 zip（里面是数据、图片与设置）。",
    "把 zip 存到网盘或 U 盘；建议每月一次，交作业/换电脑前务必备一次。",
    "换机器后：点「从备份恢复」，选择 zip；同名科目会合并，重复条目自动跳过。",
])
p(doc, "旧版备份（不含图片）也能恢复，但图片可能缺失，因为老格式只存了文件路径。")

# ---------------- 十三 ----------------
doc.add_heading("十三、在手机上用", level=1)
picture(doc, "06-手机访问.png", "图 8  电脑端点「手机访问」，用手机扫二维码即可（同一 WiFi）")
picture(doc, "07-手机界面.png", "图 9  手机端界面：顶部切换科目，右上角上传，底部切换课件/知识点/分类")
doc.add_heading("13.1 两种方式", level=2)
bullet(doc, "装 APK：完全在手机上运行，不需要电脑（见第二章）。")
bullet(doc, "扫码访问：电脑开着时，手机扫「手机访问」的二维码，同一套数据、同一个 WiFi 即可。")
p(doc, "扫码打不开时：① 确认手机和电脑在同一 WiFi；② 第一次运行时 Windows 防火墙弹窗要点「允许访问」；"
       "③ 校园网/公司网常会隔离设备，换手机热点试试。")

# ---------------- 十四 ----------------
doc.add_heading("十四、设置项速查", level=1)
table(doc, [
    ["分组", "项目", "作用"],
    ["模型", "供应商 / 接口地址 / API Key", "决定调用哪家模型；用中转就改地址"],
    ["模型", "识别模型、文字模型", "识别必须能读图；整理改稿用文字模型"],
    ["模型", "并发数、推理等级、严格校对", "控制速度/费用/准确度"],
    ["界面", "界面大小、知识点卡片折叠行数、课件图片折叠行数", "字号与信息密度"],
    ["界面", "显示原文引用", "关掉后卡片和详情不再显示灰色引用块"],
    ["界面", "保留原公式", "AI 改写时不擅自替换公式"],
    ["其他", "演示模式", "不调用 API，返回示例数据"],
    ["其他", "手机访问", "局域网扫码访问与令牌"],
    ["其他", "用量与费用", "按天/用途/科目统计 token 与花费"],
], widths=[2.2, 6.4, 7.0])

doc.add_heading("十五、费用与用量", level=1)
p(doc, "识别一页大约 1 分钱（deepseek-chat/vision 的常规价格），一门课几十页大约几毛到一两块。"
       "「用量」面板能看到调用次数、token（含缓存命中）与折算金额，按天出折线图。")
bullet(doc, "省钱做法：识别时并发 1、不需要时关掉严格校对；整理和改稿用便宜的文字模型。")
bullet(doc, "遇到 429/5xx：程序会自动退避重试并转单线程，等一会儿再继续即可。")

# ---------------- 十六 ----------------
doc.add_heading("十六、常见问题", level=1)
table(doc, [
    ["现象", "处理"],
    ["双击 启动.bat 窗口一闪就关", "没装 Node.js 18+，按窗口提示安装后重试"],
    ["浏览器打不开 127.0.0.1:8713", "看命令行窗口打印的实际端口（可能已顺延）；或先运行 停止.bat 再启动"],
    ["识别报「Key 不匹配 / 401」", "设置里重新粘贴 Key，点「测试」；注意不要带空格"],
    ["识别报「模型不支持图片」", "识别模型选错了，换成能读图的模型"],
    ["识别报 429 / 5xx", "限流：程序自动重试；把并发数设为 1，或稍后再试"],
    ["某些页识别成乱码/漏内容", "拍照时避开反光、尽量正对；对关键页打开「严格校对」重跑一次"],
    ["图片显示不出来", "确认 data/images 里还有文件；恢复旧备份可能缺图，重新上传该页即可"],
    ["手机上装 APK 被拦", "选「仍然安装」；或在 Play Protect 里关闭应用扫描后再装"],
    ["手机扫码打不开", "同一 WiFi、防火墙允许访问；校园网常隔离设备，换热点试"],
    ["想换电脑", "旧电脑导出完整备份 → 新电脑从备份恢复"],
], widths=[5.2, 10.4])

doc.add_heading("十七、数据与隐私", level=1)
bullet(doc, "笔记、课件图片、设置、用量都存在本机（电脑是项目目录下的 data/，手机是应用私有目录）。")
bullet(doc, "只有课件截图和文字会发送给模型服务商；不经过本项目作者的服务器（本项目没有服务器）。")
bullet(doc, "API Key 保存在本机，界面上不回显明文。")
bullet(doc, "卸载手机 App 会删除数据；覆盖安装同签名 APK 会保留数据。")

p(doc, "本手册对应版本 v2.9.10；界面文字在后续版本可能有微调，以实际界面为准。最新版本与更新记录见 CHANGELOG.md。",
  size=8.5, color=MUTED, indent=False)

doc.save(OUT)
print("saved:", OUT, os.path.getsize(OUT))
d2 = Document(OUT)
print("段落:", len(d2.paragraphs), "| 表格:", len(d2.tables), "| 图片:", len(d2.inline_shapes))
