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
const ctx = canvas.getContext('2d');
const songMetadataBox = document.getElementById('song-metadata');
const playlistListEl = document.getElementById('playlist-list');
const playlistDropdown = document.getElementById('playlist-dropdown');
const playlistToggle = document.getElementById('playlistToggle');
const playlistToggleText = document.getElementById('playlistToggleText');
const sidebarTrackName = document.getElementById('sidebar-track-name');
const sidebarBpm = document.getElementById('sidebar-bpm');
const sidebarTimeLeft = document.getElementById('sidebar-time-left');
const sidebarDuration = document.getElementById('sidebar-duration');
const sidebarProgressFill = document.getElementById('sidebar-progress-fill');
const sidebarLifeFill = document.getElementById('sidebar-life-fill');
const sidebarLifeVal = document.getElementById('sidebar-life-val');

const comboFlash = document.getElementById('combo-flash');
const particleCanvas = document.getElementById('particle-canvas');
const particleCtx = particleCanvas.getContext('2d');
let particles = [];

function initParticleCanvas() {
  particleCanvas.width = window.innerWidth;
  particleCanvas.height = window.innerHeight;
}
window.addEventListener('resize', initParticleCanvas);
initParticleCanvas();

function spawnParticles(x, y, color, count = 40) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const speed = 200 + Math.random() * 300;
    const size = 4 + Math.random() * 8;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 50,
      life: 1,
      decay: 0.008 + Math.random() * 0.015,
      size,
      color: color || `hsl(${Math.random() * 360}, 100%, 70%)`,
    });
  }
}

function updateParticles(delta) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * delta;
    p.y += p.vy * delta;
    p.vy += 200 * delta;
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawParticles() {
  particleCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
  for (const p of particles) {
    particleCtx.globalAlpha = p.life;
    particleCtx.fillStyle = p.color;
    particleCtx.shadowBlur = 20;
    particleCtx.shadowColor = p.color;
    particleCtx.beginPath();
    particleCtx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    particleCtx.fill();
  }
  particleCtx.globalAlpha = 1;
  particleCtx.shadowBlur = 0;
}

function spawnHoldLabel(x, y, text = 'HOLD COMPLETE') {
  const el = document.createElement('div');
  el.className = 'hold-label';
  el.textContent = text;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.classList.add('show');
  });
  setTimeout(() => {
    el.classList.remove('show');
    el.classList.add('fade');
    setTimeout(() => el.remove(), 700);
  }, 400);
}

let flashTimeout = null;
function triggerComboFlash() {
  if (flashTimeout) return;
  comboFlash.classList.add('active');
  flashTimeout = setTimeout(() => {
    comboFlash.classList.remove('active');
    flashTimeout = null;
  }, 120);
}

let audioCtx = null;
let audioBuffer = null;
let audioOffsetMs = 0;
let audioSource = null;
let songStartTime = 0;
let isPlaying = false;
let isPaused = false;
let pauseStartTime = 0;
let totalPausedTime = 0;
let gamePhase = 'menu';
let phaseStartTime = 0;
let lastHitEarly = false;
let lastCountdownSecond = -1;
let notes = [];
let score = 0;
let combo = 0;
let comboAnim = 0;
let playerLife = 100;
let feedbackText = "";
let feedbackTimer = 0;
let estimatedBPM = 120;
let stats = { perfect: 0, good: 0, miss: 0, maxCombo: 0 };
let currentTrackMeta = { artist: "Unknown", title: "Unknown Track" };
let playlistTracks = [];
let selectedPlaylistTrack = null;
let manualAudioBuffer = null;
let manualTrackMeta = null;
let manualEstimatedBPM = null;
let previewSource = null;
let previewGain = null;

let holdEffects = [];
let milestoneEffects = [];

const LANE_COUNT = 4;
const LANE_WIDTH = canvas.width / LANE_COUNT;
const JUDGMENT_LINE_Y = 55;
let difficultySetting = 'medium';
let speedMultiplier = 3;
let scrollSpeed = 1200;
let laneKeys = ['KeyA', 'KeyS', 'KeyK', 'KeyL'];
let pressedLanes = [false, false, false, false];
let listeningLane = null;

let ARROW_COLORS = ['#8D3CFF', '#20E8FF', '#FFD700', '#FF4757'];

