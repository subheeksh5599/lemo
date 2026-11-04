"""Generate index.html from timing.json. Re-run after narrate.py."""
import json, pathlib

here = pathlib.Path(__file__).parent
T = json.loads((here / "timing.json").read_text())
T["scenes"][0]["duration"] += T["scenes"][0]["start"]
T["scenes"][0]["start"] = 0.0
T["scenes"][-1]["duration"] = round(T["scenes"][-1]["duration"] + 0.9, 3)
T["total"] = round(T["total"] + 0.9, 3)
S = {s["id"]: s for s in T["scenes"]}
W = {}
for l in T["lines"]:
    for w in l["words"]:
        W.setdefault((l["id"], w["w"].strip(".,").lower()), w["t"])


def at(line, word):
    return round(W[(line, word.lower())] - 0.05, 3)


def scene(sid, body):
    s = S[sid]
    return f'<section id="sc-{sid}" class="clip scene" data-start="{s["start"]}" data-duration="{s["duration"]}" data-track-index="0">{body}</section>'


rooms = scene("rooms", """
<p class="tag">Portaldot V3</p>
<div class="pair">
  <div class="room" id="r-native"><p class="eyebrow">Native runtime</p><h2>Title record</h2>
    <dl id="r-ndl"><div><dt>owner</dt><dd>5GEX…tiVx</dd></div><div><dt>pallet</dt><dd>nfts</dd></div><div><dt>item</dt><dd>12 / 0</dd></div></dl></div>
  <div class="wall" id="r-wall"><span>no shared storage</span></div>
  <div class="room" id="r-evm"><p class="eyebrow">Revive EVM</p><h2>ERC-20 balances</h2>
    <dl><div><dt>token</dt><dd>LNT</dd></div><div><dt>supply</dt><dd>1,000</dd></div><div><dt>language</dt><dd>Solidity</dd></div></dl></div>
</div>""")

gap = scene("gap", """
<div class="pair">
  <div class="room" id="g-native"><p class="eyebrow">Native runtime</p><h2>Title record</h2><p class="state" id="g-gone">burned</p></div>
  <div class="room wide" id="g-evm"><p class="eyebrow">Revive EVM</p><h2>Still trading</h2>
    <ol class="txs"><li id="g-t1">transfer 400 LNT <b>ok</b></li><li id="g-t2">transfer 250 LNT <b>ok</b></li><li id="g-t3">transfer 100 LNT <b>ok</b></li></ol></div>
</div>""")

name = scene("name", """
<div class="hero"><h1 id="n-word">LEMO</h1><p id="n-sub">The token obeys the native title.</p></div>""")

how = scene("how", """
<div class="flow">
  <div class="node" id="h-v"><p class="eyebrow">BEEFY validators</p><h3>2 of 2 signed</h3><p class="mono">secp256k1, checked by ecrecover</p></div>
  <div class="arrow" id="h-a1"></div>
  <div class="node" id="h-r"><p class="eyebrow">BeefyRootFeed</p><h3>State root</h3><p class="mono">of block #321,129</p></div>
  <div class="arrow" id="h-a2"></div>
  <div class="node" id="h-t"><p class="eyebrow">NativeTitleToken</p><h3 id="h-proof">Proof: <span class="ok">PROVEN</span></h3><p class="mono" id="h-mint">mint 1,000 LNT</p>
    <p class="chip bad" id="h-frozen">FROZEN</p></div>
</div>
<div class="burn" id="h-burn"><span class="eyebrow">native</span> nfts.burn(12, 0)</div>""")

live = scene("live", """
<div class="hero left"><h2>Live on public Portaldot V3</h2>
  <ul class="facts"><li id="l1"><span>BeefyRootFeed</span><b>0x0ec2…6937</b></li><li id="l2"><span>NativeTitleToken</span><b>0xbfe3…c4d4</b></li><li id="l3"><span>Try it</span><b>lemo-ebon.vercel.app</b></li></ul></div>""")

audio = "\n".join(
    f'<audio id="vo-{l["id"]}" class="clip" src="{l["file"]}" data-start="{l["start"]}" data-duration="{l["dur"]}" data-track-index="{1 + k % 2}"></audio>'
    for k, l in enumerate(T["lines"])
)

