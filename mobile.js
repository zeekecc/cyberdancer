// ============================================================
// Cyber Dancer — Mobile Engine
// Same rules/theme as desktop, rebuilt for steady 60fps on phones:
//  - no backdrop-filter / DOM blur behind the live canvas
//  - background + lane grid pre-rendered once to an offscreen layer
//  - resolved notes are skipped via a moving start pointer instead
//    of being re-checked every frame for the whole song
//  - HUD bars animate with transform (compositor-only), not width
//  - non-critical HUD text is throttled instead of updated per-frame
//  - canvas created with {alpha:false, desynchronized:true}
// ============================================================

const menu = document.getElementById('menu');
const resultsScreen = document.getElementById('results-screen');
const pauseScreen = document.getElementById('pause-screen');
const fileInput = document.getElementById('audioFile');
const startBtn = document.getElementById('startBtn');
const menuBtn = document.getElementById('menuBtn');
const resumeBtn = document.getElementById('resumeBtn');
const quitBtn = document.getElementById('quitBtn');
const gameContainer = document.getElementById('game-container');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
const songMetadataBox = document.getElementById('song-metadata');
const bgVideo = document.getElementById('bg-video');

const hudPauseBtn = document.getElementById('hudPauseBtn');
const hudFullscreenBtn = document.getElementById('hudFullscreenBtn');
const menuFullscreenBtn = document.getElementById('menuFullscreenBtn');
const hudLifeFill = document.getElementById('hudLifeFill');
const hudScore = document.getElementById('hudScore');
const hudCombo = document.getElementById('hudCombo');
const hudProgressFill = document.getElementById('hudProgressFill');
const hudTimeLeft = document.getElementById('hudTimeLeft');

let audioCtx = null;
let audioBuffer = null;
let audioSource = null;
let songStartTime = 0;
let isPlaying = false;
let isPaused = false;
let pauseStartTime = 0;
let totalPausedTime = 0;
let gamePhase = 'menu';
let phaseStartTime = 0;
let lastCountdownSecond = -1;
let notes = [];
let noteStartIndex = 0; // moving window: everything before this is fully resolved
let score = 0;
let combo = 0;
let comboAnim = 0;
let playerLife = 100;
let feedbackText = "";
let feedbackTimer = 0;
let estimatedBPM = 120;
let stats = { perfect: 0, good: 0, miss: 0, maxCombo: 0 };
let currentTrackMeta = { artist: "Unknown", title: "Unknown Track" };

const LANE_COUNT = 4;
let LANE_WIDTH = 0;
let RECEPTOR_Y = 0; // near the BOTTOM of the screen on mobile, thumb-reachable
const BOTTOM_MARGIN_CSS = 100; // css px kept clear below the receptor
let difficultySetting = 'medium';
let speedMultiplier = 3;
let scrollSpeed = 1200;
let pressedLanes = [false, false, false, false];
let touchLaneMap = {}; // touch identifier -> lane currently under that finger

const ARROW_COLORS = ['#00FFFF', '#B026FF', '#FF00FF', '#00FFFF'];

let staticLayer = null; // pre-rendered background + lane separators
let staticCtx = null;
let hudThrottleAcc = 0;

function playBeep(freq, duration, type = 'sine') {
  if (!audioCtx) return;
  try {
    let osc = audioCtx.createOscillator();
    let gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {}
}

function pseudoRandom(seed) {
  let x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function estimateBPM(buffer) {
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const blockSize = Math.floor(sampleRate * 0.05);
  const peaks = [];
  let maxEnergy = 0;
  for (let i = 0; i < data.length; i += blockSize) {
    let sum = 0;
    for (let j = 0; j < blockSize && (i + j) < data.length; j++) {
      sum += data[i + j] * data[i + j];
    }
    let energy = Math.sqrt(sum / blockSize);
    if (energy > maxEnergy) maxEnergy = energy;
    peaks.push({ energy: energy });
  }
  const threshold = maxEnergy * 0.4;
  const peakTimes = [];
  for (let i = 1; i < peaks.length - 1; i++) {
    if (peaks[i].energy > threshold && peaks[i].energy > peaks[i - 1].energy && peaks[i].energy > peaks[i + 1].energy) {
      peakTimes.push(i * 0.05);
    }
  }
  const intervals = [];
  for (let i = 1; i < peakTimes.length; i++) {
    const diff = peakTimes[i] - peakTimes[i - 1];
    if (diff > 0.3 && diff < 1.5) intervals.push(diff);
  }
  if (intervals.length === 0) return 120;
  intervals.sort((a, b) => a - b);
  const medianInterval = intervals[Math.floor(intervals.length / 2)];
  let bpm = Math.round(60 / medianInterval);
  while (bpm < 80) bpm *= 2;
  while (bpm > 180) bpm = Math.round(bpm / 2);
  return bpm;
}

document.querySelectorAll('#difficulty-container .selector-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (gamePhase !== 'menu') return;
    document.querySelectorAll('#difficulty-container .selector-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    difficultySetting = btn.getAttribute('data-diff');
    document.getElementById('metaDiff').innerText = difficultySetting === 'easy' ? 'Crew' : (difficultySetting === 'medium' ? 'Manager' : 'Boss');
    if (audioBuffer) {
      notes = autoGenerateChart(audioBuffer, difficultySetting);
      document.getElementById('metaNotes').innerText = notes.length;
    }
  });
});