const COLOR_SCHEMES = {
  cyber: ['#8D3CFF', '#20E8FF', '#FFD700', '#FF4757'],
  classic: ['#00FFFF', '#B026FF', '#FF00FF', '#00FFFF'],
  neon: ['#00FF88', '#20E8FF', '#FF3ED8', '#FF8C00']
};

const colorSchemeSelect = document.getElementById('colorSchemeSelect');
const colorPreview = document.getElementById('colorPreview');

function updateColorPreview(scheme) {
  const colors = COLOR_SCHEMES[scheme];
  if (!colors || !colorPreview) return;
  const squares = colorPreview.querySelectorAll('div');
  squares.forEach((div, index) => {
    if (index < colors.length) div.style.background = colors[index];
  });
}

if (colorSchemeSelect) {
  colorSchemeSelect.addEventListener('change', (e) => {
    const scheme = e.target.value;
    ARROW_COLORS = COLOR_SCHEMES[scheme] || COLOR_SCHEMES.cyber;
    updateColorPreview(scheme);
    if (typeof drawArcadeArrow !== 'undefined' && drawArcadeArrow.cache) {
      drawArcadeArrow.cache = {};
    }
  });
  updateColorPreview(colorSchemeSelect.value);
}

const latencySlider = document.getElementById('latencySlider');
const latencyValue = document.getElementById('latencyValue');
const resetLatencyBtn = document.getElementById('resetLatency');

if (latencySlider) {
  latencySlider.addEventListener('input', (e) => {
    audioOffsetMs = parseInt(e.target.value);
    latencyValue.textContent = audioOffsetMs + ' ms';
  });
}
if (resetLatencyBtn) {
  resetLatencyBtn.addEventListener('click', () => {
    audioOffsetMs = 0;
    latencySlider.value = 0;
    latencyValue.textContent = '0 ms';
  });
}
if (latencyValue) latencyValue.textContent = '0 ms';

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

document.querySelectorAll('.keybind-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (gamePhase !== 'menu') return;
    document.querySelectorAll('.keybind-btn').forEach(b => {
      b.classList.remove('listening');
      let lIdx = b.getAttribute('data-lane');
      b.innerText = laneKeys[lIdx].replace('Key', '').replace('Digit', '');
    });
    listeningLane = parseInt(btn.getAttribute('data-lane'));
    btn.classList.add('listening');
    btn.innerText = "...";
  });
});

function deriveMetaFromFilename(name) {
  const cleanName = name.replace(/\.[^/.]+$/, "");
  const parts = cleanName.split('-');
  if (parts.length > 1) {
    return { artist: parts[0].trim(), title: parts.slice(1).join('-').trim() };
  }
  return { artist: "Unknown Artist", title: cleanName };
}

function applyMetaToUI() {
  document.getElementById('metaArtist').innerText = currentTrackMeta.artist;
  document.getElementById('metaTitle').innerText = currentTrackMeta.title;
  document.getElementById('metaDuration').innerText = formatTime(audioBuffer.duration);
  document.getElementById('metaBpm').innerText = estimatedBPM;
  document.getElementById('metaNotes').innerText = notes.length;
  songMetadataBox.style.display = 'grid';
}

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  stopPreview();
  selectedPlaylistTrack = null;
  document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('active'));
  if (playlistToggleText) playlistToggleText.textContent = 'Select a track…';
  startBtn.innerText = "PROCESSING AUDIO...";
  startBtn.disabled = true;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    audioBuffer = await Promise.race([
      audioCtx.decodeAudioData(arrayBuffer),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 10000))
    ]);
    const meta = deriveMetaFromFilename(file.name);
    currentTrackMeta.artist = meta.artist;
    currentTrackMeta.title = meta.title;
    estimatedBPM = estimateBPM(audioBuffer);
    notes = autoGenerateChart(audioBuffer, difficultySetting);
    applyMetaToUI();
    manualAudioBuffer = audioBuffer;
    manualTrackMeta = { artist: currentTrackMeta.artist, title: currentTrackMeta.title };
    manualEstimatedBPM = estimatedBPM;
    if (playlistToggleText) playlistToggleText.textContent = `${currentTrackMeta.artist} - ${currentTrackMeta.title} (Manual)`;
    startBtn.innerText = "INITIALIZE UPLINK";
    startBtn.disabled = false;
  } catch (err) {
    alert("Could not process this audio file. Please try another standard MP3 or WAV.");
    startBtn.innerText = "INITIALIZE UPLINK";
    startBtn.disabled = true;
    fileInput.value = "";
  }
});

