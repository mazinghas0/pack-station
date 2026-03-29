/** 효과음 재생 유틸리티 (Web Audio API) */

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

/** 성공 효과음 (짧은 "삐") */
export function playScanSuccess(): void {
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.frequency.value = 1200;
    oscillator.type = 'sine';
    gainNode.gain.value = 0.3;

    oscillator.start(ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    oscillator.stop(ctx.currentTime + 0.15);
  } catch {
    /** 오디오 재생 실패 시 무시 */
  }
}

/** 에러 효과음 (길게 "삐삐삐") */
export function playScanError(): void {
  try {
    const ctx = getAudioContext();

    for (let i = 0; i < 3; i++) {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.frequency.value = 400;
      oscillator.type = 'square';
      gainNode.gain.value = 0.3;

      const startTime = ctx.currentTime + i * 0.2;
      oscillator.start(startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);
      oscillator.stop(startTime + 0.15);
    }
  } catch {
    /** 오디오 재생 실패 시 무시 */
  }
}

/** 완료 효과음 (상승 "빠빠빰") */
export function playComplete(): void {
  try {
    const ctx = getAudioContext();
    const notes = [523, 659, 784];

    notes.forEach((freq, i) => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.frequency.value = freq;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.25;

      const startTime = ctx.currentTime + i * 0.15;
      oscillator.start(startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);
      oscillator.stop(startTime + 0.3);
    });
  } catch {
    /** 오디오 재생 실패 시 무시 */
  }
}