document.querySelectorAll('#speed-container .selector-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (gamePhase !== 'menu') return;
    document.querySelectorAll('#speed-container .selector-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    speedMultiplier = parseInt(btn.getAttribute('data-speed'));
    scrollSpeed = speedMultiplier * 400;
  });
});

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  startBtn.innerText = "PROCESSING AUDIO...";
  startBtn.disabled = true;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    audioBuffer = await Promise.race([
      audioCtx.decodeAudioData(arrayBuffer),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 10000))
    ]);
    const cleanName = file.name.replace(/\.[^/.]+$/, "");
    const parts = cleanName.split('-');
    if (parts.length > 1) {
      currentTrackMeta.artist = parts[0].trim();
      currentTrackMeta.title = parts.slice(1).join('-').trim();
    } else {
      currentTrackMeta.artist = "Unknown Artist";
      currentTrackMeta.title = cleanName;
    }
    estimatedBPM = estimateBPM(audioBuffer);
    notes = autoGenerateChart(audioBuffer, difficultySetting);
    document.getElementById('metaArtist').innerText = currentTrackMeta.artist;
    document.getElementById('metaTitle').innerText = currentTrackMeta.title;
    document.getElementById('metaDuration').innerText = formatTime(audioBuffer.duration);
    document.getElementById('metaBpm').innerText = estimatedBPM;
    document.getElementById('metaNotes').innerText = notes.length;
    songMetadataBox.style.display = 'grid';
    startBtn.innerText = "INITIALIZE UPLINK";
    startBtn.disabled = false;
  } catch (err) {
    alert("Could not process this audio file. Please try another standard MP3 or WAV.");
    startBtn.innerText = "INITIALIZE UPLINK";
    startBtn.disabled = true;
    fileInput.value = "";
  }
});

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function autoGenerateChart(buffer, difficulty) {
  const rawData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  let generated = [];
  let threshold = difficulty === 'easy' ? 0.32 : (difficulty === 'medium' ? 0.20 : 0.12);
  let skipMultiplier = difficulty === 'easy' ? 10 : (difficulty === 'medium' ? 6 : 3);
  let holdProbability = difficulty === 'easy' ? 0.0 : (difficulty === 'medium' ? 0.12 : 0.22);
  let doubleChance = difficulty === 'easy' ? 0.0 : (difficulty === 'medium' ? 0.08 : 0.18);
  const windowSize = Math.floor(sampleRate * 0.04);
  let lastLane = -1;
  let lastDoubleTime = -999;
  let nextAllowedHitTime = 0;
  const cutoffTime = buffer.duration - 5;
  for (let i = 0; i < rawData.length;) {
    let sum = 0;
    for (let j = 0; j < windowSize && (i + j) < rawData.length; j++) {
      sum += rawData[i + j] * rawData[i + j];
    }
    let rms = Math.sqrt(sum / windowSize);
    if (rms > threshold) {
      let hitTime = i / sampleRate;
      if (hitTime < nextAllowedHitTime) { i += windowSize; continue; }
      if (hitTime >= cutoffTime) break;
      let lane = Math.floor(pseudoRandom(hitTime * 99 + i) * LANE_COUNT);
      if (lane === lastLane) lane = (lane + 1) % LANE_COUNT;
      lastLane = lane;
      let isHold = (difficulty !== 'easy') && (pseudoRandom(hitTime * 33) < holdProbability);
      let holdDur = isHold ? Number((pseudoRandom(hitTime * 77) * 0.8 + 0.4).toFixed(2)) : 0;
      generated.push({
        lane: lane,
        targetHitTime: Number(hitTime.toFixed(3)),
        isHold: isHold,
        holdDuration: holdDur,
        hit: false, holding: false, missed: false, hitAnim: 0
      });
      if (difficulty !== 'easy' && !isHold && (hitTime - lastDoubleTime) > 1.2 && pseudoRandom(hitTime * 55) < doubleChance) {
        lastDoubleTime = hitTime;
        const possible = [];
        for (let l = 0; l < LANE_COUNT; l++) if (l !== lane) possible.push(l);
        let secondLane = possible[Math.floor(pseudoRandom(hitTime * 73) * possible.length)];
        generated.push({
          lane: secondLane, targetHitTime: Number(hitTime.toFixed(3)),
          isHold: false, holdDuration: 0, hit: false, holding: false, missed: false, hitAnim: 0
        });
      }
      nextAllowedHitTime = isHold ? (hitTime + holdDur + 0.35) : (hitTime + 0.12);
      i += windowSize * skipMultiplier;
    } else {
      i += windowSize;
    }
  }
  return generated;
}

