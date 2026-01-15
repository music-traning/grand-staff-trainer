<script>
  import { onMount, tick } from 'svelte';
  import { Renderer, Stave, StaveNote, Accidental, Formatter } from 'vexflow';
  import Chart from 'chart.js/auto';

  // --- Svelte 5 State ---
  let currentScreen = $state("title");
  let language = $state("jp");
  let showManual = $state(false);
  let instrument = $state("guitar");
  
  // 設定
  let selectedKey = $state("C");
  let selectedRange = $state("full");
  let notationMode = $state("note"); // 'note' | 'degree'

  // ゲーム状態
  let score = $state(0);
  let combo = $state(0);
  let maxComboSession = $state(0);
  let timeLeft = $state(100);
  let isListening = $state(false);
  
  // 音楽処理
  let targetNote = $state("C3"); 
  let detectedNote = $state("-");
  let detectedFreq = $state(0);
  let pitchDiff = $state(0);
  let volume = $state(0);
  let message = $state("");

  // 判定ロジック変数
  let wrongNoteCounter = 0; 
  let penaltyCooldown = false;
  let lastWrongNote = null;
  let ignoreInput = $state(false); 
  let processingAnswer = false;

  // 演出
  let particles = $state([]);
  let shakeIntensity = $state(0);
  let flashIntensity = $state(0);
  let effectLevel = $derived(Math.min(20, Math.floor(combo / 5)));
  let particleIdCounter = 0;

  // 内部変数
  let audioContext = null;
  let analyser = null;
  let microphone = null;
  let mediaStream = null; // 【重要】マイクストリーム管理用
  let dataArray;
  let bufferLength;
  let animationId;
  let timerId;
  let chartInstance = null;
  let missChartInstance = null;
  let staffContainer;
  let chartRef;
  let missChartRef;
  let debugMsg = $state("");

  let userData = $state({
    highScore: 0,
    maxCombo: 0,
    totalPlayTimeSec: 0,
    playCount: 0,
    history: [],
    missStats: {}
  });

  // --- 言語データ ---
  // --- 言語データ (PWA案内追加版) ---
  const t = {
    jp: {
      title: "Grand Staff Trainer",
      start: "演奏を開始する",
      tuner: "チューナーモード",
      analysis: "記録・自己分析",
      guitar: "Guitar",
      bass: "Bass",
      keySelect: "Key Signature (調号)",
      rangeSelect: "Range (音域)",
      notationSelect: "Notation (表記)",
      notations: { note: "Note (音名)", degree: "Degree (度数)" },
      ranges: { low: "Low (低)", mid: "Mid (中)", high: "High (高)", full: "Full Board" },
      score: "Score",
      combo: "Combo",
      target: "Target",
      input: "Input",
      finish: "演奏を終了",
      back: "メニューへ戻る",
      reset: "記録を全消去",
      resetConfirm: "【警告】これまでの練習データが全て消えます。よろしいですか？",
      highScore: "High Score",
      maxCombo: "Max Combo",
      totalTime: "Total Time",
      manualTitle: "How to Play",
      manualDesc: "このアプリは、楽器を使って譜面を読む力を鍛えるトレーニングツールです。",
      steps: [
        "1. 【準備】ブラウザのマイク権限を許可してください。",
        "2. 【演奏】画面の五線譜に表示された音符を、お手持ちのギターやベースで弾いてください。",
        "3. 【判定】正解するとスコア獲得！連続正解（コンボ）で得点が跳ね上がります。",
        "4. 【注意】間違った音を弾き続けると減点となり、コンボが途切れます。",
        "5. 【Tips】スマホでご利用の方は、画面の自動ロック（スリープ）をオフにすると快適です。",
        "6. 【アプリ化】ブラウザのメニューから「ホーム画面に追加」を選ぶと、全画面の専用アプリとしてインストールできます。" // ★追加
      ],
      close: "閉じる",
      msgPerfect: "Perfect!!",
      msgMiss: "Miss...",
      msgReady: "Ready...",
      weakness: "苦手な音 Top 5"
    },
    en: {
      title: "Grand Staff Trainer",
      start: "Start Performance",
      tuner: "Tuner Mode",
      analysis: "My Records",
      guitar: "Guitar",
      bass: "Bass",
      keySelect: "Key Signature",
      rangeSelect: "Range",
      notationSelect: "Notation",
      notations: { note: "Note Name", degree: "Degree" },
      ranges: { low: "Low", mid: "Mid", high: "High", full: "Full Board" },
      score: "Score",
      combo: "Combo",
      target: "Target",
      input: "Input",
      finish: "Finish",
      back: "Back to Menu",
      reset: "Reset Data",
      resetConfirm: "[Warning] This will delete all your practice history. Are you sure?",
      highScore: "High Score",
      maxCombo: "Max Combo",
      totalTime: "Total Time",
      manualTitle: "How to Play",
      manualDesc: "Master the fretboard by playing real notes displayed on the staff.",
      steps: [
        "1. [Setup] Please allow microphone access when prompted.",
        "2. [Play] Play the note shown on the staff using your instrument.",
        "3. [Score] Correct notes build combos and boost your score multiplier.",
        "4. [Penalty] Sustained wrong notes will reset your combo and deduct points.",
        "5. [Tips] For mobile users: It is recommended to disable screen auto-lock.",
        "6. [App] Select 'Add to Home Screen' from your browser menu to install this as a full-screen app." // ★追加
      ],
      close: "Close",
      msgPerfect: "Perfect!!",
      msgMiss: "Miss...",
      msgReady: "Ready...",
      weakness: "Weakest Notes Top 5"
    }
  };
  let text = $derived(t[language]);

  const KEYS = ["C", "G", "D", "A", "E", "B", "F", "Bb", "Eb", "Ab", "Db", "Gb"];
  const RANGES = ["low", "mid", "high", "full"];
  const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  function getDegreeText(noteName, keyName) {
    const note = noteName.replace(/\d+/, ""); 
    const noteIdx = noteStrings.indexOf(note);
    const keyIdx = noteStrings.indexOf(keyName);
    if (noteIdx === -1 || keyIdx === -1) return noteName;
    let diff = (noteIdx - keyIdx + 12) % 12;
    const degrees = { 0: "Root", 1: "b9", 2: "2nd", 3: "b3", 4: "3rd", 5: "4th", 6: "#4/b5", 7: "5th", 8: "b6", 9: "6th", 10: "b7", 11: "7th" };
    return degrees[diff] || "?";
  }

  // --- スケール定義 ---
  const FULL_SCALES_GUITAR = {
    "C":  ["C3","D3","E3","F3","G3","A3","B3","C4","D4","E4","F4","G4","A4","B4","C5"],
    "G":  ["G2","A2","B2","C3","D3","E3","F#3","G3","A3","B3","C4","D4","E4","F#4","G4"],
    "D":  ["D3","E3","F#3","G3","A3","B3","C#4","D4","E4","F#4","G4","A4","B4","C#5","D5"],
    "A":  ["A2","B2","C#3","D3","E3","F#3","G#3","A3","B3","C#4","D4","E4","F#4","G#4","A4"],
    "E":  ["E3","F#3","G#3","A3","B3","C#4","D#4","E4","F#4","G#4","A4","B4","C#5","D#5","E5"],
    "B":  ["B2","C#3","D#3","E3","F#3","G#3","A#3","B3","C#4","D#4","E4","F#4","G#4","A#4","B4"],
    "F":  ["F3","G3","A3","Bb3","C4","D4","E4","F4","G4","A4","Bb4","C5","D5","E5","F5"],
    "Bb": ["Bb2","C3","D3","Eb3","F3","G3","A3","Bb3","C4","D4","Eb4","F4","G4","A4","Bb4"],
    "Eb": ["Eb3","F3","G3","Ab3","Bb3","C4","D4","Eb4","F4","G4","Ab4","Bb4","C5","D5","Eb5"],
    "Ab": ["Ab3","Bb3","C4","Db4","Eb4","F4","G4","Ab4","Bb4","C5","Db5","Eb5","F5","G5","Ab5"],
    "Db": ["Db3","Eb3","F3","Gb3","Ab3","Bb3","C4","Db4","Eb4","F4","Gb4","Ab4","Bb4","C5","Db5"],
    "Gb": ["Gb3","Ab3","Bb3","Cb4","Db4","Eb4","F4","Gb4","Ab4","Bb4","Cb5","Db5","Eb5","F5","Gb5"],
  };

  const FULL_SCALES_BASS = {
    "C":  ["C2","D2","E2","F2","G2","A2","B2","C3","D3","E3","F3","G3"],
    "G":  ["G1","A1","B1","C2","D2","E2","F#2","G2","A2","B2","C3","D3"],
    "D":  ["D2","E2","F#2","G2","A2","B2","C#3","D3","E3","F#3","G3","A3"],
    "A":  ["A1","B1","C#2","D2","E2","F#2","G#2","A2","B2","C#3","D3","E3"],
    "E":  ["E1","F#1","G#1","A1","B1","C#2","D#2","E2","F#2","G#2","A2","B2"],
    "B":  ["B1","C#2","D#2","E2","F#2","G#2","A#2","B2","C#3","D#3","E3","F#3"],
    "F":  ["F2","G2","A2","Bb2","C3","D3","E3","F3","G3","A3","Bb3","C4"],
    "Bb": ["Bb1","C2","D2","Eb2","F2","G2","A2","Bb2","C3","D3","Eb3","F3"],
    "Eb": ["Eb2","F2","G2","Ab2","Bb2","C3","D3","Eb3","F3","G3","Ab3","Bb3"],
    "Ab": ["Ab1","Bb1","C2","Db2","Eb2","F2","G2","Ab2","Bb2","C3","Db3","Eb3"],
    "Db": ["Db2","Eb2","F2","Gb2","Ab2","Bb2","C3","Db3","Eb3","F3","Gb3","Ab3"],
    "Gb": ["Gb2","Ab2","Bb2","Cb3","Db3","Eb3","F3","Gb3","Ab3","Bb3","Cb4","Db4"],
  };

  onMount(() => {
    loadData();
    setInterval(() => {
      if (currentScreen === 'game' && isListening) {
        userData.totalPlayTimeSec++;
        saveData();
      }
    }, 1000);
  });

  // --- 画面表示監視 & クリーンアップ (New) ---
  $effect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopAudio(); // 画面が隠れたらマイク切断
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopAudio(); // コンポーネント破棄時も切断
    };
  });

  function loadData() {
    const saved = localStorage.getItem("buroMusicTrainer");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!parsed.missStats) parsed.missStats = {};
      userData = parsed;
    }
  }
  function saveData() { localStorage.setItem("buroMusicTrainer", JSON.stringify(userData)); }
  function resetData() {
    if(confirm(text.resetConfirm)) {
      userData = { highScore: 0, maxCombo: 0, totalPlayTimeSec: 0, playCount: 0, history: [], missStats: {} };
      saveData();
      renderChart();
    }
  }

  // --- VexFlow ---
  $effect(() => {
    if (currentScreen === 'game' && staffContainer && targetNote) {
      setTimeout(() => { try { drawScore(); } catch (e) { debugMsg = "Error: " + e.message; } }, 50); 
    }
  });

  function drawScore() {
    staffContainer.innerHTML = '';
    const renderer = new Renderer(staffContainer, Renderer.Backends.SVG);
    renderer.resize(280, 160);
    const context = renderer.getContext();
    context.setFont("Arial", 10, "").setBackgroundFillStyle("rgba(255,255,255,0)");

    const stave = new Stave(10, 30, 260);
    const clefType = instrument === 'bass' ? 'bass' : 'treble';
    stave.addClef(clefType).addKeySignature(selectedKey).addTimeSignature('4/4');
    stave.setContext(context).draw();

    const match = targetNote.match(/([A-G][b#]?)(\d)/);
    if (!match) return;
    let noteKey = match[1].toLowerCase();
    let octave = parseInt(match[2]);
    let displayOctave = octave + 1;
    
    const vexKey = `${noteKey}/${displayOctave}`;
    const note = new StaveNote({ keys: [vexKey], duration: "w", clef: clefType });
    Formatter.FormatAndDraw(context, stave, [note]);
  }

  // --- Audio Logic ---
  async function initAudio() {
    if (!audioContext) {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        microphone = audioContext.createMediaStreamSource(mediaStream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        bufferLength = analyser.fftSize;
        dataArray = new Float32Array(bufferLength);
        microphone.connect(analyser);
        audioContext.resume();
        detectPitch();
      } catch (e) { alert("Mic required / マイクを許可してください"); return false; }
    } else if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    return true;
  }

  function stopAudio() {
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
    isListening = false;
  }

  async function startGame() {
    if(await initAudio()) {
      currentScreen = "game";
      score = 0;
      combo = 0;
      maxComboSession = 0;
      isListening = true;
      userData.playCount++;
      message = text.msgReady;
      
      wrongNoteCounter = 0;
      lastWrongNote = null;
      penaltyCooldown = false;
      ignoreInput = false;
      processingAnswer = false;

      nextQuestion();
      startTimer();
    }
  }

  async function openTuner() { if(await initAudio()) { currentScreen = "tuner"; isListening = true; } }
  function openStats() { currentScreen = "stats"; renderChart(); }
  
  function backToTitle() {
    if (currentScreen === 'game' && score > 0) {
      userData.history.push({ date: new Date().toISOString(), score });
      if (score > userData.highScore) userData.highScore = score;
      if (combo > userData.maxCombo) userData.maxCombo = combo;
      if (maxComboSession > userData.maxCombo) userData.maxCombo = maxComboSession;
      saveData();
    }
    stopAudio(); // タイトルに戻るときもマイクを切る
    currentScreen = "title";
    clearInterval(timerId);
  }

  function nextQuestion() {
    const fullScale = instrument === 'bass' ? FULL_SCALES_BASS[selectedKey] : FULL_SCALES_GUITAR[selectedKey];
    let subset = fullScale;
    const len = fullScale.length;
    const third = Math.floor(len / 3);
    
    if (selectedRange === 'low') subset = fullScale.slice(0, third + 2);
    else if (selectedRange === 'mid') subset = fullScale.slice(third, third * 2 + 2);
    else if (selectedRange === 'high') subset = fullScale.slice(third * 2);

    let next;
    let attempts = 0;
    do { next = subset[Math.floor(Math.random() * subset.length)]; attempts++; } 
    while (next === targetNote && subset.length > 1 && attempts < 5);
    targetNote = next;
    
    wrongNoteCounter = 0;
    lastWrongNote = null;
    penaltyCooldown = false;
    processingAnswer = false;
  }

  function startTimer() {
    timeLeft = 100;
    clearInterval(timerId);
    timerId = setInterval(() => {
      if (currentScreen !== 'game') return;
      timeLeft -= 0.3;
      if (timeLeft <= 0) handleMiss("Time Up...");
    }, 50);
  }

  // --- Score Logic ---
  function checkAnswer() {
    if (processingAnswer) return;
    processingAnswer = true; 

    let comboMultiplier = 1 + (combo * 0.2); 
    if (combo > 10) comboMultiplier += 1.0;
    if (combo > 20) comboMultiplier += 2.0;

    const timeBonus = Math.floor(timeLeft);
    const points = Math.floor((100 + timeBonus) * comboMultiplier);
    
    score += points;
    combo++;
    if (combo > maxComboSession) maxComboSession = combo;

    spawnParticles("correct");
    triggerFlash();
    message = `${text.msgPerfect} +${points}`;
    
    ignoreInput = true;
    
    if (combo % 5 === 0) { 
      setTimeout(() => { 
        nextQuestion(); startTimer();
        setTimeout(() => { ignoreInput = false; }, 1000);
      }, 200); 
    } else { 
      nextQuestion(); startTimer();
      setTimeout(() => { ignoreInput = false; }, 1200);
    }
  }

  function handleMiss(reason) {
    if (targetNote && !penaltyCooldown) {
      if (!userData.missStats[targetNote]) userData.missStats[targetNote] = 0;
      userData.missStats[targetNote]++;
    }

    score = Math.max(0, score - 50);
    combo = 0;
    triggerShake();
    message = reason || text.msgMiss;
    
    penaltyCooldown = true;
    setTimeout(() => { 
      penaltyCooldown = false; 
      wrongNoteCounter = 0; 
      lastWrongNote = null; 
    }, 1000);
  }

  // --- Pitch Logic ---
  function detectPitch() {
    if (!audioContext) return;
    analyser.getFloatTimeDomainData(dataArray);
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) sum += dataArray[i] * dataArray[i];
    volume = Math.sqrt(sum / bufferLength);

    if (volume > 0.025) {
      const freq = autoCorrelate(dataArray, audioContext.sampleRate);
      if (freq > -1) {
        detectedFreq = Math.round(freq);
        detectedNote = getNoteFromFreq(freq);
        const noteNum = 12 * (Math.log(freq / 440) / Math.log(2));
        const midiNum = Math.round(noteNum) + 69;
        const targetFreq = 440 * Math.pow(2, (midiNum - 69) / 12);
        pitchDiff = 1200 * Math.log2(freq / targetFreq);

        if (currentScreen === 'game') {
          if (detectedNote === targetNote && !ignoreInput && !processingAnswer) {
            checkAnswer();
          } 
          else if (!ignoreInput && !penaltyCooldown && !processingAnswer && detectedNote !== "-") {
            if (detectedNote === lastWrongNote) {
              wrongNoteCounter++;
            } else {
              lastWrongNote = detectedNote;
              wrongNoteCounter = 1;
            }
            if (wrongNoteCounter > 12) {
              handleMiss();
            }
          }
        }
      }
    } else {
      if (currentScreen === 'tuner') pitchDiff = 0;
      wrongNoteCounter = 0;
      lastWrongNote = null;
    }
    animationId = requestAnimationFrame(detectPitch);
  }

  // FX & Utils
  function spawnParticles(type) {
    const count = type === "correct" ? 12 : 5;
    for (let i = 0; i < count; i++) {
      const id = particleIdCounter++;
      const angle = Math.random() * 360;
      const dist = 60 + Math.random() * 100;
      const color = `hsl(${Math.random()*50 + 40}, 100%, 60%)`; 
      particles.push({ id, tx: Math.cos(angle)*dist, ty: Math.sin(angle)*dist, color });
      setTimeout(() => { particles = particles.filter(p => p.id !== id); }, 600);
    }
  }

  function triggerShake() { shakeIntensity = 1; setTimeout(() => shakeIntensity = 0, 300); }
  function triggerFlash() { flashIntensity = 1; setTimeout(() => flashIntensity = 0, 150); }

  function getNoteFromFreq(f) {
    const n = 12 * (Math.log(f / 440) / Math.log(2));
    const m = Math.round(n) + 69;
    return noteStrings[m % 12] + (Math.floor(m / 12) - 1);
  }

  function autoCorrelate(buf, sampleRate) {
    let size = buf.length, rms = 0;
    for (let i=0;i<size;i++) rms+=buf[i]*buf[i];
    if (Math.sqrt(rms/size)<0.01) return -1;
    let r1=0, r2=size-1, thres=0.2;
    for (let i=0; i<size/2; i++) if (Math.abs(buf[i])<thres) { r1=i; break; }
    for (let i=1; i<size/2; i++) if (Math.abs(buf[size-i])<thres) { r2=size-i; break; }
    buf = buf.slice(r1, r2); size = buf.length;
    let c = new Array(size).fill(0);
    for (let i=0; i<size; i++) for (let j=0; j<size-i; j++) c[i] += buf[j]*buf[j+i];
    let d=0; while (c[d]>c[d+1]) d++;
    let maxval=-1, maxpos=-1;
    for (let i=d; i<size; i++) if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
    let T0 = maxpos;
    let x1=c[T0-1], x2=c[T0], x3=c[T0+1];
    let a = (x1+x3-2*x2)/2; let b = (x3-x1)/2;
    if (a) T0 = T0-b/(2*a);
    return sampleRate/T0;
  }

  async function renderChart() {
    await tick();
    if (!chartRef || !missChartRef) return;
    if (chartInstance) chartInstance.destroy();
    if (missChartInstance) missChartInstance.destroy();

    const labels = userData.history.map((_, i) => `Play ${i + 1}`);
    const data = userData.history.map(h => h.score);
    chartInstance = new Chart(chartRef, {
      type: 'line',
      data: { labels: labels.slice(-10), datasets: [{ label: 'Score', data: data.slice(-10), borderColor: '#d4af37', backgroundColor: 'rgba(212, 175, 55, 0.2)', fill: true }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#333' } }, x: { display: false } } }
    });

    const missEntries = Object.entries(userData.missStats || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
    missChartInstance = new Chart(missChartRef, {
      type: 'bar',
      data: {
        labels: missEntries.map(e => e[0]),
        datasets: [{ label: 'Miss Count', data: missEntries.map(e => e[1]), backgroundColor: '#ff4444', borderColor: '#880000', borderWidth: 1 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, title: { display: true, text: text.weakness, color: '#aaa' } },
        scales: { y: { beginAtZero: true, grid: { color: '#333' } }, x: { ticks: { color: '#ccc' } } }
      }
    });
  }
</script>

<main class="effect-lvl-{effectLevel} {shakeIntensity ? 'shake' : ''}">
  <div class="bg-overlay" class:flash={flashIntensity}></div>

  <header>
    <div class="header-content">
      <div class="lang-switch">
        <button class:active={language === 'jp'} onclick={() => language = 'jp'}>JP</button>
        <button class:active={language === 'en'} onclick={() => language = 'en'}>EN</button>
      </div>
      <h1 class="header-title">Grand Staff Trainer</h1>
      <button class="help-btn" onclick={() => showManual = true}>?</button>
    </div>
  </header>

  {#if currentScreen === 'title'}
    <div class="screen title-screen">
      <div class="title-logo"><span class="logo-icon">𝄞</span><h1>{text.title}</h1></div>
      <div class="menu-container">
        
        <div class="menu-section">
          <h3>Instrument</h3>
          <div class="toggle-group">
            <button class:active={instrument === 'guitar'} onclick={() => instrument = 'guitar'}>{text.guitar}</button>
            <button class:active={instrument === 'bass'} onclick={() => instrument = 'bass'}>{text.bass}</button>
          </div>
        </div>

        <div class="flex-row">
          <div class="menu-section half">
            <h3>{text.notationSelect}</h3>
            <div class="toggle-group">
              <button class:active={notationMode === 'note'} onclick={() => notationMode = 'note'}>Note</button>
              <button class:active={notationMode === 'degree'} onclick={() => notationMode = 'degree'}>Degree</button>
            </div>
          </div>
          <div class="menu-section half">
            <h3>{text.rangeSelect}</h3>
            <div class="toggle-group">
              {#each RANGES as r} <button class:active={selectedRange === r} onclick={() => selectedRange = r}>{r.toUpperCase()}</button> {/each}
            </div>
          </div>
        </div>

        <div class="menu-section">
          <h3>{text.keySelect}</h3>
          <div class="keys-grid">
            {#each KEYS as key} <button class:selected={selectedKey === key} onclick={() => selectedKey = key}>{key}</button> {/each}
          </div>
        </div>

        <div class="action-buttons">
          <button class="main-start-btn" onclick={startGame}><span class="btn-text">{text.start}</span></button>
          <div class="sub-actions">
            <button class="glass-btn" onclick={openTuner}>{text.tuner}</button>
            <button class="glass-btn" onclick={openStats}>{text.analysis}</button>
          </div>
        </div>
      </div>
    </div>

  {:else if currentScreen === 'game'}
    <div class="screen game-screen">
      <div class="hud-bar">
        <div class="hud-stat"><span class="label">{text.score}</span><span class="value">{score}</span></div>
        <div class="hud-stat combo"><span class="label">{text.combo}</span><span class="value gold">{combo}</span></div>
      </div>

      <div class="stage-container">
        <div class="score-card">
          <div class="timer-bar" style="width: {timeLeft}%"></div>
          <div class="staff-wrapper">
            <div class="staff-container" bind:this={staffContainer}></div>
            {#each particles as p (p.id)} <div class="particle" style="--tx: {p.tx}px; --ty: {p.ty}px; --col: {p.color};"></div> {/each}
          </div>
          <div class="target-info">
            {#if notationMode === 'degree'} {getDegreeText(targetNote, selectedKey)} ({selectedKey} Key)
            {:else} {targetNote} ({selectedKey}) {/if}
          </div>
        </div>
      </div>

      <div class="control-panel">
        <div class="monitor-display" class:guard-mode={ignoreInput}>
          <p class="status-msg" class:pulse={flashIntensity}>
            {#if ignoreInput} <span style="font-size:0.8em;opacity:0.7">Guard...</span> {:else} {message} {/if}
          </p>
          <div class="input-readout">
            <span class="input-label">{text.input}:</span>
            <span class="input-val">{detectedNote}</span>
            <div class="vol-bar-bg"><div class="vol-bar" style="width: {Math.min(volume*300, 100)}%"></div></div>
          </div>
        </div>
        <button class="glass-btn finish-btn" onclick={backToTitle}>{text.finish}</button>
      </div>
    </div>

  {:else if currentScreen === 'tuner'}
    <div class="screen center-screen">
      <h2>{text.tuner}</h2>
      <div class="tuner-circle"><div class="note-huge">{detectedNote}</div><div class="freq-sub">{detectedFreq} Hz</div></div>
      <div class="tuning-meter"><div class="needle" style="transform: translateX({Math.max(-140, Math.min(140, pitchDiff*3))}px)"></div><div class="center-marker"></div></div>
      <button class="glass-btn" onclick={backToTitle}>{text.back}</button>
    </div>

  {:else if currentScreen === 'stats'}
    <div class="screen center-screen">
      <h2>{text.analysis}</h2>
      <div class="stats-cards">
        <div class="stat-box"><span>{text.highScore}</span><strong>{userData.highScore}</strong></div>
        <div class="stat-box"><span>{text.maxCombo}</span><strong>{userData.maxCombo}</strong></div>
        <div class="stat-box"><span>{text.totalTime}</span><strong>{Math.floor(userData.totalPlayTimeSec / 60)}m</strong></div>
      </div>
      <div class="chart-flex">
        <div class="chart-wrapper"><canvas bind:this={chartRef}></canvas></div>
        <div class="chart-wrapper"><canvas bind:this={missChartRef}></canvas></div>
      </div>
      <div class="stats-footer">
        <button class="glass-btn danger" onclick={resetData}>{text.reset}</button>
        <button class="glass-btn" onclick={backToTitle}>{text.back}</button>
      </div>
    </div>
  {/if}

  {#if showManual}
    <div class="modal-overlay" onclick={() => showManual = false}>
      <div class="modal-content" onclick={(e) => e.stopPropagation()}>
        <h2>{text.manualTitle}</h2>
        <p class="manual-desc">{text.manualDesc}</p>
        <ul class="manual-list"> {#each text.steps as step} <li>{step}</li> {/each} </ul>
        <button class="glass-btn" onclick={() => showManual = false}>{text.close}</button>
      </div>
    </div>
  {/if}

  <footer class="app-footer"><a href="https://note.com/jazzy_begin" target="_blank" rel="noopener noreferrer">©2026 BURO - Music Lab</a></footer>
</main>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Lato:wght@300;400;700&display=swap');
  :global(body) { margin: 0; background: #050505; color: #eee; font-family: 'Lato', sans-serif; overflow: hidden; }
  :root { --gold: #d4af37; --gold-glow: rgba(212, 175, 55, 0.5); --glass: rgba(255, 255, 255, 0.05); --glass-border: rgba(255, 255, 255, 0.1); --bg-dark: radial-gradient(circle at center, #1b1b22 0%, #000000 100%); --blue-flash: rgba(0, 200, 255, 0.3); }
  h1, h2, h3 { font-family: 'Cinzel', serif; color: var(--gold); margin: 0; text-transform: uppercase; letter-spacing: 2px; }
  main { position: relative; width: 100%; height: 100vh; overflow: hidden; display: flex; flex-direction: column; }
  .bg-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: var(--bg-dark); z-index: -1; transition: opacity 0.2s; }
  .bg-overlay.flash { background: radial-gradient(circle, var(--blue-flash) 0%, transparent 70%); opacity: 1; transition: none; }
  .effect-lvl-1 .bg-overlay { background: radial-gradient(circle, #222 0%, #000 100%); }
  .effect-lvl-5 .bg-overlay { background: radial-gradient(circle, #332200 0%, #000 100%); }
  .effect-lvl-10 .bg-overlay { animation: pulseRed 2s infinite; }
  @keyframes pulseRed { 0%,100% { background: #100; } 50% { background: #300; } }
  header { padding: 10px 20px; background: rgba(0,0,0,0.8); border-bottom: 1px solid #333; z-index: 50; }
  .header-content { display: flex; justify-content: space-between; align-items: center; max-width: 800px; margin: 0 auto; width: 100%; }
  .header-title { font-size: 1rem; display: none; } @media (min-width: 600px) { .header-title { display: block; } }
  .lang-switch button { background: transparent; border: 1px solid #444; color: #666; padding: 4px 8px; cursor: pointer; font-size: 0.75rem; }
  .lang-switch button.active { background: var(--gold); color: #000; border-color: var(--gold); }
  .lang-switch button:first-child { border-radius: 4px 0 0 4px; } .lang-switch button:last-child { border-radius: 0 4px 4px 0; border-left: none; }
  .help-btn { width: 36px; height: 36px; border-radius: 50%; background: transparent; border: 1px solid var(--gold); color: var(--gold); font-family: 'Cinzel', serif; font-weight: bold; cursor: pointer; transition: all 0.3s; }
  .help-btn:hover { background: var(--gold); color: #000; box-shadow: 0 0 10px var(--gold-glow); }
  .screen { flex: 1; display: flex; flex-direction: column; align-items: center; padding: 20px; overflow-y: auto; width: 100%; box-sizing: border-box; }
  .center-screen { justify-content: center; }
  .title-logo { margin: 20px 0 30px; text-align: center; }
  .logo-icon { font-size: 4rem; color: var(--gold); display: block; line-height: 1; text-shadow: 0 0 20px var(--gold-glow); }
  .title-logo h1 { font-size: 1.8rem; text-shadow: 0 2px 5px rgba(0,0,0,0.5); }
  .menu-container { width: 100%; max-width: 500px; display: flex; flex-direction: column; gap: 20px; }
  .menu-section h3 { font-size: 0.8rem; color: #888; margin-bottom: 8px; border-bottom: 1px solid #333; padding-bottom: 4px; }
  .flex-row { display: flex; gap: 10px; width: 100%; }
  .half { flex: 1; }
  .toggle-group { display: flex; background: #111; border-radius: 8px; padding: 4px; gap: 4px; border: 1px solid #333; }
  .toggle-group button { flex: 1; background: transparent; border: none; color: #666; padding: 8px; border-radius: 6px; cursor: pointer; transition: all 0.2s; font-family: 'Lato', sans-serif; font-size: 0.8rem; }
  .toggle-group button.active { background: #333; color: var(--gold); font-weight: bold; box-shadow: 0 2px 5px rgba(0,0,0,0.5); }
  .keys-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
  .keys-grid button { background: #111; border: 1px solid #333; color: #666; padding: 10px 0; border-radius: 4px; cursor: pointer; transition: all 0.2s; }
  .keys-grid button.selected { background: var(--gold); color: #000; font-weight: bold; box-shadow: 0 0 10px var(--gold-glow); border-color: var(--gold); }
  .action-buttons { margin-top: 20px; display: flex; flex-direction: column; gap: 15px; }
  .main-start-btn { background: linear-gradient(135deg, #d4af37, #8a7020); border: none; padding: 18px; border-radius: 50px; cursor: pointer; position: relative; overflow: hidden; transition: transform 0.1s; box-shadow: 0 4px 20px rgba(212, 175, 55, 0.3); }
  .main-start-btn:active { transform: scale(0.98); }
  .btn-text { font-family: 'Cinzel', serif; font-size: 1.2rem; font-weight: bold; color: #1a1a00; letter-spacing: 3px; }
  .sub-actions { display: flex; gap: 10px; }
  .glass-btn { flex: 1; padding: 12px; background: var(--glass); border: 1px solid var(--glass-border); color: #ccc; border-radius: 30px; cursor: pointer; font-family: 'Lato', sans-serif; letter-spacing: 1px; transition: all 0.2s; }
  .glass-btn:hover { border-color: var(--gold); color: var(--gold); background: rgba(255,255,255,0.1); }
  .glass-btn.danger { border-color: #833; color: #f88; }
  .glass-btn.danger:hover { background: rgba(255, 0, 0, 0.1); }
  .hud-bar { display: flex; width: 100%; max-width: 400px; justify-content: space-between; margin-bottom: 10px; padding: 0 10px; }
  .hud-stat { text-align: center; }
  .hud-stat .label { font-size: 0.7rem; color: #666; display: block; font-family: 'Cinzel', serif; }
  .hud-stat .value { font-size: 2rem; font-weight: 300; }
  .hud-stat .value.gold { color: var(--gold); text-shadow: 0 0 10px var(--gold-glow); }
  .stage-container { flex: 1; display: flex; align-items: center; justify-content: center; width: 100%; }
  .score-card { background: #fff; width: 100%; max-width: 320px; height: 240px; border-radius: 12px; position: relative; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.5); display: flex; flex-direction: column; align-items: center; justify-content: center; border: 4px solid #222; }
  .timer-bar { position: absolute; top: 0; left: 0; height: 6px; background: #c00; transition: width 0.1s linear; }
  .staff-wrapper { position: relative; width: 280px; height: 160px; display: flex; align-items: center; justify-content: center; }
  .staff-container :global(svg) { width: 100%; height: 100%; }
  .target-info { color: #444; font-weight: bold; margin-top: 10px; font-family: 'Cinzel', serif; font-size: 1.2rem; }
  .particle { position: absolute; top: 50%; left: 50%; width: 6px; height: 6px; background: var(--col); border-radius: 50%; animation: fly 0.6s ease-out forwards; pointer-events: none; }
  @keyframes fly { to { transform: translate(var(--tx), var(--ty)) scale(0); opacity: 0; } }
  .control-panel { width: 100%; max-width: 400px; margin-top: auto; padding-bottom: 20px; display: flex; flex-direction: column; gap: 15px; }
  .monitor-display { background: #111; border: 1px solid #333; border-radius: 8px; padding: 15px; text-align: center; transition: background 0.3s; }
  .monitor-display.guard-mode { border-color: #444; background: #0a0a0a; opacity: 0.7; }
  .status-msg { height: 20px; margin: 0 0 10px; color: var(--gold); font-family: 'Cinzel', serif; font-size: 1.2rem; }
  .status-msg.pulse { animation: pulse 0.2s; }
  @keyframes pulse { 50% { transform: scale(1.1); color: #fff; } }
  .input-readout { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .input-label { color: #666; font-size: 0.8rem; }
  .input-val { font-size: 1.5rem; font-weight: bold; width: 40px; text-align: center; }
  .vol-bar-bg { flex: 1; height: 4px; background: #333; border-radius: 2px; overflow: hidden; }
  .vol-bar { height: 100%; background: var(--gold); transition: width 0.05s; }
  .tuner-circle { width: 200px; height: 200px; border: 2px solid var(--gold); border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; margin: 30px auto; box-shadow: 0 0 30px rgba(212, 175, 55, 0.1); }
  .note-huge { font-size: 6rem; font-weight: 300; color: #fff; }
  .freq-sub { color: #666; font-family: monospace; margin-top: -10px; }
  .tuning-meter { width: 300px; height: 4px; background: #333; position: relative; margin: 0 auto 40px; }
  .center-marker { position: absolute; left: 50%; top: -10px; width: 2px; height: 24px; background: var(--gold); }
  .needle { width: 10px; height: 10px; background: #fff; border-radius: 50%; position: absolute; top: -3px; left: 50%; margin-left: -5px; transition: transform 0.1s; box-shadow: 0 0 10px #fff; }
  .stats-cards { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; width: 100%; max-width: 500px; margin-bottom: 20px; }
  .stat-box { background: rgba(255,255,255,0.03); padding: 15px 5px; text-align: center; border-radius: 8px; border: 1px solid #333; }
  .stat-box span { display: block; font-size: 0.7rem; color: #888; font-family: 'Cinzel', serif; margin-bottom: 5px; }
  .stat-box strong { font-size: 1.2rem; color: var(--gold); }
  .chart-flex { display: flex; flex-direction: column; gap: 20px; width: 100%; max-width: 500px; margin-bottom: 20px; }
  .chart-wrapper { width: 100%; height: 180px; position: relative; }
  .stats-footer { display: flex; gap: 10px; width: 100%; max-width: 500px; }
  .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 100; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(5px); }
  .modal-content { background: #1a1a1a; padding: 30px; border-radius: 12px; border: 1px solid var(--gold); max-width: 400px; width: 90%; }
  .manual-desc { color: #aaa; margin-bottom: 20px; font-size: 0.9rem; }
  .manual-list { text-align: left; padding-left: 20px; color: #ccc; margin: 20px 0; line-height: 1.6; }
  .app-footer { background: #000; border-top: 1px solid #222; padding: 10px; text-align: center; font-size: 0.7rem; color: #444; z-index: 60; margin-top: auto; }
  .app-footer a { color: #666; text-decoration: none; transition: color 0.2s; }
  .app-footer a:hover { color: var(--gold); }
  .shake { animation: shake 0.3s cubic-bezier(.36,.07,.19,.97) both; }
  @keyframes shake { 10%, 90% { transform: translate3d(-2px, 0, 0); } 20%, 80% { transform: translate3d(4px, 0, 0); } }
</style>