async function loadPlaylistManifest() {
  try {
    const res = await fetch('music/playlist.json', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return normalizePlaylist(data);
    }
  } catch (e) {}
  try {
    const res = await fetch('music/', { cache: 'no-store' });
    if (res.ok) {
      const html = await res.text();
      const matches = Array.from(html.matchAll(/href="([^"?#]+\.(?:mp3|wav|ogg|m4a))"/gi)).map(m => decodeURIComponent(m[1]));
      if (matches.length) return normalizePlaylist(matches);
    }
  } catch (e) {}
  return [];
}

function normalizePlaylist(list) {
  return list.map(item => {
    if (typeof item === 'string') {
      const file = item.includes('/') ? item : `music/${item}`;
      const meta = deriveMetaFromFilename(item.split('/').pop());
      return { file, artist: meta.artist, title: meta.title };
    }
    if (item && item.file) {
      const file = item.file.includes('/') ? item.file : `music/${item.file}`;
      const fallback = deriveMetaFromFilename(item.file.split('/').pop());
      return { file, artist: item.artist || fallback.artist, title: item.title || fallback.title };
    }
    return null;
  }).filter(Boolean);
}

function renderPlaylist() {
  if (!playlistListEl) return;
  if (playlistTracks.length === 0) {
    playlistListEl.innerHTML = '<p class="playlist-empty">No tracks found. Drop mp3 files into the "music" folder and list them in music/playlist.json — or upload a track manually below.</p>';
    if (playlistToggleText) playlistToggleText.textContent = 'No tracks found';
    return;
  }
  playlistListEl.innerHTML = '';
  playlistTracks.forEach(track => {
    const item = document.createElement('div');
    item.className = 'playlist-item';
    const info = document.createElement('div');
    info.className = 'pl-info';
    const titleEl = document.createElement('div');
    titleEl.className = 'pl-title';
    titleEl.textContent = track.title;
    const artistEl = document.createElement('div');
    artistEl.className = 'pl-artist';
    artistEl.textContent = track.artist;
    info.appendChild(titleEl);
    info.appendChild(artistEl);
    const badge = document.createElement('span');
    badge.className = 'pl-badge';
    badge.textContent = '▶ PREVIEW';
    item.appendChild(info);
    item.appendChild(badge);
    item.addEventListener('click', () => selectPlaylistTrack(track, item));
    playlistListEl.appendChild(item);
  });
}

async function selectPlaylistTrack(track, itemEl) {
  if (gamePhase !== 'menu') return;
  stopPreview();
  fileInput.value = "";
  document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('active'));
  itemEl.classList.add('active');
  selectedPlaylistTrack = track;
  startBtn.innerText = "PROCESSING AUDIO...";
  startBtn.disabled = true;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') { try { await audioCtx.resume(); } catch (e) {} }
    const res = await fetch(track.file);
    if (!res.ok) throw new Error('fetch failed: ' + res.status);
    const arrayBuffer = await res.arrayBuffer();
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    currentTrackMeta.artist = track.artist;
    currentTrackMeta.title = track.title;
    estimatedBPM = estimateBPM(audioBuffer);
    notes = autoGenerateChart(audioBuffer, difficultySetting);
    applyMetaToUI();
    startBtn.innerText = "INITIALIZE UPLINK";
    startBtn.disabled = false;
    if (playlistToggleText) playlistToggleText.textContent = `${track.artist} - ${track.title}`;
    closePlaylistDropdown();
    startPreviewLoop();
  } catch (err) {
    alert(`Could not load "${track.title}". Make sure the file exists in the music folder and the site is served over http(s), not opened directly from disk.`);
    startBtn.innerText = "INITIALIZE UPLINK";
    startBtn.disabled = true;
    itemEl.classList.remove('active');
    selectedPlaylistTrack = null;
  }
}

function openPlaylistDropdown() { if (playlistDropdown) playlistDropdown.classList.add('open'); }
function closePlaylistDropdown() { if (playlistDropdown) playlistDropdown.classList.remove('open'); }
function togglePlaylistDropdown() {
  if (!playlistDropdown) return;
  if (playlistDropdown.classList.contains('open')) closePlaylistDropdown();
  else openPlaylistDropdown();
}

