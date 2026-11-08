# Builds the read-only mirror of the reels tracker from the live Netlify site.
import json, os, re, urllib.request

SRC = "https://olga-reels-tracker.netlify.app"

def get(path):
    with urllib.request.urlopen(SRC + path, timeout=60) as r:
        return r.read()

state = json.loads(get("/api/state"))
with open("state.json", "w", encoding="utf-8") as f:
    json.dump(state, f, ensure_ascii=False)

os.makedirs("thumbs", exist_ok=True)
ids = [x["id"] for r in state.get("reels", {}).values() for x in r.get("items", []) if x.get("th")]
ids += [x["id"] for x in (state.get("meta") or {}).get("unmatched", []) if x.get("th")]
for i in ids:
    if not re.fullmatch(r"[0-9a-f-]{8,64}", i):
        continue
    p = f"thumbs/{i}.jpg"
    if os.path.exists(p):
        continue
    try:
        data = get("/api/thumb/" + i)
        if data[:2] == b"\xff\xd8":
            open(p, "wb").write(data)
    except Exception as e:
        print("thumb failed", i, e)

html = open(os.environ["SRC_HTML"], encoding="utf-8").read() if os.environ.get("SRC_HTML") else get("/").decode("utf-8")
subs = [
    ("const API='/api/state';", "const API='state.json';"),
    ("im.src='/api/thumb/'+encodeURIComponent(x.id);", "im.src='thumbs/'+encodeURIComponent(x.id)+'.jpg';"),
    ("canWrite=true; loaded=true;", "canWrite=false; loaded=true;"),
    ("body.appendChild(row); box.appendChild(body);", "body.appendChild(row);} box.appendChild(body);"),
    ("const row=el('div','btnrow'); const e=el('button','pill','Изменить');", "if(canWrite){const row=el('div','btnrow'); const e=el('button','pill','Изменить');"),
]
for a, b in subs:
    if a not in html:
        raise SystemExit("page changed, missing: " + a)
    html = html.replace(a, b)
open("index.html", "w", encoding="utf-8").write(html)
print("ok", len(ids), "thumbs")