// ---------- Canvas sizing (dpr-capped) + static layer caching ----------

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, rect.width);
  const cssH = Math.max(1, rect.height);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  LANE_WIDTH = canvas.width / LANE_COUNT;
  RECEPTOR_Y = canvas.height - BOTTOM_MARGIN_CSS * dpr;
  drawArcadeArrow.cache = {}; // dimensions changed, old cached bitmaps are stale
  buildStaticLayer();
}

function buildStaticLayer() {
  if (!staticLayer) staticLayer = document.createElement('canvas');
  staticLayer.width = canvas.width;
  staticLayer.height = canvas.height;
  staticCtx = staticLayer.getContext('2d', { alpha: false });
  let grad = staticCtx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, 'rgb(32, 26, 52)');
  grad.addColorStop(1, 'rgb(14, 13, 24)');
  staticCtx.fillStyle = grad;
  staticCtx.fillRect(0, 0, canvas.width, canvas.height);
  staticCtx.strokeStyle = 'rgba(32, 232, 255, 0.28)';
  staticCtx.setLineDash([10, 15]);
  staticCtx.lineWidth = 1.5;
  for (let i = 1; i < LANE_COUNT; i++) {
    let xPos = i * LANE_WIDTH;
    staticCtx.beginPath();
    staticCtx.moveTo(xPos, 0);
    staticCtx.lineTo(xPos, canvas.height);
    staticCtx.stroke();
  }
  staticCtx.setLineDash([]);
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resizeCanvas, 150);
});
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 200));

// ---------- Fullscreen ----------

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function toggleFullscreen() {
  try {
    if (!isFullscreen()) {
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
  } catch (e) {}
}

function syncFullscreenIcons() {
  const label = isFullscreen() ? '⤢' : '⛶';
  if (hudFullscreenBtn) hudFullscreenBtn.innerText = label;
  if (menuFullscreenBtn) menuFullscreenBtn.innerText = isFullscreen() ? '⤢ EXIT FULLSCREEN' : '⛶ ENTER FULLSCREEN';
}

document.addEventListener('fullscreenchange', () => { syncFullscreenIcons(); setTimeout(resizeCanvas, 100); });
document.addEventListener('webkitfullscreenchange', () => { syncFullscreenIcons(); setTimeout(resizeCanvas, 100); });

if (hudFullscreenBtn) hudFullscreenBtn.addEventListener('click', toggleFullscreen);
if (menuFullscreenBtn) menuFullscreenBtn.addEventListener('click', toggleFullscreen);
syncFullscreenIcons();

// ---------- Screen flow ----------

startBtn.addEventListener('click', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  menu.style.display = 'none';
  resultsScreen.style.display = 'none';
  pauseScreen.style.display = 'none';
  gameContainer.style.display = 'flex';
  try { bgVideo.pause(); } catch (e) {}

  resizeCanvas();

  score = 0; combo = 0; comboAnim = 0; playerLife = 100; totalPausedTime = 0;
  noteStartIndex = 0;
  touchLaneMap = {};
  pressedLanes = [false, false, false, false];
  stats = { perfect: 0, good: 0, miss: 0, maxCombo: 0 };

  notes.forEach(note => { note.hit = false; note.holding = false; note.missed = false; note.hitAnim = 0; });

  hudScore.innerText = '0';
  hudCombo.innerText = '0x';
  updateLifeBar();
  hudProgressFill.style.transform = 'scaleX(0)';
  hudTimeLeft.innerText = formatTime(audioBuffer.duration);

  gamePhase = 'countdown';
  phaseStartTime = performance.now();
  lastCountdownSecond = -1;
  requestAnimationFrame(gameLoop);
});

function returnToMenu() {
  resultsScreen.style.display = 'none';
  pauseScreen.style.display = 'none';
  gameContainer.style.display = 'none';
  menu.style.display = 'block';
  try { bgVideo.play(); } catch (e) {}
  if (audioSource) { try { audioSource.stop(); } catch (e) {} }
  isPlaying = false;
  isPaused = false;
  gamePhase = 'menu';
}

menuBtn.addEventListener('click', returnToMenu);
quitBtn.addEventListener('click', returnToMenu);
resumeBtn.addEventListener('click', togglePause);
hudPauseBtn.addEventListener('click', togglePause);