if (playlistToggle) {
  playlistToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlaylistDropdown();
  });
}
document.addEventListener('click', (e) => {
  if (playlistDropdown && playlistDropdown.classList.contains('open') && !playlistDropdown.contains(e.target)) {
    closePlaylistDropdown();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePlaylistDropdown();
});

function startPreviewLoop() {
  stopPreview();
  if (!audioCtx || !audioBuffer) return;
  const previewLen = Math.min(5, audioBuffer.duration);
  const offset = Math.min(Math.max(0, audioBuffer.duration * 0.15), Math.max(0, audioBuffer.duration - previewLen));
  try {
    previewSource = audioCtx.createBufferSource();
    previewSource.buffer = audioBuffer;
    previewSource.loop = false;
    previewGain = audioCtx.createGain();
    previewGain.gain.value = 0.55;
    previewSource.connect(previewGain);
    previewGain.connect(audioCtx.destination);
    previewSource.start(0, offset, previewLen);
    previewSource.onended = function() {
      previewSource = null;
      previewGain = null;
    };
  } catch (e) {
    previewSource = null;
    previewGain = null;
  }
}

function stopPreview() {
  if (previewSource) {
    try { previewSource.stop(); } catch (e) {}
    previewSource = null;
  }
  if (previewGain) {
    try { previewGain.disconnect(); } catch (e) {}
    previewGain = null;
  }
}

loadPlaylistManifest().then(tracks => {
  playlistTracks = tracks;
  renderPlaylist();
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
  const beatDuration = 60.0 / estimatedBPM;
  const sixteenthDuration = beatDuration / 4;

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
      let snappedTime = Math.round(hitTime / sixteenthDuration) * sixteenthDuration;
      if (snappedTime < nextAllowedHitTime) {
        snappedTime = Math.ceil(nextAllowedHitTime / sixteenthDuration) * sixteenthDuration;
      }
      if (snappedTime >= cutoffTime) break;
      let lane = Math.floor(pseudoRandom(snappedTime * 99 + i) * LANE_COUNT);
      if (lane === lastLane) lane = (lane + 1) % LANE_COUNT;
      lastLane = lane;
      let isHold = (difficulty !== 'easy') && (pseudoRandom(snappedTime * 33) < holdProbability);
      let holdDur = isHold ? Number((pseudoRandom(snappedTime * 77) * 0.8 + 0.4).toFixed(2)) : 0;
      generated.push({
        lane: lane,
        targetHitTime: Number(snappedTime.toFixed(3)),
        isHold: isHold,
        holdDuration: holdDur,
        hit: false,
        holding: false,
        missed: false,
        hitAnim: 0
      });
      if (difficulty !== 'easy' && !isHold && (snappedTime - lastDoubleTime) > 1.2 && pseudoRandom(snappedTime * 55) < doubleChance) {
        lastDoubleTime = snappedTime;
        const possible = [];
        for (let l = 0; l < LANE_COUNT; l++) {
          if (l !== lane) possible.push(l);
        }
        let secondLane = possible[Math.floor(pseudoRandom(snappedTime * 73) * possible.length)];
        generated.push({
          lane: secondLane,
          targetHitTime: Number(snappedTime.toFixed(3)),
          isHold: false,
          holdDuration: 0,
          hit: false,
          holding: false,
          missed: false,
          hitAnim: 0
        });
      }
      if (isHold) {
        nextAllowedHitTime = snappedTime + holdDur + 0.35;
      } else {
        nextAllowedHitTime = snappedTime + sixteenthDuration * 0.5;
      }
      i += windowSize * skipMultiplier;
    } else {
      i += windowSize;
    }
  }
  return generated;
}

