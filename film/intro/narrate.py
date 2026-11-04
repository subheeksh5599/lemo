"""Synthesize the intro narration with word timings, then lay out scene timing.

Writes assets/vo/<id>.mp3, assets/vo/<id>.words.json and timing.json.
Run with ~/.local/venvs/tts/bin/python.
"""
import asyncio, json, pathlib, subprocess

import edge_tts

VOICE = "en-US-AndrewMultilingualNeural"
LINES = [
    ("a1", "rooms", "Portaldot V3 runs two worlds side by side. Native assets live in one, Solidity tokens in the other."),
    ("a2", "rooms", "They share no storage."),
    ("b1", "gap", "So a token can keep trading after the native title behind it is gone."),
    ("c1", "name", "LEMO makes the token obey the native title."),
    ("d1", "how", "The validators sign the state root."),
    ("d2", "how", "The contract proves your native title under that root before it mints."),
    ("d3", "how", "Burn the title natively, and the token freezes."),
    ("e1", "live", "All of it is live on public Portaldot. Here it is."),
]

here = pathlib.Path(__file__).parent
vo = here / "assets" / "vo"
vo.mkdir(parents=True, exist_ok=True)


async def synth(i, text):
    for attempt in range(6):
        words = []
        mp3 = vo / f"{i}.mp3"
        mp3.unlink(missing_ok=True)
        c = edge_tts.Communicate(text, VOICE, rate="+0%", boundary="WordBoundary")
        try:
            with open(mp3, "wb") as f:
                async for chunk in c.stream():
                    if chunk["type"] == "audio":
                        f.write(chunk["data"])
                    elif chunk["type"] == "WordBoundary":
                        words.append({"w": chunk["text"], "t": chunk["offset"] / 1e7, "d": chunk["duration"] / 1e7})
        except edge_tts.exceptions.NoAudioReceived:
            await asyncio.sleep(2 + attempt * 2)
            continue
        if mp3.stat().st_size > 0 and words:
            (vo / f"{i}.words.json").write_text(json.dumps(words))
            return words
    raise SystemExit(f"synthesis failed for {i}")


def dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)]).decode())


async def main():
    timing = {"lines": [], "scenes": []}
    t = 0.6
    prev_scene = None
    for i, scene, text in LINES:
        words = await synth(i, text)
        speech_end = words[-1]["t"] + words[-1]["d"]
        if prev_scene is not None and scene != prev_scene:
            t += 0.9  # breath across a scene change
        if prev_scene is None or scene != prev_scene:
            timing["scenes"].append({"id": scene, "start": round(max(0, t - 0.4), 3)})
        timing["lines"].append({"id": i, "scene": scene, "text": text, "start": round(t, 3), "file": f"assets/vo/{i}.mp3", "dur": round(dur(vo / f"{i}.mp3"), 3), "words": [{**w, "t": round(t + w["t"], 3)} for w in words]})
        t += speech_end + 0.45
        prev_scene = scene
    total = round(t + 1.0, 3)
    for k, s in enumerate(timing["scenes"]):
        end = timing["scenes"][k + 1]["start"] if k + 1 < len(timing["scenes"]) else total
        s["duration"] = round(end - s["start"], 3)
    timing["total"] = total
    (here / "timing.json").write_text(json.dumps(timing, indent=1))
    for l in timing["lines"]:
        print(f'{l["start"]:6.2f} {l["scene"]:6} {l["id"]} {l["text"]}')
    for s in timing["scenes"]:
        print("scene", s)
    print("total", total)


asyncio.run(main())
