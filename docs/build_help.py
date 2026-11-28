# -*- coding: utf-8 -*-
"""生成手机优先的离线帮助页 public/help.html
   来源：docs/用户手册.html（结构：h1/h2/p/ul/ol/figure/table）
   - 表格改成「卡片行」，避免任何横向溢出
   - 图片缩到 900px、JPEG 内联，离线可看
"""
import base64
import io
import os
import re
from urllib.parse import unquote

from lxml import html as LH
from PIL import Image

ROOT = r"D:\dshwork\课件知识点助手"
SRC = os.environ.get("MANUAL_HTML") or os.path.join(ROOT, "docs", "用户手册.html")
OUT = os.environ.get("HELP_OUT") or os.path.join(ROOT, "public", "help.html")
SHOT = os.path.join(ROOT, "截图")

doc = LH.parse(SRC).getroot()
body = doc.find("body")

img_cache = {}


def img_data(src):
    name = os.path.basename(unquote(src or ""))
    if name in img_cache:
        return img_cache[name]
    path = os.path.join(SHOT, name)
    if not os.path.exists(path):
        img_cache[name] = None
        return None
    im = Image.open(path).convert("RGB")
    if im.width > 900:
        im = im.resize((900, round(im.height * 900 / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=82, optimize=True)
    data = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    img_cache[name] = data
    return data


def esc(t):
    return (t or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


parts = []


def walk(el):
    for child in el:
        tag = child.tag if isinstance(child.tag, str) else None
        if tag in ("h1", "h2", "h3"):
            lvl = tag[1]
            parts.append("<h%s>%s</h%s>" % (lvl, esc(child.text_content().strip()), lvl))
        elif tag == "p":
            txt = child.text_content().strip()
            if txt:
                parts.append("<p>%s</p>" % esc(txt))
        elif tag in ("ul", "ol"):
            items = "".join("<li>%s</li>" % esc(li.text_content().strip()) for li in child if li.tag == "li")
            parts.append("<%s>%s</%s>" % (tag, items, tag))
        elif tag == "figure":
            img = child.find(".//img")
            cap = child.find(".//figcaption")
            if img is not None:
                data = img_data(img.get("src"))
                if data:
                    cls = "phone" if "phone" in (child.get("class") or "") else ""
                    parts.append(
                        '<figure class="%s"><img src="%s" alt="">%s</figure>'
                        % (cls, data, "<figcaption>%s</figcaption>" % esc(cap.text_content().strip()) if cap is not None else "")
                    )
        elif tag == "table":
            rows = child.findall(".//tr")
            if not rows:
                continue
            head = [th.text_content().strip() for th in rows[0].findall("th")]
            cards = []
            for tr in rows[1:]:
                cells = [td.text_content().strip() for td in tr.findall("td")]
                if not cells:
                    continue
                key = cells[0]
                rest = cells[1:] if len(cells) > 1 else [""]
                cards.append(
                    '<div class="row"><div class="k">%s</div>%s</div>'
                    % (esc(key), "".join('<div class="v">%s</div>' % esc(c) for c in rest))
                )
            if cards:
                parts.append('<div class="cards">%s</div>' % "".join(cards))
        elif tag == "section":
            walk(child)
        elif tag == "div":
            walk(child)


walk(body)

CSS = """
:root { --ink:#1f2421; --ink2:#4b463d; --muted:#6e7670; --line:#e0d9c8; --brand:#2f5d4b; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin:0; padding:0; background:#fffdf8; color:var(--ink);
  font-family:"Microsoft YaHei","PingFang SC",sans-serif; font-size:16px; line-height:1.85; }
.topbar { position:sticky; top:0; z-index:10; display:flex; align-items:center; gap:8px;
  padding:10px 12px; background:var(--brand); color:#fff; font-size:19px; }
.topbar .t { font-weight:700; font-size:15px; }
.topbar a { color:#fff; background:rgba(255,255,255,.18); border-radius:8px; padding:6px 10px;
  font-size:13px; text-decoration:none; }
.topbar button { margin-left:auto; color:#fff; background:rgba(255,255,255,.18); border:0;
  border-radius:8px; padding:6px 10px; font-size:13px; }
main { padding: 6px 14px 40px; }
h1 { font-size:22px; color:var(--brand); margin:26px 0 10px; padding-bottom:6px; border-bottom:1px solid var(--line); }
h2 { font-size:17px; color:var(--brand); margin:20px 0 8px; }
h3 { font-size:16px; margin:16px 0 6px; }
p { margin:0 0 10px; color:var(--ink2); }
ul, ol { margin:0 0 12px; padding-left:20px; }
li { margin-bottom:6px; color:var(--ink2); }
figure { margin:12px 0 16px; }
figure img { width:100%; height:auto; border:1px solid var(--line); border-radius:8px; display:block; }
figure.phone img { width:64%; margin:0 auto; }
figcaption { font-size:13px; color:var(--muted); text-align:center; margin-top:6px; }
.cards { border:1px solid var(--line); border-radius:10px; overflow:hidden; margin:10px 0 16px; }
.cards .row { border-bottom:1px solid var(--line); padding:10px 12px; }
.cards .row:last-child { border-bottom:0; }
.cards .k { font-size:13px; color:var(--muted); margin-bottom:2px; }
.cards .v { font-size:15px; color:var(--ink2); }
@media (prefers-color-scheme: dark) {
  body { background:#15130f; color:#eae3d4; }
  p, li, .cards .v { color:#cfc7b6; }
}
"""

out = """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Make Your Notes 用户手册</title><style>%s</style></head><body>
<div class="topbar"><span class="t">用户手册</span><a href="javascript:history.back()">← 返回应用</a>
<button onclick="window.print()">打印</button></div>
<main>%s</main></body></html>""" % (CSS, "\n".join(parts))

open(OUT, "w", encoding="utf-8").write(out)
print("written:", OUT, round(os.path.getsize(OUT) / 1024, 1), "KB")
