# 🕹️ Cyber Dancer

A browser-based, neon cyberpunk rhythm game. Drop in **any song from your own device**, and the game automatically analyzes the audio and builds a playable note chart for you — no pre-made song packs required.

Built with plain HTML5 Canvas + JavaScript. No build step, no dependencies, no install — just open `index.html` and play.

![Genre](https://img.shields.io/badge/genre-rhythm-ff2f9e) ![Platform](https://img.shields.io/badge/platform-browser-20e8ff) ![Stack](https://img.shields.io/badge/stack-vanilla%20JS-8d3cff)

---

## ✨ Features

- **Play any song you own** — upload an MP3/audio file and the game auto-detects BPM and generates a beatmap on the fly using onset/beat analysis.
- **4-lane arcade-style gameplay** with glowing neon block arrows, hold notes, and double notes.
- **3 difficulty levels**
  | Difficulty | Nickname | Notes |
  |---|---|---|
  | Easy | Crew | Fewer notes, no holds, no doubles |
  | Medium | Manager | Holds + occasional doubles |
  | Hard | Boss | Dense charts, frequent holds & doubles |
- **Judgment system** — PERFECT / GOOD / SYSTEM MISS timing windows with score, combo, and max-combo tracking.
- **Post-song results screen** — accuracy, combo %, and an overall rating.
- **Remappable controls** — rebind each of the 4 lanes to any key (defaults to `A`, `S`, `K`, `L`).
- **Pause menu** and full run stats.
- **Fully responsive** neon/cyberpunk visual theme, styled with CSS custom properties.

## 🎮 How to Play

1. Open `index.html` in a modern browser (Chrome/Edge/Firefox recommended).
2. Upload an audio file from your device using the file picker on the menu screen.
3. Pick a difficulty (Crew / Manager / Boss).
4. Hit the arrows as they cross the judgment line, in time with the beat, using your keybinds.
5. Hold notes need to be held down for their full duration — release early and it counts as a miss.
6. Check your score, combo, and rating on the results screen when the track ends.

### Default Controls

| Lane | Key |
|---|---|
| Lane 1 | `A` |
| Lane 2 | `S` |
| Lane 3 | `K` |
| Lane 4 | `L` |

All four keys are rebindable from the in-game keybind menu.

## 📦 Project Structure

```
.
├── index.html   # Page structure / markup only
├── style.css    # All visual styling (neon theme, layout, animations)
└── game.js      # Game logic (audio analysis, chart generation, input, rendering, scoring)
```

The three files must stay in the same folder — `index.html` links to the other two by relative path.

## 🚀 Running Locally

No build tools or servers required for basic use:

```bash
git clone https://github.com/<your-username>/cyber-dancer.git
cd cyber-dancer
open index.html   # or just double-click the file
```

> **Note:** Some browsers restrict local file access for the Web Audio API. If audio upload/analysis doesn't work when opening the file directly, serve it locally instead:
> ```bash
> python3 -m http.server 8000
> ```
> then visit `http://localhost:8000`.

## 🛠️ Tech Notes

- Chart generation is done client-side by analyzing the decoded `AudioBuffer` for volume/onset peaks and estimating BPM from the intervals between them — no external beatmap files or song database needed.
- All rendering is done on a single `<canvas>` element (arrows, receptors, hold tails, judgment text, combo counter).
- No frameworks, no bundler, no npm install — just static files.

## 🤝 Contributing

Issues and pull requests are welcome — whether it's chart-generation tuning, new visual themes, mobile touch support, or bug fixes.

## 📄 License

Add your preferred license here (e.g. MIT) before publishing.
