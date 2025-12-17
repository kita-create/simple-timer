document.addEventListener("DOMContentLoaded", () => {
  function normalizeDigits(str) {
    return (str || "")
      .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/[^0-9]/g, "");
  }

  function isMobileLike() {
    return (
      window.matchMedia?.("(pointer: coarse)").matches ||
      window.matchMedia?.("(hover: none)").matches ||
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    );
  }

  // ===== Elements =====
  const displayContainer = document.getElementById("timer-display-container");
  const hiddenInput = document.getElementById("timer-input-hidden");

  const timerCard = document.querySelector(".timer-card");

  const hoursSpan = document.getElementById("display-hours");
  const minutesSpan = document.getElementById("display-minutes");
  const secondsSpan = document.getElementById("display-seconds");

  const startBtn = document.getElementById("btn-start");
  const resetBtn = document.getElementById("btn-reset");
  // ===== Icons =====
  const playIcon = startBtn.querySelector(".icon-play");
  const pauseIcon = startBtn.querySelector(".icon-pause");
  const resetIcon = resetBtn.querySelector(".icon-reset");
  const clearIcon = resetBtn.querySelector(".icon-clear");

  function setStartIcon(mode) {
    // mode: "play" | "pause"
    if (!playIcon || !pauseIcon) return;
    playIcon.classList.toggle("is-hidden", mode !== "play");
    pauseIcon.classList.toggle("is-hidden", mode !== "pause");
    const label = mode === "pause" ? "Pause" : "Start";
    startBtn.setAttribute("aria-label", label);
    startBtn.setAttribute("title", label);
  }

  function setResetIcon(mode) {
    // mode: "reset" | "clear"
    if (!resetIcon || !clearIcon) return;
    resetIcon.classList.toggle("is-hidden", mode !== "reset");
    clearIcon.classList.toggle("is-hidden", mode !== "clear");
    const label = mode === "clear" ? "Clear" : "Reset";
    resetBtn.setAttribute("aria-label", label);
    resetBtn.setAttribute("title", label);
  }

  const soundToggle = document.getElementById("sound-toggle");
  const toggleLabel = document.querySelector(".toggle-label");
  const volumeSlider = document.getElementById("sound-volume");
  const soundTestBtn = document.getElementById("btn-sound-test");
  const timeAddWrap = document.getElementById("time-add");
  const timeAddBtns = timeAddWrap?.querySelectorAll("[data-add]") || [];


  if (!displayContainer || !hiddenInput || !hoursSpan || !minutesSpan || !secondsSpan || !startBtn || !resetBtn) {
    console.error("Required elements missing.");
    return;
  }

  // ===== State =====
  let timerInterval = null;
  let totalSeconds = 0;
  let presetSeconds = 0;
  let lockedPresetSeconds = 0;
  let isRunning = false;
  let isPaused = false;
  let rawDigits = "";

  let isComposing = false;
  let ignoreClickUntil = 0;
  // ★ 追加：終了（アラーム中）状態
  let isAlarming = false;

  // ===== Sound =====
  const ALARM_SRC = "assets/audio/alarm.mp3"; // ここに音源を置く（パスは必要なら変更）
  const alarm = new Audio(ALARM_SRC);
  alarm.preload = "auto";

  const LS_SOUND_ON = "simpleTimer_soundOn";
  const LS_SOUND_VOL = "simpleTimer_soundVol";

  let alarmTimeoutId = null;
  let alarmCount = 0;

  let alarmGlowTimeoutId = null;

  function startAlarmWithGap(times = 10, gapMs = 2000) {
    if (!soundToggle?.checked) return;

    stopAlarm(); // 念のため既存アラーム停止
    alarmCount = 0;

    function playOnce() {
      if (alarmCount >= times) {
        // ★ アラーム完走したら、発光は止める（終了状態は維持してOK）
        resetBtn.classList.remove("alarm-attn");
        stopAlarm();
        return;
      }

      try {
        alarm.currentTime = 0;
        alarm.play();
      } catch (_) { }

      alarmCount++;
      alarmTimeoutId = setTimeout(playOnce, gapMs);
    }

    playOnce();
  }

  function stopAlarm() {
    if (alarmTimeoutId) {
      clearTimeout(alarmTimeoutId);
      alarmTimeoutId = null;
    }

    if (alarmGlowTimeoutId) {
      clearTimeout(alarmGlowTimeoutId);
      alarmGlowTimeoutId = null;
    }
    alarmCount = 0;

    try {
      alarm.pause();
      alarm.currentTime = 0;
    } catch (_) { }
  }



  // 初期値（localStorage優先）
  if (soundToggle) {
    const savedOn = localStorage.getItem(LS_SOUND_ON);
    if (savedOn !== null) soundToggle.checked = savedOn === "1";
  }
  if (volumeSlider) {
    const savedVol = localStorage.getItem(LS_SOUND_VOL);
    if (savedVol !== null) volumeSlider.value = savedVol;
  }

  // 反映
  function applySoundUI() {
    const on = !!soundToggle?.checked;
    const vol = volumeSlider ? (Number(volumeSlider.value) / 100) : 0.5;

    alarm.volume = Math.min(1, Math.max(0, vol));

    if (toggleLabel) toggleLabel.textContent = on ? "Sound ON" : "Sound OFF";
    if (volumeSlider) volumeSlider.disabled = !on;
    if (soundTestBtn) soundTestBtn.disabled = !on;
    soundToggle?.closest(".sound-icon-toggle")?.setAttribute("title", soundToggle.checked ? "Sound ON" : "Sound OFF");

  }

  applySoundUI();


  // 初期状態
  displayContainer.classList.add("idle");

  function setIdle(on) {
    displayContainer.classList.toggle("idle", !!on);
  }

  function setFocused(on) {
    displayContainer.classList.toggle("focused", !!on);
  }

  function setEditing(on) {
    displayContainer.classList.toggle("editing", !!on);
    if (on) setIdle(false);
  }

  function clearPausedIfEditing() {
    if (!isRunning && isPaused) {
      isPaused = false;
      displayContainer.classList.remove("paused");
    }
  }

  // 集中モード（時間が入ったらタイマー以外を隠す）
  function setFocusMode(on) {
    document.body.classList.toggle("focus-mode", !!on);
  }

  function setResetMode(mode) {
    const m = mode === "clear" ? "clear" : "reset";
    resetBtn.dataset.mode = m;
    setResetIcon(m);

    resetBtn.classList.toggle("is-clear", m === "clear");
    resetBtn.setAttribute("aria-label", m === "clear" ? "クリア" : "リセット");
  }

  function setResetEnabled(enabled) {
    resetBtn.disabled = !enabled;
  }

  function releaseTypingFocus() {
    if (document.activeElement === hiddenInput) hiddenInput.blur();
    setFocused(false);
    setEditing(false);
    if (!isRunning) setIdle(true);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseTypingFocus();
  });
  window.addEventListener("blur", releaseTypingFocus);
  window.addEventListener("pagehide", releaseTypingFocus);

  // 追加：時間が入ったら focus-mode にする（Start起点ではなく入力起点）
  function updateFocusModeAuto() {
    const on = (isRunning || isAlarming || totalSeconds > 0);
    setFocusMode(on);
  }


  // ===== Rendering =====
  function renderSpan(spanElement, text, offsetIndex, threshold) {
    const cls1 = offsetIndex < threshold ? "digit-dim" : "digit-active";
    const cls2 = offsetIndex + 1 < threshold ? "digit-dim" : "digit-active";
    spanElement.innerHTML = `<span class="${cls1}">${text[0]}</span><span class="${cls2}">${text[1]}</span>`;
  }

  function renderSpanCountDown(spanElement, text) {
    spanElement.innerHTML = `<span class="digit-active">${text[0]}</span><span class="digit-active">${text[1]}</span>`;
  }

  function updateColonsByThreshold(threshold) {
    const colons = displayContainer.querySelectorAll(".colon");
    if (!colons || colons.length < 2) return;

    const hoursActive = (0 >= threshold) || (1 >= threshold);
    const minutesActive = (2 >= threshold) || (3 >= threshold);
    const secondsActive = (4 >= threshold) || (5 >= threshold);

    colons[0].classList.toggle("is-active", hoursActive && minutesActive);
    colons[1].classList.toggle("is-active", minutesActive && secondsActive);
  }

  function updateDisplayFromRaw() {
    const safe = (rawDigits || "").slice(-6);
    const padded = safe.padStart(6, "0");

    const hStr = padded.slice(0, 2);
    const mStr = padded.slice(2, 4);
    const sStr = padded.slice(4, 6);

    const threshold = isPaused ? 0 : (6 - safe.length);
    updateColonsByThreshold(threshold);

    renderSpan(hoursSpan, hStr, 0, threshold);
    renderSpan(minutesSpan, mStr, 2, threshold);
    renderSpan(secondsSpan, sStr, 4, threshold);

    totalSeconds = parseInt(hStr, 10) * 3600 + parseInt(mStr, 10) * 60 + parseInt(sStr, 10);

    if (!isPaused) {
      presetSeconds = totalSeconds;
      setResetMode(totalSeconds > 0 ? "clear" : "reset");
    }

    document.title =
      totalSeconds > 0
        ? `${hStr}:${mStr}:${sStr} - Simple Timer`
        : "ブラウザで使えるシンプルなタイマー";

    startBtn.disabled = totalSeconds === 0;
    updateFocusModeAuto();
    if (timeAddWrap) {
      timeAddWrap.hidden = !(presetSeconds > 0);
    }
    setResetEnabled(!isRunning && (presetSeconds > 0 || totalSeconds > 0));
  }

  function updateDisplayCountDown(timeLeft) {
    const h = Math.floor(timeLeft / 3600);
    const m = Math.floor((timeLeft % 3600) / 60);
    const s = timeLeft % 60;

    const hStr = String(h).padStart(2, "0");
    const mStr = String(m).padStart(2, "0");
    const sStr = String(s).padStart(2, "0");

    renderSpanCountDown(hoursSpan, hStr);
    renderSpanCountDown(minutesSpan, mStr);
    renderSpanCountDown(secondsSpan, sStr);

    updateColonsByThreshold(0);

    document.title = `${hStr}:${mStr}:${sStr} - Simple Timer`;
  }

  function setRawDigitsFromTotalSeconds() {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    const hStr = String(h).padStart(2, "0");
    const mStr = String(m).padStart(2, "0");
    const sStr = String(s).padStart(2, "0");

    // 先頭の 00 を「未入力扱い」にしたいので rawDigits を短くする
    if (hStr !== "00") {
      rawDigits = hStr + mStr + sStr;   // 6桁
    } else if (mStr !== "00") {
      rawDigits = mStr + sStr;         // 4桁（= 00:mm:ss の 00 が dim になる）
    } else if (sStr !== "00") {
      rawDigits = sStr;                // 2桁（= 00:00:ss の 00:00 が dim になる）
    } else {
      rawDigits = "";                  // 全部 00 のときは未入力状態
    }
  }

  function addSecondsByChip(deltaSec) {
    if (isRunning) return; // 走行中に足す仕様にしないならガード
    totalSeconds = Math.max(0, totalSeconds + deltaSec);

    // 「設定した時間へ戻す」系の挙動に合わせるならここも更新
    presetSeconds = totalSeconds;

    setRawDigitsFromTotalSeconds();
    updateDisplayFromRaw(); // ← これで threshold/コロン/桁色がキーボード入力と同じルールで揃う
  }


  // ===== Core =====
  function startTimer() {
    if (document.activeElement === hiddenInput) hiddenInput.blur();

    if (isRunning) {
      stopTimer(true);
      return;
    }
    if (totalSeconds <= 0) return;

    // Startした瞬間に集中モードへ
    // setFocusMode(true);

    // ★ここを削除：再生のたびに「残り時間」をpreset扱いにしない
    // presetSeconds = totalSeconds;

    setResetMode("reset");

    isRunning = true;
    document.body.classList.add("is-running");
    isPaused = false;

    // 追加：再生に入ったらポーズ見た目を解除
    timerCard?.classList.remove("is-paused");

    displayContainer.classList.remove("paused", "idle");
    displayContainer.classList.add("is-running");
    displayContainer.dataset.running = "true";

    setStartIcon("pause");

    startBtn.classList.add("is-stop");
    updateDisplayCountDown(totalSeconds);

    setFocused(false);
    setEditing(false);
    setIdle(false);

    displayContainer.style.pointerEvents = "none";

    timerInterval = setInterval(() => {
      totalSeconds--;
      updateDisplayCountDown(Math.max(0, totalSeconds));

      if (totalSeconds <= 0) {
        finishTimer();
        return;
      }
    }, 1000);
  }


  function stopTimer(pause) {
    stopAlarm();
    clearInterval(timerInterval);
    isRunning = false;
    document.body.classList.add("is-running");

    setStartIcon("play");

    startBtn.classList.remove("is-stop");

    displayContainer.dataset.running = "false";
    displayContainer.style.pointerEvents = "auto";
    displayContainer.classList.remove("is-running");
    displayContainer.classList.add("idle");

    setResetEnabled(true);

    if (pause) {
      // 一時停止中も「タイマーだけ」でいいなら集中モードは維持
      // 追加：ポーズ中の見た目をON
      timerCard?.classList.add("is-paused");
      isPaused = true;
      displayContainer.classList.add("paused");

      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      const s = totalSeconds % 60;

      rawDigits = String(h).padStart(2, "0") + String(m).padStart(2, "0") + String(s).padStart(2, "0");
      updateDisplayFromRaw();
      setResetMode("reset");
      setIdle(true);
      setEditing(false);
      setFocused(false);
    }
  }

  function finishTimer() {
    clearInterval(timerInterval);

    // 終了状態へ
    isRunning = false;
    isPaused = false;
    isAlarming = true;
    updateFocusModeAuto();

    document.body.classList.remove("is-running");

    // 0表示をキープ
    totalSeconds = 0;
    updateDisplayCountDown(0);

    // Startは再生アイコンに戻すが押せない
    setStartIcon("play");
    startBtn.classList.remove("is-stop");
    startBtn.disabled = true;

    // Resetは押せるようにして、アイコンはResetへ（Clearにはしない）
    setResetEnabled(true);
    setResetMode("reset");

    // 表示側の状態（入力はできる状態に戻すが、0のまま）
    displayContainer.dataset.running = "false";
    displayContainer.style.pointerEvents = "auto";
    displayContainer.classList.remove("is-running", "paused", "editing", "focused");
    displayContainer.classList.add("idle");
    displayContainer.classList.add("alarming");
    document.body.classList.add("is-alarming");
    resetBtn.classList.add("alarm-attn");

    // 終了音：2.5秒間隔で10回（現状仕様のまま）
    startAlarmWithGap(10, 2500);

    // ★Sound OFF のときは、発光を短時間で自動停止（鳴らないので完走フックが無い）
    if (!soundToggle?.checked) {
      if (alarmGlowTimeoutId) clearTimeout(alarmGlowTimeoutId);
      alarmGlowTimeoutId = setTimeout(() => {
        resetBtn.classList.remove("alarm-attn");
        alarmGlowTimeoutId = null;
      }, 12000);
    } else {
      // Sound ON なら startAlarmWithGap 側の完走処理で消える想定なので何もしない
    }
  }

  function resetUI() {
    document.body.classList.remove("is-alarming");
    resetBtn.classList.remove("alarm-attn");
    stopAlarm();
    clearInterval(timerInterval);

    isRunning = false;
    isPaused = false;
    isAlarming = false;

    // 追加：ポーズ見た目を解除
    timerCard?.classList.remove("is-paused");

    document.body.classList.remove("is-running");
    rawDigits = "";
    totalSeconds = 0;
    presetSeconds = 0;

    hiddenInput.value = "";

    displayContainer.dataset.running = "false";
    displayContainer.classList.remove("paused", "is-running", "editing", "focused");
    displayContainer.classList.add("idle");
    displayContainer.style.pointerEvents = "auto";

    setStartIcon("play");

    startBtn.classList.remove("is-stop");
    document.title = "ブラウザで使えるシンプルなタイマー";

    setResetMode("reset");
    updateDisplayFromRaw();

    // 0に戻したら集中モード解除（元の説明・リンクを戻す）
    setFocusMode(false);
  }

  function resetToPreset(stopSound = true) {
    document.body.classList.remove("is-alarming");
    resetBtn.classList.remove("alarm-attn");
    displayContainer.classList.remove("alarming");
    if (stopSound) stopAlarm();
    clearInterval(timerInterval);

    isRunning = false;

    // 追加：reset でポーズ見た目は解除（必要なら好みで維持も可）
    timerCard?.classList.remove("is-paused");

    setStartIcon("play");
    startBtn.classList.remove("is-stop");

    displayContainer.dataset.running = "false";
    displayContainer.style.pointerEvents = "auto";
    displayContainer.classList.remove("is-running");

    totalSeconds = Math.max(0, presetSeconds);

    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    rawDigits =
      String(h).padStart(2, "0") +
      String(m).padStart(2, "0") +
      String(s).padStart(2, "0");

    hiddenInput.value = "";

    isPaused = true;
    displayContainer.classList.add("paused", "idle");
    setIdle(true);
    setEditing(false);
    setFocused(false);

    updateDisplayFromRaw();
    setResetMode("clear");

    // resetでも集中モードは維持
    setFocusMode(true);
  }


  // ===== Input focus =====
  let editingReleaseTimer = null;

  function focusForTyping() {
    if (isRunning) return;
    if (isAlarming) return;

    isPaused = false;
    displayContainer.classList.remove("paused");

    setIdle(false);
    setFocused(true);
    setEditing(true);

    if (editingReleaseTimer) clearTimeout(editingReleaseTimer);
    editingReleaseTimer = setTimeout(() => {
      if (!isRunning && document.activeElement !== hiddenInput) {
        setEditing(false);
        setFocused(false);
        setIdle(true);
      }
    }, 2500);

    if (isMobileLike()) {
      try { hiddenInput.focus({ preventScroll: true }); } catch (_) { hiddenInput.focus(); }
      setTimeout(() => {
        if (isRunning) return;
        try { hiddenInput.focus({ preventScroll: true }); } catch (_) { hiddenInput.focus(); }
      }, 0);
    }
  }

  displayContainer.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    focusForTyping();
  });

  displayContainer.addEventListener("click", focusForTyping);

  hiddenInput.addEventListener("focus", () => {
    if (isAlarming) { // ★追加
      hiddenInput.blur();
      return;
    }
    setFocused(true);
    setEditing(true);
    setIdle(false);
  });

  hiddenInput.addEventListener("blur", () => {
    setFocused(false);
    setEditing(false);
    if (!isRunning) setIdle(true);
  });

  // ===== EnterキーでStart（スマホ/PC共通）=====
  hiddenInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;

    e.preventDefault();

    // キーボードを閉じたいなら
    hiddenInput.blur();

    if (!startBtn.disabled) startTimer();
  });


  // ===== IME composition handling =====
  hiddenInput.addEventListener("compositionstart", () => {
    isComposing = true;
    setFocused(true);
    setEditing(true);
    setIdle(false);
  });

  hiddenInput.addEventListener("compositionend", () => {
    isComposing = false;

    if (isRunning) {
      hiddenInput.value = "";
      return;
    }

    clearPausedIfEditing();

    const nums = normalizeDigits(hiddenInput.value);
    if (nums) {
      rawDigits += nums;
      rawDigits = rawDigits.slice(-6);
      updateDisplayFromRaw();
    }

    hiddenInput.value = "";
  });

  // ===== スマホ入力：beforeinput =====
  if (isMobileLike()) {
    hiddenInput.addEventListener("beforeinput", (e) => {
      if (isRunning) return;
      if (isComposing) return;

      try { e.preventDefault(); } catch (_) { }

      clearPausedIfEditing();

      const it = e.inputType || "";

      if (it === "deleteContentBackward") {
        rawDigits = rawDigits.slice(0, -1);
        hiddenInput.value = "";
        updateDisplayFromRaw();
        return;
      }

      const data = normalizeDigits(e.data || "");
      if (data) {
        rawDigits += data;
        rawDigits = rawDigits.slice(-6);
        hiddenInput.value = "";
        updateDisplayFromRaw();
        return;
      }

      const v = normalizeDigits(hiddenInput.value);
      if (v) {
        rawDigits += v;
        rawDigits = rawDigits.slice(-6);
        hiddenInput.value = "";
        updateDisplayFromRaw();
      } else {
        hiddenInput.value = "";
      }
    });

    hiddenInput.addEventListener("input", () => {
      hiddenInput.value = "";
    });
  } else {
    hiddenInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        hiddenInput.blur();
        if (!startBtn.disabled) startTimer();
      }
    });
  }

  // ===== Buttons =====
  startBtn.addEventListener("pointerup", (e) => {
    if (startBtn.disabled) return;
    e.preventDefault();
    ignoreClickUntil = Date.now() + 600;
    startTimer();
  });

  startBtn.addEventListener("click", () => {
    if (Date.now() < ignoreClickUntil) return;
    startTimer();
  });

  resetBtn.addEventListener("click", () => {
    // ★ 終了（アラーム中）なら：presetに戻して再スタート可能にする
    if (isAlarming) {
      isAlarming = false;
      resetToPreset(true); // stopSound=true でアラーム停止＋presetへ復帰＋Clear化まで既存関数で完了
      return;
    }

    const mode = resetBtn.dataset.mode || "reset";
    if (mode === "clear") {
      resetUI();
      return;
    }
    resetToPreset();
  });


  // ===== Global shortcuts（PC専用）=====
  document.addEventListener("keydown", (e) => {
    if (isMobileLike()) return;

    const el = document.activeElement;
    const tag = el?.tagName || "";

    // テキスト入力中だけはショートカットを止める。
    // checkbox / range などは止めない（クリック後も数字入力できるようにする）
    let isTypingField = false;

    if (tag === "TEXTAREA" || tag === "SELECT") {
      isTypingField = true;
    } else if (tag === "INPUT") {
      const type = (el.getAttribute("type") || "").toLowerCase();
      const nonTextTypes = new Set([
        "checkbox", "range", "radio", "button", "submit", "reset", "color", "file"
      ]);
      isTypingField = !nonTextTypes.has(type);
    } else if (el?.isContentEditable) {
      isTypingField = true;
    }

    if (isTypingField) return;


    if (e.key === "Enter") {
      e.preventDefault();
      if (!startBtn.disabled || isRunning) startTimer();
      return;
    }

    if (e.code === "Space") {
      if (document.activeElement?.tagName === "BUTTON") return;
      e.preventDefault();
      startTimer();
      return;
    }

    if (e.key.toLowerCase() === "r") {
      e.preventDefault();
      resetBtn.click();
      return;
    }

    // ★ アラーム中は数字入力不可
    if (!isRunning && !isAlarming && /^\d$/.test(e.key)) {
      e.preventDefault();
      clearPausedIfEditing();
      setIdle(false);
      setFocused(true);
      setEditing(true);

      rawDigits += e.key;
      rawDigits = rawDigits.slice(-6);
      updateDisplayFromRaw();
      return;
    }

    // ★ アラーム中はBackspace不可
    if (!isRunning && !isAlarming && e.key === "Backspace") {
      e.preventDefault();
      clearPausedIfEditing();
      rawDigits = rawDigits.slice(0, -1);
      updateDisplayFromRaw();
      return;
    }
  });


  if (soundToggle) {
    soundToggle.addEventListener("change", () => {
      localStorage.setItem(LS_SOUND_ON, soundToggle.checked ? "1" : "0");
      applySoundUI();
    });
  }

  if (volumeSlider) {
    volumeSlider.addEventListener("input", () => {
      localStorage.setItem(LS_SOUND_VOL, String(volumeSlider.value));
      applySoundUI();
    });
  }

  // ===== Time Add Chips =====
  if (timeAddWrap && timeAddBtns.length) {
    timeAddBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (isAlarming) return;

        const add = Number(btn.dataset.add || "0");
        if (!Number.isFinite(add) || add <= 0) return;

        // 再生中は残り時間に足して、そのまま表示更新
        if (isRunning) {
          totalSeconds = Math.max(0, totalSeconds) + add;
          updateDisplayCountDown(totalSeconds);
          return;
        }

        // 停止中（入力状態）は「入力と同じ表示ルール」に揃える
        totalSeconds = Math.max(0, totalSeconds) + add;

        // rawDigits を入力っぽい桁数に戻して表示更新（コロン仕様も揃う）
        setRawDigitsFromTotalSeconds();
        updateDisplayFromRaw();
      });
    });
  }

  if (soundTestBtn) {
    soundTestBtn.addEventListener("click", async () => {
      if (!soundToggle?.checked) return;

      try {
        alarm.currentTime = 0;
        await alarm.play();
      } catch (err) {
        // 自動再生制限などで失敗する端末があるので握りつぶす（UIは壊さない）
        console.warn("Sound test failed:", err);
      }
    });
  }

  // Init
  setResetMode("reset");
  updateDisplayFromRaw();
  setStartIcon("play");
  setResetIcon("reset");

  setFocusMode(false);

  function setPageInactive(inactive) {
    document.body.classList.toggle("page-inactive", inactive);

    // 念のため、非アクティブ化した瞬間に「入力状態」を解除しておく（好み）
    if (inactive) {
      setFocused(false);
      setEditing(false);
    }
  }

  // 初期状態
  setPageInactive(document.visibilityState !== "visible");

  // タブ切替・別ウィンドウ移動で発火
  document.addEventListener("visibilitychange", () => {
    setPageInactive(document.visibilityState !== "visible");
  });

  // さらに確実にする（ウィンドウフォーカスでも制御）
  window.addEventListener("blur", () => setPageInactive(true));
  window.addEventListener("focus", () => setPageInactive(false));


});
