# -*- coding: utf-8 -*-
"""把《用户手册》拆成电脑版 / 手机版两个 HTML（删掉对方平台的章节，改写平台相关文案）"""
import copy
import os
import sys

from lxml import html as LH

ROOT = r"D:\dshwork\课件知识点助手"
SRC = os.path.join(ROOT, "docs", "用户手册.html")

PLATFORM = sys.argv[1] if len(sys.argv) > 1 else "pc"
OUT = os.path.join(ROOT, "docs", "用户手册-%s.html" % ("电脑版" if PLATFORM == "pc" else "手机版"))

doc = LH.parse(SRC)
root = doc.getroot()
body = root.find("body")


def text_of(el):
    return (el.text_content() or "").strip()


def remove_until_next_heading(el):
    """删除 el 本身以及其后所有兄弟节点，直到遇到同级或更高级标题"""
    lvl = int(el.tag[1])
    parent = el.getparent()
    kids = list(parent)
    i = kids.index(el)
    to_remove = [el]
    for nxt in kids[i + 1:]:
        if isinstance(nxt.tag, str) and nxt.tag in ("h1", "h2", "h3"):
            nl = int(nxt.tag[1])
            if nl <= lvl:
                break
        to_remove.append(nxt)
    for n in to_remove:
        parent.remove(n)


def find_heading(level, keyword):
    for el in body.iter("h%d" % level):
        if keyword in text_of(el):
            return el
    return None


def set_cover_sub(txt):
    for div in body.iter("div"):
        if "class" in div.attrib and "sub" in div.get("class").split():
            div.text = txt
            return True
    return False


if PLATFORM == "pc":
    # 去掉手机安装小节
    h = find_heading(2, "手机版（APK）")
    if h is not None:
        remove_until_next_heading(h)
    set_cover_sub("电脑版 · 从安装到每天用：建科目 · 传课件 · 看知识点 · 导出与备份")
else:
    # 去掉电脑安装小节
    h = find_heading(2, "电脑版（Windows）")
    if h is not None:
        remove_until_next_heading(h)
    # 去掉「在手机上用」（手机端用不到扫码访问）
    h = find_heading(1, "在手机上用")
    if h is not None:
        remove_until_next_heading(h)
    set_cover_sub("手机版 · 从装 APK 到每天用：建科目 · 拍照上传 · 看知识点 · 备份")

# 五分钟上手：按平台重写（第一条不能提 Node.js）
for h in body.iter("h2"):
    if "五分钟上手" in text_of(h):
        ol = h.getnext()
        if ol is not None and ol.tag == "ol":
            items = []
            if PLATFORM == "pc":
                items = [
                    "装 Node.js 18+，双击 启动.bat，浏览器会打开 http://127.0.0.1:8713。",
                    "照第 3 章拿一个 DeepSeek API Key，填进「设置」；没有 Key 可先开「演示模式」。",
                    "左上角「+」新建科目，写一句你的分类标准（可留空）。",
                    "「上传课件」，把上课拍的 PPT 照片拖进去，等识别完成。",
                    "看「知识点」「分类」，用「导出」带走 Markdown，用「完整备份」留底。",
                ]
            else:
                items = [
                    "装 MakeYourNotes 的 APK（第 2 章），点开就能用——不需要 Node.js，也不需要电脑。",
                    "照第 3 章拿一个 DeepSeek API Key，填进「设置」；没有 Key 可先开「演示模式」。",
                    "点「+」新建科目，写一句分类标准（可留空）。",
                    "「上传课件」→ 从相册选课件照片，或直接拍照，等识别完成。",
                    "在「知识点」「分类」里翻看；换手机前用「完整备份」留底。",
                ]
            # 重建 ol
            parent = ol.getparent()
            idx = list(parent).index(ol)
            parent.remove(ol)
            new_ol = LH.Element("ol")
            for it in items:
                li = LH.Element("li")
                li.text = it
                new_ol.append(li)
            parent.insert(idx, new_ol)
        break

# 5.1 三种上传方式：删掉对方平台的条目
for h in body.iter("h2"):
    if "三种上传方式" in text_of(h):
        ul = h.getnext()
        if ul is not None and ul.tag == "ul":
            for li in list(ul):
                t = text_of(li)
                if PLATFORM == "pc" and "手机" in t and "电脑" not in t:
                    ul.remove(li)
                if PLATFORM == "phone" and t.startswith("电脑"):
                    ul.remove(li)
            # 手机版补一条拍照
            if PLATFORM == "phone":
                li = LH.Element("li")
                li.text = "拍照：点「上传课件」后选相机，直接拍课本或黑板也行。"
                ul.append(li)
        break

# 标题与页脚
for h in body.iter("h1"):
    if text_of(h).startswith("二、安装与启动"):
        h.text = "二、安装与启动（%s）" % ("电脑版" if PLATFORM == "pc" else "手机版")
    if PLATFORM == "phone" and text_of(h).startswith("十三、"):
        h.text = "十三、备份与换手机"

# 手机版：强调不需要 Node.js / 电脑
if PLATFORM == "phone":
    for li in body.iter("li"):
        t = text_of(li)
        if "手机版不连电脑" in t:
            li.text = "手机版不连电脑、不连 WiFi（除调用模型外），数据存在手机应用私有目录；**不需要安装 Node.js，也不需要电脑**。"

# 保留下来的安装小节统一编号为 2.1
for h in body.iter("h2"):
    t = text_of(h)
    if t.startswith("2.2"):
        h.text = t.replace("2.2", "2.1", 1)

doc.write(OUT, encoding="utf-8", method="html")
print("wrote:", OUT, round(os.path.getsize(OUT) / 1024, 1), "KB")
