// assets/js/player.js — Audio Engine with Web Audio API, Equalizer & Offline Playback
import { getOfflineAudio } from './db.js';

export class AudioEngine {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audioContext = null;
    this.sourceNode = null;
    this.analyser = null;
    this.gainNode = null;
    this.eqNodes = {};
    this.convolver = null;
    this.reverbGain = null;
    this.dryGain = null;

    this.currentTrack = null;
    this.playlist = [];
    this.queue = [];
    this.currentIndex = -1;
    this.isPlaying = false;
    this.isShuffle = false;
    this.repeatMode = 'all'; // 'none' | 'all' | 'one'
    this.shuffledIndices = [];

    this.listeners = {
      trackChange: [],
      playState: [],
      timeUpdate: [],
      queueChange: [],
      audioEnded: []
    };

    this.initAudioEvents();
  }

  initAudioContext() {
    if (this.audioContext) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
      this.sourceNode = this.audioContext.createMediaElementSource(this.audio);

      // Analyser for visualizer
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.8;

      // 5-Band Equalizer: 60Hz, 250Hz, 1kHz, 4kHz, 12kHz
      const freqs = [60, 250, 1000, 4000, 12000];
      const types = ['lowshelf', 'peaking', 'peaking', 'peaking', 'highshelf'];

      let prevNode = this.sourceNode;
      freqs.forEach((freq, idx) => {
        const filter = this.audioContext.createBiquadFilter();
        filter.type = types[idx];
        filter.frequency.value = freq;
        filter.gain.value = 0;
        prevNode.connect(filter);
        prevNode = filter;
        this.eqNodes[freq] = filter;
      });

      // Spatial Fontaine Reverb setup
      this.convolver = this.audioContext.createConvolver();
      this.generateFontaineImpulseResponse();

      this.reverbGain = this.audioContext.createGain();
      this.reverbGain.gain.value = 0.0; // dry by default

      this.dryGain = this.audioContext.createGain();
      this.dryGain.gain.value = 1.0;

      // Gain master
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 1.0;

      // Connect dry/wet paths
      prevNode.connect(this.dryGain);
      prevNode.connect(this.convolver);
      this.convolver.connect(this.reverbGain);

      this.dryGain.connect(this.gainNode);
      this.reverbGain.connect(this.gainNode);

      this.gainNode.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
    } catch (e) {
      console.warn('Web Audio API not fully available or autoplay blocked:', e);
    }
  }

  // Create an acoustic Fontaine Opera Hall impulse response algorithmically
  generateFontaineImpulseResponse() {
    if (!this.audioContext) return;
    const rate = this.audioContext.sampleRate;
    const length = rate * 2.2; // 2.2s decay
    const impulse = this.audioContext.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const decay = Math.exp(-i / (rate * 0.7));
      left[i] = (Math.random() * 2 - 1) * decay;
      right[i] = (Math.random() * 2 - 1) * decay;
    }
    this.convolver.buffer = impulse;
  }

  // Apply Equalizer Preset
  setEqualizerPreset(presetName) {
    this.initAudioContext();
    if (!this.audioContext) return;

    const presets = {
      flat: { 60: 0, 250: 0, 1000: 0, 4000: 0, 12000: 0, reverb: 0 },
      bass_boost: { 60: 7, 250: 4, 1000: 0, 4000: -1, 12000: 1, reverb: 0 },
      vocal: { 60: -2, 250: 2, 1000: 6, 4000: 3, 12000: 2, reverb: 0.1 },
      opera_hall: { 60: 3, 250: 1, 1000: 2, 4000: 5, 12000: 6, reverb: 0.38 },
      hifi: { 60: 4, 250: 2, 1000: -1, 4000: 3, 12000: 5, reverb: 0.05 }
    };

    const cfg = presets[presetName] || presets.flat;
    Object.keys(this.eqNodes).forEach(freq => {
      if (this.eqNodes[freq] && cfg[freq] !== undefined) {
        this.eqNodes[freq].gain.setTargetAtTime(cfg[freq], this.audioContext.currentTime, 0.05);
      }
    });

    if (this.reverbGain && cfg.reverb !== undefined) {
      this.reverbGain.gain.setTargetAtTime(cfg.reverb, this.audioContext.currentTime, 0.05);
    }
  }

  initAudioEvents() {
    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this.notify('playState', true);
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this.notify('playState', false);
    });

    this.audio.addEventListener('timeupdate', () => {
      this.notify('timeUpdate', {
        currentTime: this.audio.currentTime || 0,
        duration: this.audio.duration || 0,
        progress: this.audio.duration ? (this.audio.currentTime / this.audio.duration) : 0
      });
    });

    this.audio.addEventListener('ended', () => {
      this.notify('audioEnded');
      this.handleTrackEnded();
    });

    this.audio.addEventListener('error', (e) => {
      console.warn('Audio playback error, attempting recovery:', e);
      // Auto advance if stream fails
      if (this.queue.length > 1) {
        setTimeout(() => this.next(), 1000);
      }
    });
  }

  on(event, cb) {
    if (this.listeners[event]) this.listeners[event].push(cb);
  }

  notify(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => {
        try { cb(data); } catch (err) { console.error(err); }
      });
    }
  }

  async playTrack(track, playlist = null) {
    this.initAudioContext();
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    if (playlist) {
      this.playlist = [...playlist];
      this.queue = [...playlist];
      this.currentIndex = this.queue.findIndex(t => t.id === track.id);
      if (this.isShuffle) this.generateShuffleQueue();
    }

    this.currentTrack = track;

    // Check if offline audio exists in IndexedDB
    let src = track.audioUrl;
    try {
      const offlineBlob = await getOfflineAudio(track.id);
      if (offlineBlob) {
        if (this.currentBlobUrl) URL.revokeObjectURL(this.currentBlobUrl);
        this.currentBlobUrl = URL.createObjectURL(offlineBlob);
        src = this.currentBlobUrl;
      }
    } catch (e) {
      console.warn('Error fetching offline audio blob:', e);
    }

    this.audio.src = src;
    try {
      await this.audio.play();
      this.isPlaying = true;
    } catch (err) {
      console.warn('User gesture required for audio playback:', err);
    }

    this.updateMediaSession(track);
    this.notify('trackChange', track);
  }

  togglePlay() {
    this.initAudioContext();
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    if (!this.audio.src && this.queue.length > 0) {
      this.playTrack(this.queue[0]);
      return;
    }

    if (this.audio.paused) {
      this.audio.play();
    } else {
      this.audio.pause();
    }
  }

  seek(seconds) {
    if (Number.isFinite(seconds) && this.audio.duration) {
      this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration));
    }
  }

  seekPercent(pct) {
    if (this.audio.duration) {
      this.audio.currentTime = this.audio.duration * Math.max(0, Math.min(1, pct));
    }
  }

  next() {
    if (!this.queue.length) return;
    if (this.repeatMode === 'one') {
      this.audio.currentTime = 0;
      this.audio.play();
      return;
    }

    let nextIndex = this.currentIndex + 1;
    if (nextIndex >= this.queue.length) {
      if (this.repeatMode === 'all') {
        nextIndex = 0;
      } else {
        return; // stop
      }
    }
    this.currentIndex = nextIndex;
    const target = this.isShuffle && this.shuffledIndices.length ? 
      this.queue[this.shuffledIndices[this.currentIndex]] : this.queue[this.currentIndex];
    if (target) this.playTrack(target);
  }

  prev() {
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }
    if (!this.queue.length) return;
    let prevIndex = this.currentIndex - 1;
    if (prevIndex < 0) {
      prevIndex = this.queue.length - 1;
    }
    this.currentIndex = prevIndex;
    const target = this.isShuffle && this.shuffledIndices.length ? 
      this.queue[this.shuffledIndices[this.currentIndex]] : this.queue[this.currentIndex];
    if (target) this.playTrack(target);
  }

  toggleShuffle() {
    this.isShuffle = !this.isShuffle;
    if (this.isShuffle) this.generateShuffleQueue();
    return this.isShuffle;
  }

  generateShuffleQueue() {
    const len = this.queue.length;
    this.shuffledIndices = Array.from({ length: len }, (_, i) => i);
    for (let i = len - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.shuffledIndices[i], this.shuffledIndices[j]] = [this.shuffledIndices[j], this.shuffledIndices[i]];
    }
  }

  toggleRepeat() {
    const modes = ['all', 'one', 'none'];
    const currentIdx = modes.indexOf(this.repeatMode);
    this.repeatMode = modes[(currentIdx + 1) % modes.length];
    return this.repeatMode;
  }

  handleTrackEnded() {
    if (this.repeatMode === 'one') {
      this.audio.currentTime = 0;
      this.audio.play();
    } else {
      this.next();
    }
  }

  setVolume(val) {
    this.audio.volume = Math.max(0, Math.min(1, val));
  }

  // iOS Lock Screen & Dynamic Island MediaSession Integration
  updateMediaSession(track) {
    if (!('mediaSession' in navigator) || !track) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || 'Fontaine Melody',
      artist: track.artist || 'Furina & Salon Solitaire',
      album: track.album || 'Fontaine Symphony',
      artwork: [
        { src: track.coverUrl || './assets/images/furina_logo.jpg', sizes: '512x512', type: 'image/jpeg' }
      ]
    });

    navigator.mediaSession.setActionHandler('play', () => this.togglePlay());
    navigator.mediaSession.setActionHandler('pause', () => this.togglePlay());
    navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
    navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) this.seek(details.seekTime);
    });
  }

  // Frequency data for visualizer
  getFrequencyData() {
    if (!this.analyser) return new Uint8Array(64);
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return data;
  }
}