function togglePause() {
  if (gamePhase === 'menu' || gamePhase === 'results') return;
  if (!isPaused) {
    isPaused = true;
    pauseStartTime = performance.now();
    touchLaneMap = {};
    pressedLanes = [false, false, false, false];
    if (gamePhase === 'playing' && audioSource) {
      try { audioSource.stop(); } catch (e) {}
      audioCtx.suspend();
    }
    pauseScreen.style.display = 'block';
  } else {
    pauseScreen.style.display = 'none';
    let pauseDuration = performance.now() - pauseStartTime;
    phaseStartTime += pauseDuration;
    if (gamePhase === 'playing') {
      totalPausedTime += (pauseDuration / 1000);
      audioCtx.resume();
      let currentSongTime = audioCtx.currentTime - songStartTime - totalPausedTime;
      audioSource = audioCtx.createBufferSource();
      audioSource.buffer = audioBuffer;
      audioSource.playbackRate.value = 1.0;
      audioSource.connect(audioCtx.destination);
      if (currentSongTime >= 0 && currentSongTime < audioBuffer.duration) {
        audioSource.start(0, currentSongTime);
      } else {
        audioSource.start(audioCtx.currentTime + Math.abs(currentSongTime));
      }
      audioSource.onended = () => { if (isPlaying && !isPaused) finishGame(false); };
    }
    isPaused = false;
    requestAnimationFrame(gameLoop);
  }
}

// ---------- Touch input (lane = x position; supports tap AND swiping across lanes) ----------

// A finger doesn't need to land dead-center in a lane to count for a
// neighboring one too — this lets a single finger near a lane boundary
// trigger both lanes at once, which is what double notes need on mobile.
const LANE_BORDER_TOLERANCE = 0.24; // fraction of a lane's width

function lanesFromTouch(touch, rect, scaleX) {
  const canvasX = (touch.clientX - rect.left) * scaleX;
  const lane = Math.floor(canvasX / LANE_WIDTH);
  if (lane < 0 || lane >= LANE_COUNT) return [];
  const lanes = [lane];
  const localX = canvasX - lane * LANE_WIDTH;
  const tol = LANE_WIDTH * LANE_BORDER_TOLERANCE;
  if (localX < tol && lane - 1 >= 0) lanes.push(lane - 1);
  if (localX > LANE_WIDTH - tol && lane + 1 < LANE_COUNT) lanes.push(lane + 1);
  return lanes;
}

function rebuildPressedLanes() {
  pressedLanes[0] = pressedLanes[1] = pressedLanes[2] = pressedLanes[3] = false;
  for (const id in touchLaneMap) {
    touchLaneMap[id].forEach(l => { if (l >= 0 && l < LANE_COUNT) pressedLanes[l] = true; });
  }
}

function laneStillTouched(lane) {
  for (const id in touchLaneMap) if (touchLaneMap[id].indexOf(lane) !== -1) return true;
  return false;
}

function releaseLaneHold(lane) {
  notes.forEach(note => {
    if (note.holding && note.lane === lane) {
      note.holding = false;
      note.missed = true;
      registerMiss("RELEASED");
    }
  });
}

// Sets the lanes owned by one touch, releasing holds on any lane that
// dropped out of the set (and isn't covered by another finger).
function setTouchLanes(id, lanes) {
  const prev = touchLaneMap[id] || [];
  touchLaneMap[id] = lanes;
  rebuildPressedLanes();
  prev.forEach(l => { if (lanes.indexOf(l) === -1 && !laneStillTouched(l)) releaseLaneHold(l); });
}

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (isPaused || !isPlaying || gamePhase !== 'playing') return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  for (let i = 0; i < e.changedTouches.length; i++) {
    const touch = e.changedTouches[i];
    const lanes = lanesFromTouch(touch, rect, scaleX);
    if (lanes.length === 0) continue;
    setTouchLanes(touch.identifier, lanes);
    lanes.forEach(l => processLaneAction(l));
  }
}, { passive: false });

