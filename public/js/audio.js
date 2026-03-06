// audio.js - Procedural 8-bit Web Audio Synthesizer

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let audioEnabled = false;

// We must wait for an interaction to unlock audio
document.addEventListener('click', () => {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    audioEnabled = true;
}, { once: true });

function playTone(freq, type, duration, vol = 0.1, slideFreq = null) {
    if (!audioEnabled || audioCtx.state !== 'running') return;

    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.type = type; // 'sine', 'square', 'sawtooth', 'triangle'
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    if (slideFreq) {
        osc.frequency.exponentialRampToValueAtTime(slideFreq, audioCtx.currentTime + duration);
    }

    gainNode.gain.setValueAtTime(vol, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

// ── Gameplay Sound Effects ──

function playMoveSound() {
    playTone(300, 'triangle', 0.1, 0.05);
}

function playCoinSound() {
    // Classic double chime
    playTone(987.77, 'square', 0.1, 0.05); // B5
    setTimeout(() => playTone(1318.51, 'square', 0.3, 0.05), 100); // E6
}

function playHurtSound() {
    // Descending buzz
    playTone(150, 'sawtooth', 0.3, 0.1, 40);
}

function playStartSound() {
    // Arpeggio
    playTone(523.25, 'square', 0.15, 0.05); // C5
    setTimeout(() => playTone(659.25, 'square', 0.15, 0.05), 150); // E5
    setTimeout(() => playTone(783.99, 'square', 0.15, 0.05), 300); // G5
    setTimeout(() => playTone(1046.50, 'square', 0.4, 0.05), 450); // C6
}

function playWheelTick() {
    // Short sharp click
    playTone(800, 'square', 0.02, 0.05, 200);
}

function playItemSound() {
    // Magical twinkling ascent
    playTone(600, 'sine', 0.1, 0.05, 1200);
    setTimeout(() => playTone(800, 'sine', 0.1, 0.05, 1600), 100);
    setTimeout(() => playTone(1000, 'sine', 0.2, 0.05, 2000), 200);
}

function playJoinPop() {
    // Soft pop
    playTone(400, 'sine', 0.1, 0.05, 200);
}

window.SoundFX = {
    move: playMoveSound,
    coin: playCoinSound,
    hurt: playHurtSound,
    start: playStartSound,
    tick: playWheelTick,
    item: playItemSound,
    join: playJoinPop
};
