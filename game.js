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
      const sidebarTrackName = document.getElementById('sidebar-track-name');
      const sidebarBpm = document.getElementById('sidebar-bpm');
      const sidebarTimeLeft = document.getElementById('sidebar-time-left');
      const sidebarDuration = document.getElementById('sidebar-duration');
      const sidebarProgressFill = document.getElementById('sidebar-progress-fill');
      const sidebarLifeFill = document.getElementById('sidebar-life-fill');
      const sidebarLifeVal = document.getElementById('sidebar-life-val');
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
      let score = 0;
      let combo = 0;
      let comboAnim = 0;
      let playerLife = 100;
      let feedbackText = "";
      let feedbackTimer = 0;
      let estimatedBPM = 120;
      let stats = {
        perfect: 0,
        good: 0,
        miss: 0,
        maxCombo: 0
      };
      let currentTrackMeta = {
        artist: "Unknown",
        title: "Unknown Track"
      };
      const LANE_COUNT = 4;
      const LANE_WIDTH = canvas.width / LANE_COUNT;
      const JUDGMENT_LINE_Y = 55;
      let difficultySetting = 'medium';
      let speedMultiplier = 3;
      let scrollSpeed = 1200;
      let laneKeys = ['KeyA', 'KeyS', 'KeyK', 'KeyL'];
      let pressedLanes = [false, false, false, false];
      let listeningLane = null;
      const ARROW_COLORS = ['#22E8FF', '#A63BFF', '#FF2F9E', '#1DE8C0'];

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
          peaks.push({
            energy: energy
          });
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
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        startBtn.innerText = "PROCESSING AUDIO...";
        startBtn.disabled = true;
        try {
          if (!audioCtx) audioCtx = new(window.AudioContext || window.webkitAudioContext)();
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
            if (hitTime < nextAllowedHitTime) {
              i += windowSize;
              continue;
            }
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
              hit: false,
              holding: false,
              missed: false,
              hitAnim: 0
            });
            if (difficulty !== 'easy' && !isHold && (hitTime - lastDoubleTime) > 1.2 && pseudoRandom(hitTime * 55) < doubleChance) {
              lastDoubleTime = hitTime;
              const possible = [];
              for (let l = 0; l < LANE_COUNT; l++) {
                if (l !== lane) possible.push(l);
              }
              let secondLane = possible[Math.floor(pseudoRandom(hitTime * 73) * possible.length)];
              generated.push({
                lane: secondLane,
                targetHitTime: Number(hitTime.toFixed(3)),
                isHold: false,
                holdDuration: 0,
                hit: false,
                holding: false,
                missed: false,
                hitAnim: 0
              });
            }
            if (isHold) {
              nextAllowedHitTime = hitTime + holdDur + 0.35;
            } else {
              nextAllowedHitTime = hitTime + 0.12;
            }
            i += windowSize * skipMultiplier;
          } else {
            i += windowSize;
          }
        }
        return generated;
      }
      startBtn.addEventListener('click', () => {
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
        stats = {
          perfect: 0,
          good: 0,
          miss: 0,
          maxCombo: 0
        };
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
          try {
            audioSource.stop();
          } catch (e) {}
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
            try {
              audioSource.stop();
            } catch (e) {}
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
      }, {
        passive: false
      });
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
      }, {
        passive: false
      });

      function processLaneAction(lane) {
        const currentSongTime = audioCtx.currentTime - songStartTime - totalPausedTime;
        if (currentSongTime < 0) return;
        let targetNote = notes.find(note => !note.hit && !note.missed && note.lane === lane);
        if (!targetNote) return;
        let timeDelta = Math.abs(targetNote.targetHitTime - currentSongTime);
        if (timeDelta <= 0.060) {
          if (targetNote.isHold) {
            targetNote.hit = true;
            targetNote.holding = true;
          } else {
            registerHit(targetNote, "PERFECT!", 300, 'perfect');
          }
        } else if (timeDelta <= 0.120) {
          if (targetNote.isHold) {
            targetNote.hit = true;
            targetNote.holding = true;
          } else {
            registerHit(targetNote, "GOOD", 150, 'good');
          }
        } else if (timeDelta <= 0.180) {
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
        if (type === 'perfect') stats.perfect++;
        else stats.good++;
        feedbackText = grade;
        feedbackTimer = 35;
        updateLifeBar();
      }

      function registerMiss(reason) {
        combo = 0;
        comboAnim = 0;
        feedbackText = reason;
        feedbackTimer = 35;
        stats.miss++;
        playerLife = Math.max(0, playerLife - 3);
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
          try {
            audioSource.stop();
          } catch (e) {}
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
          try {
            audioSource.stop();
          } catch (e) {}
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
              songStartTime = audioCtx.currentTime + prerollDuration;
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
        ctx.save();
        ctx.translate(x + width / 2, y + height / 2);
        let rotation = (lane === 0 ? -Math.PI / 2 : (lane === 1 ? Math.PI : (lane === 2 ? 0 : Math.PI / 2)));
        ctx.rotate(rotation);
        // Chunkier head / narrower stem, closer to a solid neon block-arrow
        let w = width * 0.78;
        let h = height * 0.78;
        const traceArrow = () => {
          const stem = w * 0.12; // thinner shaft
          const head = h * 0.28; // smaller arrow head
          ctx.beginPath();
          // Tip
          ctx.moveTo(0, -h / 2);
          // Right side of head
          ctx.lineTo(w * 0.32, -h / 2 + head);
          // Neck
          ctx.lineTo(stem, -h / 2 + head);
          // Stem
          ctx.lineTo(stem, h / 2);
          ctx.lineTo(-stem, h / 2);
          // Left side
          ctx.lineTo(-stem, -h / 2 + head);
          ctx.lineTo(-w * 0.32, -h / 2 + head);
          ctx.closePath();
        };
        const glowColor = isHitFlash ? '#ffffff' : ARROW_COLORS[lane];
        if (!isReceptor) {
          // Outer soft halo pass (wide, low-opacity blur behind the arrow)
          ctx.save();
          ctx.shadowBlur = isHitFlash ? 40 : 26;
          ctx.shadowColor = glowColor;
          ctx.globalAlpha = 0.9;
          traceArrow();
          ctx.fillStyle = glowColor;
          ctx.fill();
          ctx.restore();
          ctx.shadowBlur = isHitFlash ? 18 : 8;
          ctx.shadowColor = glowColor;
        } else {
          ctx.shadowBlur = 6;
          ctx.shadowColor = glowColor;
        }
        // Crisp fill + outline pass on top
        traceArrow();
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.lineWidth = isReceptor ? 1.5 : 2;
        ctx.strokeStyle = strokeColor;
        ctx.stroke();
        ctx.restore();
      }

      function updateAndDrawNotes(currentSongTime) {
        const missWindow = 0.180;
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
              playerLife = Math.min(100, playerLife + 5);
              feedbackText = "SYNCED!";
              feedbackTimer = 25;
              updateLifeBar();
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
            // Draw hold tail extending behind the note while it approaches
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
            drawArcadeArrow(ctx, (note.lane * LANE_WIDTH) + 6, noteY, LANE_WIDTH - 12, 64, note.lane, ARROW_COLORS[note.lane], '#ffffff', false, false);
          }
        }
      }

      function drawJudgment() {
        if (feedbackTimer > 0) {
          ctx.save();
          ctx.textAlign = "center";
          ctx.translate(canvas.width / 2, JUDGMENT_LINE_Y + 100);
          let scale = 1 + (feedbackTimer / 35) * 0.2;
          ctx.scale(scale, scale);
          ctx.font = "900 30px 'Orbitron', sans-serif";
          let color = feedbackText === "PERFECT!" ? "#20E8FF" : (feedbackText === "GOOD" ? "#8D3CFF" : "#ff4757");
          if (feedbackText === "SYNCED!") color = "#FF3ED8";
          ctx.shadowBlur = 20;
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
          ctx.translate(canvas.width / 2, canvas.height * 0.4);
          ctx.scale(1 + (comboAnim / 15) * 0.3, 1 + (comboAnim / 15) * 0.3);
          ctx.shadowBlur = 25;
          ctx.shadowColor = "#20E8FF";
          ctx.font = "900 70px 'Orbitron', sans-serif";
          let grad = ctx.createLinearGradient(0, -40, 0, 10);
          grad.addColorStop(0, '#ffffff');
          grad.addColorStop(1, '#20E8FF');
          ctx.fillStyle = grad;
          ctx.fillText(combo, 0, 0);
          ctx.font = "700 16px 'Rajdhani', sans-serif";
          ctx.fillStyle = "#FF3ED8";
          ctx.fillText("CHAIN LINK", 0, 28);
          ctx.restore();
        }
      }