tweens = f"""
const tl = gsap.timeline({{ paused: true }});
const E = "power3.out";
// rooms
tl.fromTo("#r-ndl", {{opacity:0, y:12}}, {{opacity:1, y:0, duration:0.5, ease:E}}, {at('a1','two')});
tl.fromTo("#r-native", {{borderColor:"#273446"}}, {{borderColor:"#3a4a61", duration:0.4}}, {at('a1','native')});
tl.fromTo("#r-evm", {{opacity:0, y:24}}, {{opacity:1, y:0, duration:0.6, ease:E}}, {at('a1','solidity')});
tl.fromTo("#r-wall", {{opacity:0, scaleY:0}}, {{opacity:1, scaleY:1, duration:0.5, ease:E}}, {at('a2','no')});
// gap
tl.fromTo("#g-native", {{opacity:0}}, {{opacity:1, duration:0.4}}, {S['gap']['start'] + 0.05});
tl.fromTo("#g-evm", {{opacity:0}}, {{opacity:1, duration:0.4}}, {S['gap']['start'] + 0.05});
tl.fromTo("#g-t1", {{opacity:0, x:-16}}, {{opacity:1, x:0, duration:0.35, ease:E}}, {at('b1','trading')});
tl.fromTo("#g-t2", {{opacity:0, x:-16}}, {{opacity:1, x:0, duration:0.35, ease:E}}, {at('b1','after')});
tl.fromTo("#g-gone", {{opacity:0, scale:1.2}}, {{opacity:1, scale:1, duration:0.35, ease:E}}, {at('b1','title')});
tl.fromTo("#g-t3", {{opacity:0, x:-16}}, {{opacity:1, x:0, duration:0.35, ease:E}}, {at('b1','behind')});
// name
tl.fromTo("#n-word", {{opacity:0, y:30}}, {{opacity:1, y:0, duration:0.7, ease:E}}, {at('c1','lemo')});
tl.fromTo("#n-sub", {{opacity:0}}, {{opacity:1, duration:0.6}}, {at('c1','obey')});
// how
tl.fromTo("#h-v", {{opacity:0, y:20}}, {{opacity:1, y:0, duration:0.5, ease:E}}, {at('d1','validators')});
tl.fromTo("#h-a1", {{scaleX:0}}, {{scaleX:1, duration:0.4, ease:E}}, {at('d1','sign')});
tl.fromTo("#h-r", {{opacity:0, y:20}}, {{opacity:1, y:0, duration:0.5, ease:E}}, {at('d1','root')});
tl.fromTo("#h-a2", {{scaleX:0}}, {{scaleX:1, duration:0.4, ease:E}}, {at('d2','contract')});
tl.fromTo("#h-t", {{opacity:0, y:20}}, {{opacity:1, y:0, duration:0.5, ease:E}}, {at('d2','proves')});
tl.fromTo("#h-mint", {{opacity:0}}, {{opacity:1, duration:0.4}}, {at('d2','mints')});
tl.fromTo("#h-burn", {{opacity:0, y:16}}, {{opacity:1, y:0, duration:0.45, ease:E}}, {at('d3','burn')});
tl.fromTo("#h-frozen", {{opacity:0, scale:1.25}}, {{opacity:1, scale:1, duration:0.35, ease:E}}, {at('d3','freezes')});
tl.to("#h-mint", {{opacity:0.35, duration:0.3}}, {at('d3','freezes')});
// live
tl.fromTo("#l1", {{opacity:0, y:12}}, {{opacity:1, y:0, duration:0.45, ease:E}}, {at('e1','live')});
tl.fromTo("#l2", {{opacity:0, y:12}}, {{opacity:1, y:0, duration:0.45, ease:E}}, {at('e1','public')});
tl.fromTo("#l3", {{opacity:0, y:12}}, {{opacity:1, y:0, duration:0.45, ease:E}}, {at('e1','here')});
window.__timelines["main"] = tl;
tl.seek(0);
"""