// Swiping a finger across lanes activates each lane it crosses, like a strum;
// staying near a border keeps both bordering lanes active for that finger.
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (isPaused || !isPlaying || gamePhase !== 'playing') return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  for (let i = 0; i < e.changedTouches.length; i++) {
    const touch = e.changedTouches[i];
    const id = touch.identifier;
    const lanes = lanesFromTouch(touch, rect, scaleX);
    if (lanes.length === 0) continue;
    const primary = lanes[0];
    const prevLanes = touchLaneMap[id];

    if (!prevLanes) {
      setTouchLanes(id, lanes);
      lanes.forEach(l => processLaneAction(l));
      continue;
    }

    const prevPrimary = prevLanes[0];
    if (primary === prevPrimary) {
      // same main lane: only fire newly-entered border lanes
      lanes.forEach(l => { if (prevLanes.indexOf(l) === -1) processLaneAction(l); });
      setTouchLanes(id, lanes);
      continue;
    }

    // main lane changed: walk every lane crossed since the last event
    const step = primary > prevPrimary ? 1 : -1;
    for (let lane = prevPrimary + step; ; lane += step) {
      processLaneAction(lane);
      if (lane === primary) break;
    }
    setTouchLanes(id, lanes);
  }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  for (let i = 0; i < e.changedTouches.length; i++) {
    const id = e.changedTouches[i].identifier;
    const lanes = touchLaneMap[id] || [];
    delete touchLaneMap[id];
    rebuildPressedLanes();
    lanes.forEach(l => { if (!laneStillTouched(l)) releaseLaneHold(l); });
  }
}, { passive: false });

canvas.addEventListener('touchcancel', (e) => {
  for (let i = 0; i < e.changedTouches.length; i++) {
    const id = e.changedTouches[i].identifier;
    const lanes = touchLaneMap[id] || [];
    delete touchLaneMap[id];
    lanes.forEach(l => { if (!laneStillTouched(l)) releaseLaneHold(l); });
  }
  rebuildPressedLanes();
}, { passive: true });

function processLaneAction(lane) {
  const currentSongTime = audioCtx.currentTime - songStartTime - totalPausedTime;
  if (currentSongTime < 0) return;
  let targetNote = null;
  for (let i = noteStartIndex; i < notes.length; i++) {
    const n = notes[i];
    if (!n.hit && !n.missed && n.lane === lane) { targetNote = n; break; }
  }
  if (!targetNote) return;
  let timeDelta = Math.abs(targetNote.targetHitTime - currentSongTime);
  if (timeDelta <= 0.090) {
    if (targetNote.isHold) { targetNote.hit = true; targetNote.holding = true; }
    else registerHit(targetNote, "PERFECT!", 300, 'perfect');
  } else if (timeDelta <= 0.160) {
    if (targetNote.isHold) { targetNote.hit = true; targetNote.holding = true; }
    else registerHit(targetNote, "GOOD", 150, 'good');
  } else if (timeDelta <= 0.230) {
    registerMiss("SYSTEM MISS");
  }
}

function registerHit(note, grade, points, type) {
  note.hit = true;
  note.hitAnim = 12;
  score += points;
  combo++;
  comboAnim = 15;
  if (combo > stats.maxCombo) stats.maxCombo = combo;
  playerLife = Math.min(100, playerLife + (type === 'perfect' ? 6 : 4));
  if (type === 'perfect') stats.perfect++; else stats.good++;
  feedbackText = grade;
  feedbackTimer = 35;
  updateLifeBar();
  hudScore.innerText = score;
  hudCombo.innerText = combo + 'x';
}

function registerMiss(reason) {
  combo = 0; comboAnim = 0;
  feedbackText = reason;
  feedbackTimer = 35;
  stats.miss++;
  playerLife = Math.max(0, playerLife - 3);
  updateLifeBar();
  hudCombo.innerText = '0x';
  if (playerLife <= 0) triggerFail();
}

function updateLifeBar() {
  hudLifeFill.style.transform = `scaleX(${playerLife / 100})`;
  hudLifeFill.style.backgroundColor = playerLife > 50 ? '#20E8FF' : (playerLife > 20 ? '#ffcc00' : '#ff4757');
}

function triggerFail() {
  isPlaying = false;
  if (audioSource) { try { audioSource.stop(); } catch (e) {} }
  gameContainer.style.display = 'none';
  finishGame(true);
}

function calculateRank() {
  if (notes.length === 0) return 'E';
  if (stats.perfect === notes.length && stats.good === 0 && stats.miss === 0) return 'S';
  let accuracy = (score / (notes.length * 300)) * 100;
  let comboPct = (stats.maxCombo / notes.length) * 100;
  let rating = (accuracy * 0.75) + (comboPct * 0.25);
  if (rating >= 90) return 'A';
  if (rating >= 80) return 'B';
  if (rating >= 70) return 'C';
  if (rating >= 55) return 'D';
  return 'E';
}