startBtn.addEventListener('click', () => {
  stopPreview();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  menu.style.display = 'none';
  resultsScreen.style.display = 'none';
  pauseScreen.style.display = 'none';
  gameContainer.style.display = 'flex';
  sidebarTrackName.innerText = `${currentTrackMeta.artist} - ${currentTrackMeta.title}`;
  sidebarBpm.innerText = estimatedBPM;
  sidebarDuration.innerText = formatTime(audioBuffer.duration);
  score = 0;
  combo = 0;
  comboAnim = 0;
  playerLife = 100;
  totalPausedTime = 0;
  stats = { perfect: 0, good: 0, miss: 0, maxCombo: 0 };
  holdEffects = [];
  milestoneEffects = [];
  particles = [];
  
  notes.forEach(note => {
    note.hit = false;
    note.holding = false;
    note.missed = false;
    note.hitAnim = 0;
  });

  updateLifeBar();
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
  if (audioSource) {
    try { audioSource.stop(); } catch (e) {}
  }
  isPlaying = false;
  isPaused = false;
  gamePhase = 'menu';
}

menuBtn.addEventListener('click', returnToMenu);
quitBtn.addEventListener('click', returnToMenu);
resumeBtn.addEventListener('click', togglePause);

function togglePause() {
  if (gamePhase === 'menu' || gamePhase === 'results') return;
  if (!isPaused) {
    isPaused = true;
    pauseStartTime = performance.now();
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
      audioSource.onended = () => {
        if (isPlaying && !isPaused) finishGame(false);
      };
    }
    isPaused = false;
    requestAnimationFrame(gameLoop);
  }
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (gamePhase !== 'menu' && gamePhase !== 'results') togglePause();
    return;
  }
  if (isPaused) return;
  if (listeningLane !== null) {
    e.preventDefault();
    laneKeys[listeningLane] = e.code;
    let btn = document.getElementById(`kb-${listeningLane}`);
    btn.classList.remove('listening');
    btn.innerText = e.code.replace('Key', '').replace('Digit', '');
    listeningLane = null;
    return;
  }
  let lane = laneKeys.indexOf(e.code);
  if (lane !== -1 && !e.repeat) {
    pressedLanes[lane] = true;
    processLaneAction(lane);
  }
});

window.addEventListener('keyup', (e) => {
  if (isPaused || gamePhase !== 'playing') return;
  let lane = laneKeys.indexOf(e.code);
  if (lane !== -1) {
    pressedLanes[lane] = false;
    notes.forEach(note => {
      if (note.holding && note.lane === lane) {
        note.holding = false;
        note.missed = true;
        registerMiss("RELEASED");
      }
    });
  }
});

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (isPaused || !isPlaying || gamePhase !== 'playing') return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  for (let i = 0; i < e.changedTouches.length; i++) {
    let touch = e.changedTouches[i];
    let canvasX = (touch.clientX - rect.left) * scaleX;
    let lane = Math.floor(canvasX / LANE_WIDTH);
    if (lane >= 0 && lane < LANE_COUNT) {
      pressedLanes[lane] = true;
      processLaneAction(lane);
    }
  }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (isPaused || !isPlaying || gamePhase !== 'playing') return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  for (let i = 0; i < e.changedTouches.length; i++) {
    let touch = e.changedTouches[i];
    let canvasX = (touch.clientX - rect.left) * scaleX;
    let lane = Math.floor(canvasX / LANE_WIDTH);
    if (lane >= 0 && lane < LANE_COUNT) {
      pressedLanes[lane] = false;
      notes.forEach(note => {
        if (note.holding && note.lane === lane) {
          note.holding = false;
          note.missed = true;
          registerMiss("RELEASED");
        }
      });
    }
  }
}, { passive: false });

function processLaneAction(lane) {
  const currentSongTime = audioCtx.currentTime - songStartTime - totalPausedTime;
  if (currentSongTime < 0) return;
  let targetNote = notes.find(note => !note.hit && !note.missed && note.lane === lane);
  if (!targetNote) return;
  let timeDelta = Math.abs(targetNote.targetHitTime - currentSongTime);
  if (timeDelta <= 0.090) {
    if (targetNote.isHold) {
      targetNote.hit = true;
      targetNote.holding = true;
    } else {
      registerHit(targetNote, "PERFECT!", 300, 'perfect', false);
    }
  } else if (timeDelta <= 0.160) {
    if (targetNote.isHold) {
      targetNote.hit = true;
      targetNote.holding = true;
    } else {
      const isEarly = currentSongTime < targetNote.targetHitTime;
      registerHit(targetNote, "GOOD", 150, 'good', isEarly);
    }
  } else if (timeDelta <= 0.220) {
    registerMiss("SYSTEM MISS");
  }
}

function registerHit(note, grade, points, type, early) {
  note.hit = true;
  note.hitAnim = 12;
  score += points;
  combo++;
  comboAnim = 15;
  if (combo > stats.maxCombo) stats.maxCombo = combo;
  playerLife = Math.min(100, playerLife + 6);
  if (type === 'perfect') stats.perfect++;
  else stats.good++;
  feedbackText = grade;
  feedbackTimer = 35;
  lastHitEarly = early || false;
  updateLifeBar();

  if (combo > 0 && combo % 100 === 0) {
    triggerComboFlash();
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    spawnParticles(cx, cy, null, 60);
    milestoneEffects.push({
      text: combo + ' COMBO!',
      progress: 0,
      lifetime: 60,
      scale: 0.5
    });
  }
}