html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1920, height=1080" />
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
<style>
@font-face {{ font-family: "Instrument Sans"; src: url("assets/fonts/InstrumentSans.woff2") format("woff2"); font-weight: 400 700; }}
@font-face {{ font-family: "Plex Mono"; src: url("assets/fonts/PlexMono-400.woff2") format("woff2"); font-weight: 400; }}
@font-face {{ font-family: "Plex Mono"; src: url("assets/fonts/PlexMono-500.woff2") format("woff2"); font-weight: 500; }}
:root {{ --canvas:#070b12; --surface:#0b111b; --raised:#111927; --line:#1a2433; --line-strong:#273446; --ink:#eef2f8; --ink2:#bac5d5; --muted:#8b97a8; --accent:#2f6bff; --accent-bright:#6d95ff; --ok:#2fd6a3; --bad:#ff6157; }}
* {{ margin:0; padding:0; box-sizing:border-box; }}
html, body {{ width:1920px; height:1080px; overflow:hidden; background:var(--canvas); }}
#root {{ width:1920px; height:1080px; position:relative; font-family:"Instrument Sans", sans-serif; color:var(--ink); }}
.tag {{ position:absolute; top:80px; left:160px; font-family:"Plex Mono", monospace; font-size:28px; color:var(--accent-bright); }}
.scene {{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding:0 160px; }}
.eyebrow {{ font-family:"Plex Mono", monospace; font-size:28px; color:var(--muted); }}
.mono {{ font-family:"Plex Mono", monospace; font-size:30px; color:var(--ink2); margin-top:16px; }}
h1 {{ font-size:220px; font-weight:500; letter-spacing:-0.04em; line-height:1; }}
h2 {{ font-size:64px; font-weight:500; letter-spacing:-0.02em; margin-top:12px; }}
h3 {{ font-size:52px; font-weight:500; letter-spacing:-0.015em; margin-top:12px; }}
.pair {{ display:flex; align-items:stretch; gap:48px; width:100%; }}
.room {{ flex:1; background:var(--surface); border:2px solid var(--line-strong); border-radius:20px; padding:48px; }}
.room dl {{ margin-top:36px; display:grid; gap:18px; }}
.room dl div {{ display:flex; justify-content:space-between; font-family:"Plex Mono", monospace; font-size:32px; }}
.room dt {{ color:var(--muted); }} .room dd {{ color:var(--ink); }}
.wall {{ width:4px; background:repeating-linear-gradient(var(--bad) 0 18px, transparent 18px 32px); position:relative; transform-origin:center; }}
.wall span {{ position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-90deg); white-space:nowrap; font-family:"Plex Mono", monospace; font-size:28px; color:var(--bad); background:var(--canvas); padding:6px 14px; }}
.state {{ margin-top:40px; display:inline-block; font-family:"Plex Mono", monospace; font-size:40px; color:var(--bad); border:2px solid var(--bad); border-radius:10px; padding:8px 20px; }}
.room.wide {{ flex:1.4; }}
.txs {{ list-style:none; margin-top:32px; display:grid; gap:16px; }}
.txs li {{ font-family:"Plex Mono", monospace; font-size:34px; display:flex; justify-content:space-between; background:var(--raised); border-radius:10px; padding:16px 24px; }}
.txs b {{ color:var(--ok); font-weight:500; }}
.hero {{ text-align:center; }}
.hero p#n-sub {{ font-size:56px; color:var(--ink2); margin-top:32px; }}
.hero.left {{ text-align:left; width:100%; }}
.facts {{ list-style:none; margin-top:40px; display:grid; gap:20px; }}
.facts li {{ display:flex; justify-content:space-between; align-items:baseline; border-bottom:2px solid var(--line); padding-bottom:20px; }}
.facts span {{ font-size:48px; color:var(--ink2); }}
.facts b {{ font-family:"Plex Mono", monospace; font-weight:500; font-size:48px; color:var(--accent-bright); }}
.flow {{ display:flex; align-items:center; width:100%; }}
.node {{ flex:1; min-width:0; background:var(--surface); border:2px solid var(--line-strong); border-radius:20px; padding:40px; min-height:330px; position:relative; }}
.arrow {{ width:72px; height:4px; background:var(--accent); transform-origin:left center; margin:0 12px; }}
.ok {{ color:var(--ok); }}
.chip {{ display:inline-block; margin-top:20px; font-family:"Plex Mono", monospace; font-size:28px; border-radius:8px; padding:4px 14px; }}
.chip.bad {{ color:var(--bad); border:2px solid var(--bad); }}
.burn {{ position:absolute; bottom:150px; right:160px; font-family:"Plex Mono", monospace; font-size:34px; color:var(--bad); background:var(--surface); border:2px solid var(--bad); border-radius:12px; padding:14px 26px; }}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="{T['total']}" data-fps="30" data-width="1920" data-height="1080">
{rooms}
{gap}
{name}
{how}
{live}
{audio}
</div>
<script>{tweens}</script>
</body>
</html>
"""
(here / "index.html").write_text(html)
print("wrote index.html, total", T["total"])