function finishGame(isFailed = false) {
  isPlaying = false;
  gamePhase = 'results';
  if (audioSource) { try { audioSource.stop(); } catch (e) {} }
  gameContainer.style.display = 'none';
  try { bgVideo.play(); } catch (e) {}
  const rank = isFailed ? 'E' : calculateRank();
  document.getElementById('resRank').innerText = rank;
  document.getElementById('resTitle').innerText = isFailed ? "SYSTEM FAILURE" : "AUDITION CLEARED";
  document.getElementById('resTitle').style.color = isFailed ? "#ff4757" : "#20E8FF";
  document.getElementById('resIcon').innerText = isFailed ? "⚠️" : "🏆";
  document.getElementById('resScore').innerText = score;
  document.getElementById('resMaxCombo').innerText = stats.maxCombo;
  document.getElementById('resPerfect').innerText = stats.perfect;
  document.getElementById('resGood').innerText = stats.good;
  document.getElementById('resMiss').innerText = stats.miss;
  resultsScreen.style.display = 'block';
}

// ---------- Main loop ----------

function gameLoop(timestamp) {
  if (gamePhase === 'menu' || gamePhase === 'results') return;
  if (isPaused) return;
  try {
    ctx.drawImage(staticLayer, 0, 0); // pre-rendered bg + lane lines, no per-frame gradient/stroke cost

    let elapsed = (timestamp - phaseStartTime) / 1000;
    if (gamePhase === 'countdown') {
      let timeLeft = 5.0 - elapsed;
      let currentSec = Math.ceil(timeLeft);
      if (currentSec !== lastCountdownSecond && currentSec >= 1 && currentSec <= 5) {
        lastCountdownSecond = currentSec;
        playBeep(currentSec === 1 ? 880 : 440, 0.12, 'square');
      }
      drawUI();
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '900 ' + Math.round(canvas.width * 0.13) + 'px "Orbitron", sans-serif';
      ctx.strokeStyle = '#20E8FF';
      ctx.lineWidth = 3;
      let num = Math.ceil(timeLeft);
      ctx.strokeText(num > 0 ? num : 1, canvas.width / 2, canvas.height / 2);
      ctx.restore();
      if (timeLeft <= 0) {
        gamePhase = 'buffer';
        phaseStartTime = performance.now();
        lastCountdownSecond = -1;
      }
    } else if (gamePhase === 'buffer') {
      let timeLeft = 2.0 - elapsed;
      if (timeLeft <= 1.0 && lastCountdownSecond !== 'go') {
        lastCountdownSecond = 'go';
        playBeep(990, 0.15, 'square');
      }
      drawUI();
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '900 ' + Math.round(canvas.width * 0.045) + 'px "Orbitron", sans-serif';
      ctx.fillStyle = timeLeft > 1.0 ? '#FF3ED8' : '#20E8FF';
      ctx.fillText(timeLeft > 1.0 ? "SYSTEM LOADING" : "LINKED", canvas.width / 2, canvas.height / 2);
      ctx.restore();
      if (timeLeft <= 0) {
        gamePhase = 'playing';
        isPlaying = true;
        const prerollDuration = RECEPTOR_Y / scrollSpeed;
        songStartTime = audioCtx.currentTime + prerollDuration;
        audioSource = audioCtx.createBufferSource();
        audioSource.buffer = audioBuffer;
        audioSource.playbackRate.value = 1.0;
        audioSource.connect(audioCtx.destination);
        audioSource.start(audioCtx.currentTime + prerollDuration);
        audioSource.onended = () => { if (isPlaying && !isPaused) finishGame(false); };
      }
    } else if (gamePhase === 'playing') {
      const currentSongTime = audioCtx.currentTime - songStartTime - totalPausedTime;
      // throttle non-critical HUD text/bar writes to ~10/sec instead of 60/sec
      hudThrottleAcc += 1;
      if (audioBuffer && hudThrottleAcc >= 6) {
        hudThrottleAcc = 0;
        let progress = Math.max(0, Math.min(1, currentSongTime / audioBuffer.duration));
        hudProgressFill.style.transform = `scaleX(${progress})`;
        hudTimeLeft.innerText = formatTime(Math.max(0, audioBuffer.duration - currentSongTime));
      }
      drawUI();
      updateAndDrawNotes(currentSongTime);
      drawJudgment();
      drawCombo();
    }
  } catch (err) {
    finishGame(true);
    return;
  }
  if (gamePhase !== 'results') requestAnimationFrame(gameLoop);
}

function drawUI() {
  for (let i = 0; i < LANE_COUNT; i++) {
    let xPos = i * LANE_WIDTH;
    let width = LANE_WIDTH;
    let isPressedActive = pressedLanes[i] && gamePhase === 'playing';
    if (isPressedActive) {
      ctx.save();
      let grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, ARROW_COLORS[i]);
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = grad;
      ctx.fillRect(xPos, 0, width, canvas.height);
      ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = isPressedActive ? ARROW_COLORS[i] : 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = isPressedActive ? 3 : 2;
    ctx.fillStyle = isPressedActive ? 'rgba(0,0,0,0.75)' : 'rgba(30,28,48,0.6)';
    ctx.fillRect(xPos + 6, RECEPTOR_Y - 32, width - 12, 64);
    ctx.strokeRect(xPos + 6, RECEPTOR_Y - 32, width - 12, 64);
    drawArcadeArrow(ctx, xPos + 6, RECEPTOR_Y - 32, width - 12, 64, i, isPressedActive ? ARROW_COLORS[i] : 'rgba(255, 255, 255, 0.14)', isPressedActive ? '#ffffff' : 'rgba(255, 255, 255, 0.55)', true, false);
    ctx.restore();
  }
}

