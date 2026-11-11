"""Heybe on Streamlit: a thin wrapper that shows the static site inside one component.

The pages, CSS and JS are bundled into a small in-browser "router" (a nested iframe whose
srcdoc is swapped on navigation). There is no server.js here, so only Ryanair prices work
(same as opening index.html as a file). Run locally: streamlit run streamlit_app.py
"""
import json
import re
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).parent
PAGES = ["index.html", "flights.html", "hotels.html"]
NAV_RE = re.compile(r"""location\.href\s*=\s*(['"])([a-z]+\.html[^'"]*)\1""")

# runs first inside every page: route clicks on local *.html links through the shell
ROUTER = """<script>
document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(!a)return;
const h=a.getAttribute('href');if(/^[a-z]+\\.html/.test(h)){e.preventDefault();parent.__go(h);}},true);
</script>"""


@st.cache_data
def bundle() -> str:
    def esc(s: str) -> str:  # safe inside a <script> block as a JSON literal
        return s.replace("</", "<\\/")

    assets = {}
    for f in (ROOT / "js").glob("*.js"):
        assets[f.name] = NAV_RE.sub(lambda m: f"parent.__go('{m.group(2)}')", f.read_text("utf-8"))
    css = (ROOT / "css" / "style.css").read_text("utf-8")

    pages = {}
    for name in PAGES:
        html = (ROOT / name).read_text("utf-8")
        html = html.replace('<link rel="stylesheet" href="css/style.css">', "<!--CSS-->")
        html = re.sub(r'<script src="js/([\w.]+)"></script>', r"<!--JS:\1-->", html)
        html = html.replace("<head>", "<head>" + ROUTER, 1)
        pages[name] = html

    return f"""<!doctype html><html><head><meta charset="utf-8">
<style>html,body{{margin:0;height:100%}}iframe{{border:0;width:100%;height:100%;display:block}}</style>
</head><body><iframe id="f"></iframe><script>
const P={esc(json.dumps(pages))}, A={esc(json.dumps(assets))}, CSS={esc(json.dumps(css))};
const S='<'+'/script>';
function build(n){{return P[n].replace('<!--CSS-->','<style>'+CSS+'</'+'style>')
  .replace(/<!--JS:([\\w.]+)-->/g,(m,k)=>'<script>'+A[k]+S);}}
window.__go=u=>{{const n=u.split('#')[0]; if(P[n]) document.getElementById('f').srcdoc=build(n);}};
__go('index.html');
</script></body></html>"""


st.set_page_config(page_title="Heybe", page_icon="🌴", layout="wide")
st.markdown(
    "<style>.block-container{padding:0.5rem 0.5rem 0;max-width:100%}"
    "header[data-testid='stHeader']{display:none}</style>",
    unsafe_allow_html=True,
)
st.caption("🧪 Test sürümü: sadece Ryanair fiyatları (Travelpayouts/SerpApi proxy'si Streamlit'te yok).")
st.iframe(bundle(), height=1100)