function registerMiss(reason) {
  combo = 0;
  comboAnim = 0;
  feedbackText = reason;
  feedbackTimer = 35;
  stats.miss++;
  playerLife = Math.max(0, playerLife - 8);
  lastHitEarly = false;
  updateLifeBar();
  if (playerLife <= 0) triggerFail();
}

function updateLifeBar() {
  sidebarLifeFill.style.width = playerLife + '%';
  sidebarLifeVal.innerText = playerLife + '%';
  sidebarLifeFill.style.background = playerLife > 50 ? '#20E8FF' : (playerLife > 20 ? '#ffcc00' : '#ff4757');
}

function triggerFail() {
  isPlaying = false;
  if (audioSource) {
    try { audioSource.stop(); } catch (e) {}
  }
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
  if (audioSource) {
    try { audioSource.stop(); } catch (e) {}
  }
  gameContainer.style.display = 'none';
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

function gameLoop(timestamp) {
  if (gamePhase === 'menu' || gamePhase === 'results') return;
  if (isPaused) return;
  try {
    const delta = 0.016;
    updateParticles(delta);
    drawParticles();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, 'rgba(5, 5, 10, 0.85)');
    grad.addColorStop(1, 'rgba(15, 10, 25, 0.95)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let elapsed = (timestamp - phaseStartTime) / 1000;
    if (gamePhase === 'countdown') {
      let timeLeft = 5.0 - elapsed;
      let currentSec = Math.ceil(timeLeft);
      if (currentSec !== lastCountdownSecond && currentSec >= 1 && currentSec <= 5) {
        lastCountdownSecond = currentSec;
        playBeep(currentSec === 1 ? 880 : 440, 0.12, 'square');
      }
      drawUI(0);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '900 80px "Orbitron", sans-serif';
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
      drawUI(0);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '900 28px "Orbitron", sans-serif';
      ctx.fillStyle = timeLeft > 1.0 ? '#FF3ED8' : '#20E8FF';
      ctx.fillText(timeLeft > 1.0 ? "SYSTEM LOADING" : "LINKED", canvas.width / 2, canvas.height / 2);
      ctx.restore();
      if (timeLeft <= 0) {
        gamePhase = 'playing';
        isPlaying = true;
        const prerollDuration = (canvas.height - JUDGMENT_LINE_Y) / scrollSpeed;
        const offsetSeconds = audioOffsetMs / 1000;
        songStartTime = audioCtx.currentTime + prerollDuration - offsetSeconds;
        audioSource = audioCtx.createBufferSource();
        audioSource.buffer = audioBuffer;
        audioSource.playbackRate.value = 1.0;
        audioSource.connect(audioCtx.destination);
        audioSource.start(audioCtx.currentTime + prerollDuration);
        audioSource.onended = () => {
          if (isPlaying && !isPaused) finishGame(false);
        };
      }
    } else if (gamePhase === 'playing') {
      const currentSongTime = audioCtx.currentTime - songStartTime - totalPausedTime;
      if (audioBuffer) {
        let progress = Math.max(0, Math.min(1, currentSongTime / audioBuffer.duration));
        sidebarProgressFill.style.width = (progress * 100) + '%';
        sidebarTimeLeft.innerText = formatTime(Math.max(0, audioBuffer.duration - currentSongTime));
      }
      drawUI(currentSongTime);
      updateAndDrawNotes(currentSongTime);
      drawJudgment();
      drawCombo();
      drawHoldEffects();
      drawMilestoneEffects();
    }
  } catch (err) {
    finishGame(true);
    return;
  }
  if (gamePhase !== 'results') requestAnimationFrame(gameLoop);
}

function drawUI(currentSongTime) {
  for (let i = 0; i < LANE_COUNT; i++) {
    let xPos = i * LANE_WIDTH;
    let width = LANE_WIDTH;
    if (pressedLanes[i] && gamePhase === 'playing') {
      ctx.save();
      let grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, ARROW_COLORS[i]);
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = grad;
      ctx.fillRect(xPos, 0, width, canvas.height);
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(32, 232, 255, 0.1)';
    ctx.setLineDash([10, 15]);
    ctx.beginPath();
    ctx.moveTo(xPos, 0);
    ctx.lineTo(xPos, canvas.height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.save();
    let isPressedActive = pressedLanes[i] && gamePhase === 'playing';
    ctx.strokeStyle = isPressedActive ? ARROW_COLORS[i] : 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = isPressedActive ? 3 : 1.5;
    ctx.fillStyle = isPressedActive ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0.4)';
    ctx.fillRect(xPos + 6, JUDGMENT_LINE_Y - 32, width - 12, 64);
    ctx.strokeRect(xPos + 6, JUDGMENT_LINE_Y - 32, width - 12, 64);
    drawArcadeArrow(ctx, xPos + 6, JUDGMENT_LINE_Y - 32, width - 12, 64, i, isPressedActive ? ARROW_COLORS[i] : 'rgba(255, 255, 255, 0.05)', isPressedActive ? '#ffffff' : 'rgba(255, 255, 255, 0.3)', true, false);
    ctx.restore();
  }
}

function drawArcadeArrow(ctx, x, y, width, height, lane, fillColor, strokeColor, isReceptor = false, isHitFlash = false) {
  drawArcadeArrow.cache = drawArcadeArrow.cache || {};

  const isUnpressedReceptor = isReceptor && fillColor === 'rgba(255, 255, 255, 0.05)';
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
    
    octx.fillStyle = isUnpressedReceptor ? 'rgba(5, 2, 10, 0.6)' : 'rgba(10, 5, 20, 0.85)';
    octx.fill();

    octx.fillStyle = glowColor;
    const dotSpacing = 5;
    const dotSize = 2;
    
    if (isUnpressedReceptor) {
        octx.globalAlpha = 0.15; 
    } else {
        octx.globalAlpha = isHitFlash ? 1.0 : 0.75;
    }
    
    for (let dx = -w; dx <= w; dx += dotSpacing) {
      for (let dy = -h; dy <= h; dy += dotSpacing) {
         octx.fillRect(dx - dotSize/2, dy - dotSize/2, dotSize, dotSize);
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
    if (isUnpressedReceptor) {
        octx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; 
    } else if (isReceptor) {
        octx.strokeStyle = '#ffffff'; 
    } else {
        octx.strokeStyle = strokeColor; 
    }
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
  const missWindow = 0.220;
  for (let i = 0; i < notes.length; i++) {
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
        playerLife = Math.min(100, playerLife + 6);
        feedbackText = "SYNCED!";
        feedbackTimer = 25;
        updateLifeBar();
        holdEffects.push({
          lane: note.lane,
          x: note.lane * LANE_WIDTH + LANE_WIDTH / 2,
          y: JUDGMENT_LINE_Y,
          progress: 0,
          lifetime: 40,
          color: ARROW_COLORS[note.lane]
        });

        const rect = canvas.getBoundingClientRect();
        const scaleX = rect.width / canvas.width;
        const scaleY = rect.height / canvas.height;
        const screenX = rect.left + (note.lane * LANE_WIDTH + LANE_WIDTH/2) * scaleX;
        const screenY = rect.top + JUDGMENT_LINE_Y * scaleY;
        spawnParticles(screenX, screenY, ARROW_COLORS[note.lane], 30);
        spawnHoldLabel(screenX, screenY, 'HOLD COMPLETE');

        if (combo % 100 === 0 && combo > 0) {
          // combo milestone handled in registerHit, but we also handle here for hold notes
          // skip to avoid duplicate
        }
        continue;
      }
      let xPos = (note.lane * LANE_WIDTH) + 6;
      let width = LANE_WIDTH - 12;
      let tailHeight = ((holdEndTime - currentSongTime) / note.holdDuration) * (note.holdDuration * scrollSpeed);
      ctx.save();
      let holdGrad = ctx.createLinearGradient(0, JUDGMENT_LINE_Y, 0, JUDGMENT_LINE_Y + tailHeight);
      holdGrad.addColorStop(0, '#ffffff');
      holdGrad.addColorStop(0.2, ARROW_COLORS[note.lane]);
      holdGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = holdGrad;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(xPos + width / 4, JUDGMENT_LINE_Y, width / 2, tailHeight);
      ctx.restore();
      continue;
    }
    if (note.hit) {
      if (note.hitAnim > 0) {
        drawArcadeArrow(ctx, (note.lane * LANE_WIDTH) + 6, JUDGMENT_LINE_Y - 32, LANE_WIDTH - 12, 64, note.lane, '#ffffff', ARROW_COLORS[note.lane], false, true);
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
    let noteY = JUDGMENT_LINE_Y + (timeUntilHit * scrollSpeed);
    if (noteY >= -100 && noteY <= canvas.height + 60) {
      if (note.isHold) {
        let xPos = (note.lane * LANE_WIDTH) + 6;
        let width = LANE_WIDTH - 12;
        let tailPixelLength = note.holdDuration * scrollSpeed;
        ctx.save();
        let holdGrad = ctx.createLinearGradient(0, noteY, 0, noteY + tailPixelLength);
        holdGrad.addColorStop(0, ARROW_COLORS[note.lane]);
        holdGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = holdGrad;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(xPos + width / 4, noteY, width / 2, tailPixelLength);
        ctx.restore();
      }
      drawArcadeArrow(ctx, (note.lane * LANE_WIDTH) + 6, noteY - 32, LANE_WIDTH - 12, 64, note.lane, ARROW_COLORS[note.lane], '#ffffff', false, false);
    }
  }
}

function drawHoldEffects() {
  for (let i = holdEffects.length - 1; i >= 0; i--) {
    const ef = holdEffects[i];
    ef.progress += 1 / ef.lifetime;
    const alpha = 1 - ef.progress;
    const radius = 20 + ef.progress * 60;
    ctx.save();
    ctx.globalAlpha = alpha * 0.8;
    ctx.shadowBlur = 30;
    ctx.shadowColor = ef.color;
    ctx.strokeStyle = ef.color;
    ctx.lineWidth = 4 * (1 - ef.progress * 0.5);
    ctx.beginPath();
    ctx.arc(ef.x, ef.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    if (ef.progress >= 1) {
      holdEffects.splice(i, 1);
    }
  }
}

function drawMilestoneEffects() {
  for (let i = milestoneEffects.length - 1; i >= 0; i--) {
    const ef = milestoneEffects[i];
    ef.progress += 1 / ef.lifetime;
    const alpha = 1 - ef.progress;
    const scale = 0.5 + ef.progress * 1.5;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fontSize = 50 * scale;
    ctx.font = `900 ${fontSize}px "Orbitron", sans-serif`;
    ctx.shadowBlur = 40;
    ctx.shadowColor = '#20E8FF';
    const grad = ctx.createLinearGradient(0, canvas.height / 2 - 100, 0, canvas.height / 2 + 100);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#20E8FF');
    ctx.fillStyle = grad;
    ctx.fillText(ef.text, canvas.width / 2, canvas.height / 2 - 20);
    ctx.restore();
    if (ef.progress >= 1) {
      milestoneEffects.splice(i, 1);
    }
  }
}

function drawJudgment() {
  if (feedbackTimer > 0) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.translate(canvas.width / 2, (canvas.height / 2) + 65);
    let scale = 1 + (feedbackTimer / 35) * 0.25;
    ctx.scale(scale, scale);
    ctx.font = "900 36px 'Orbitron', sans-serif";
    
    let color;
    if (feedbackText === "PERFECT!") {
      color = "#20E8FF"; 
    } else if (feedbackText === "GOOD") {
      color = lastHitEarly ? "#FFD700" : "#FF4757"; 
    } else if (feedbackText === "SYNCED!") {
      color = "#FF3ED8"; 
    } else {
      color = "#ff4757"; 
    }
    
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
    
    ctx.translate(canvas.width / 2, (canvas.height / 2) - 20);
    ctx.scale(1 + (comboAnim / 15) * 0.35, 1 + (comboAnim / 15) * 0.35);
    
    ctx.shadowBlur = 35;
    ctx.shadowColor = "#20E8FF";
    
    ctx.font = "900 100px 'Orbitron', sans-serif";
    let grad = ctx.createLinearGradient(0, -50, 0, 20);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#20E8FF');
    ctx.fillStyle = grad;
    ctx.fillText(combo, 0, 0);
    
    ctx.font = "700 18px 'Rajdhani', sans-serif";
    ctx.fillStyle = "#FF3ED8";
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#FF3ED8";
    ctx.fillText("CHAIN LINK", 0, 42);
    ctx.restore();
  }
}