function drawArcadeArrow(ctx, x, y, width, height, lane, fillColor, strokeColor, isReceptor = false, isHitFlash = false) {
  drawArcadeArrow.cache = drawArcadeArrow.cache || {};

  const isUnpressedReceptor = isReceptor && fillColor === 'rgba(255, 255, 255, 0.14)';
  const state = isUnpressedReceptor ? 'unpressed' : (isReceptor ? 'pressed' : (isHitFlash ? 'flash' : 'normal'));

  const wKey = Math.round(width);
  const hKey = Math.round(height);
  const cacheKey = `${lane}_${state}_${wKey}_${hKey}`;
  const padding = 40;
  const canvasSize = Math.max(wKey, hKey) + padding * 2;

  if (!drawArcadeArrow.cache[cacheKey]) {
    const offscreen = document.createElement('canvas');
    offscreen.width = canvasSize;
    offscreen.height = canvasSize;
    const octx = offscreen.getContext('2d');
    octx.translate(canvasSize / 2, canvasSize / 2);

    let rotation = (lane === 0 ? -Math.PI / 2 : (lane === 1 ? Math.PI : (lane === 2 ? 0 : Math.PI / 2)));
    octx.rotate(rotation);

    let boxSize = Math.min(width, height) * 0.85;
    let w = boxSize;
    let h = boxSize;

    const traceArrow = () => {
      const stem = w * 0.28;
      const head = h * 0.42;
      const headW = w * 0.58;
      octx.beginPath();
      octx.moveTo(0, -h / 2);
      octx.lineTo(headW, -h / 2 + head);
      octx.lineTo(stem, -h / 2 + head);
      octx.lineTo(stem, h / 2);
      octx.lineTo(-stem, h / 2);
      octx.lineTo(-stem, -h / 2 + head);
      octx.lineTo(-headW, -h / 2 + head);
      octx.closePath();
    };

    const baseColor = ARROW_COLORS[lane];
    const glowColor = isHitFlash ? '#ffffff' : baseColor;

    octx.lineJoin = 'round';
    octx.lineCap = 'round';

    octx.save();
    traceArrow();
    octx.clip();
    octx.fillStyle = isUnpressedReceptor ? 'rgba(35, 30, 55, 0.7)' : 'rgba(10, 5, 20, 0.85)';
    octx.fill();

    octx.fillStyle = glowColor;
    const dotSpacing = 5;
    const dotSize = 2;
    octx.globalAlpha = isUnpressedReceptor ? 0.4 : (isHitFlash ? 1.0 : 0.85);
    for (let dx = -w; dx <= w; dx += dotSpacing) {
      for (let dy = -h; dy <= h; dy += dotSpacing) {
        octx.fillRect(dx - dotSize / 2, dy - dotSize / 2, dotSize, dotSize);
      }
    }
    octx.restore();

    if (!isUnpressedReceptor) {
      octx.shadowBlur = isHitFlash ? 30 : (isReceptor ? 20 : 15);
      octx.shadowColor = glowColor;
    }

    traceArrow();
    octx.lineWidth = 7;
    octx.strokeStyle = isUnpressedReceptor ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.6)';
    octx.stroke();

    octx.lineWidth = 3;
    if (isUnpressedReceptor) octx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    else if (isReceptor) octx.strokeStyle = '#ffffff';
    else octx.strokeStyle = strokeColor;
    octx.stroke();

    drawArcadeArrow.cache[cacheKey] = offscreen;
  }

  ctx.drawImage(
    drawArcadeArrow.cache[cacheKey],
    (x + width / 2) - (canvasSize / 2),
    (y + height / 2) - (canvasSize / 2)
  );
}

function updateAndDrawNotes(currentSongTime) {
  const missWindow = 0.230;

  // advance the window past anything fully resolved so we never re-scan
  // notes from the start of a long song every frame
  while (noteStartIndex < notes.length) {
    const n = notes[noteStartIndex];
    const resolved = (n.missed) || (n.hit && !n.holding && n.hitAnim <= 0);
    if (resolved) noteStartIndex++; else break;
  }

  for (let i = noteStartIndex; i < notes.length; i++) {
    let note = notes[i];
    if (note.missed) continue;

    if (note.holding) {
      let holdEndTime = note.targetHitTime + note.holdDuration;
      if (currentSongTime >= holdEndTime) {
        note.holding = false;
        note.hit = true;
        score += 200;
        combo++;
        comboAnim = 15;
        if (combo > stats.maxCombo) stats.maxCombo = combo;
        stats.perfect++;
        playerLife = Math.min(100, playerLife + 5);
        feedbackText = "SYNCED!";
        feedbackTimer = 25;
        updateLifeBar();
        hudScore.innerText = score;
        hudCombo.innerText = combo + 'x';
        continue;
      }
      let xPos = (note.lane * LANE_WIDTH) + 6;
      let width = LANE_WIDTH - 12;
      let remaining = (holdEndTime - currentSongTime) * scrollSpeed;
      ctx.save();
      let holdGrad = ctx.createLinearGradient(0, RECEPTOR_Y, 0, RECEPTOR_Y - remaining);
      holdGrad.addColorStop(0, '#ffffff');
      holdGrad.addColorStop(0.2, ARROW_COLORS[note.lane]);
      holdGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = holdGrad;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(xPos + width / 4, RECEPTOR_Y - remaining, width / 2, remaining);
      ctx.restore();
      continue;
    }

    if (note.hit) {
      if (note.hitAnim > 0) {
        drawArcadeArrow(ctx, (note.lane * LANE_WIDTH) + 6, RECEPTOR_Y - 32, LANE_WIDTH - 12, 64, note.lane, '#ffffff', ARROW_COLORS[note.lane], false, true);
        note.hitAnim--;
      }
      continue;
    }

    let timeUntilHit = note.targetHitTime - currentSongTime;
    if (currentSongTime > note.targetHitTime + missWindow) {
      note.missed = true;
      registerMiss("SYSTEM MISS");
      continue;
    }

    // falling downward toward the receptor at the bottom of the screen
    let noteY = RECEPTOR_Y - (timeUntilHit * scrollSpeed);
    if (noteY < -100) break; // this note and everything after it (later hit times) is still off the top
    if (noteY <= canvas.height + 60) {
      if (note.isHold) {
        let xPos = (note.lane * LANE_WIDTH) + 6;
        let width = LANE_WIDTH - 12;
        let tailPixelLength = note.holdDuration * scrollSpeed;
        ctx.save();
        let holdGrad = ctx.createLinearGradient(0, noteY, 0, noteY - tailPixelLength);
        holdGrad.addColorStop(0, ARROW_COLORS[note.lane]);
        holdGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = holdGrad;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(xPos + width / 4, noteY - tailPixelLength, width / 2, tailPixelLength);
        ctx.restore();
      }
      drawArcadeArrow(ctx, (note.lane * LANE_WIDTH) + 6, noteY - 32, LANE_WIDTH - 12, 64, note.lane, ARROW_COLORS[note.lane], '#ffffff', false, false);
    }
  }
}

function drawJudgment() {
  if (feedbackTimer > 0) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.translate(canvas.width / 2, canvas.height * 0.42);
    let scale = 1 + (feedbackTimer / 35) * 0.25;
    ctx.scale(scale, scale);
    ctx.font = "900 " + Math.round(canvas.width * 0.09) + "px 'Orbitron', sans-serif";
    let color = feedbackText === "PERFECT!" ? "#20E8FF" : (feedbackText === "GOOD" ? "#8D3CFF" : "#ff4757");
    if (feedbackText === "SYNCED!") color = "#FF3ED8";
    ctx.shadowBlur = 25;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    ctx.fillText(feedbackText, 0, 0);
    ctx.restore();
    feedbackTimer--;
  }
}

function drawCombo() {
  if (combo >= 10) {
    ctx.save();
    ctx.textAlign = "center";
    if (comboAnim > 0) comboAnim--;
    ctx.translate(canvas.width / 2, canvas.height * 0.28);
    ctx.scale(1 + (comboAnim / 15) * 0.35, 1 + (comboAnim / 15) * 0.35);
    ctx.shadowBlur = 35;
    ctx.shadowColor = "#20E8FF";
    ctx.font = "900 " + Math.round(canvas.width * 0.25) + "px 'Orbitron', sans-serif";
    let grad = ctx.createLinearGradient(0, -50, 0, 20);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#20E8FF');
    ctx.fillStyle = grad;
    ctx.fillText(combo, 0, 0);
    ctx.font = "700 " + Math.round(canvas.width * 0.045) + "px 'Rajdhani', sans-serif";
    ctx.fillStyle = "#FF3ED8";
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#FF3ED8";
    ctx.fillText("CHAIN LINK", 0, canvas.width * 0.1);
    ctx.restore();
  }
}

// initial sizing so the menu->game transition doesn't have to compute cold
resizeCanvas();
