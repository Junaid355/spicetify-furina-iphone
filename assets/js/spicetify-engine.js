// assets/js/spicetify-engine.js — Spicetify Theme & Extension Engine for iPhone Web
import { getSetting, setSetting, getAllExtensions, saveExtension } from './db.js';

export const BUILTIN_THEMES = [
  {
    id: 'furina-fontaine',
    name: 'Furina Fontaine Symphony (Default)',
    author: 'Fontaine Opera Epiclese',
    desc: 'Deep royal abyssal blue, hydro cyan glow, gold opera trim & Furina Salon Solitaire glassmorphism.',
    previewColor: '#00b4d8',
    previewBg: '#081225'
  },
  {
    id: 'furina-focalors',
    name: 'Furina Focalors Divinity',
    author: 'Oratrice Mecanique',
    desc: 'Crystalline silver-white, celestial hydro blue & immaculate judicial glow.',
    previewColor: '#90e0ef',
    previewBg: '#0f172a'
  },
  {
    id: 'spotify-classic',
    name: 'Spotify Classic Dark',
    author: 'Spotify AB',
    desc: 'Original Spotify pure dark `#121212` with signature neon green `#1db954`.',
    previewColor: '#1db954',
    previewBg: '#121212'
  },
  {
    id: 'nord-frost',
    name: 'Nord Frost',
    author: 'Arctic Ice',
    desc: 'Clean Nordic slate `#2e3440` with arctic frost blues `#88c0d0`.',
    previewColor: '#88c0d0',
    previewBg: '#2e3440'
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    author: 'Catppuccin Org',
    desc: 'Warm soothing dark `#1e1e2e` with mauve lavender `#cba6f7`.',
    previewColor: '#cba6f7',
    previewBg: '#1e1e2e'
  },
  {
    id: 'dracula-royale',
    name: 'Dracula Royale',
    author: 'Zeno Rocha',
    desc: 'High-contrast vampire dark `#282a36` with bright magenta `#ff79c6`.',
    previewColor: '#ff79c6',
    previewBg: '#282a36'
  }
];

export const BUILTIN_EXTENSIONS = [
  {
    id: 'lyrics-plus',
    name: 'Lyrics Plus',
    version: '2.4.0',
    author: 'Spicetify Community',
    desc: 'Live synchronized karaoke lyrics with smooth scroll, syllable tracking & instant seek on tap.',
    enabled: true,
    isBuiltin: true
  },
  {
    id: 'adblock-plus',
    name: 'AdBlocker Extreme',
    version: '3.1.2',
    author: 'Spicetify Team',
    desc: 'Permanently eliminates all advertisements, sponsored banners, and audio interruptions.',
    enabled: true,
    isBuiltin: true
  },
  {
    id: 'audio-enhancer',
    name: 'Hi-Fi 320kbps & Opera Equalizer',
    version: '1.9.5',
    author: 'Hydro Acoustic Labs',
    desc: 'Spatial 3D Fontaine Opera Hall reverberation, bass boost, and audio clarity enhancement.',
    enabled: true,
    isBuiltin: true
  },
  {
    id: 'full-app-display',
    name: 'Full App Display (FAD)',
    version: '2.0.1',
    author: 'khanhas',
    desc: 'Cinematic full-screen album artwork immersion with ambient dynamic backdrop gradients.',
    enabled: true,
    isBuiltin: true
  },
  {
    id: 'audio-visualizer',
    name: 'Fontaine Wave Visualizer',
    version: '1.2.0',
    author: 'Furina Solitaire',
    desc: 'Real-time frequency bar and water droplet spectrum visualizer for the currently playing audio.',
    enabled: true,
    isBuiltin: true
  },
  {
    id: 'smart-shuffle',
    name: 'Smart Shuffle+',
    version: '1.4.0',
    author: 'Spicetify',
    desc: 'Evenly distributes artists and tempos across the queue, preventing repetitive consecutive tracks.',
    enabled: true,
    isBuiltin: true
  }
];

export class SpicetifyEngine {
  constructor() {
    this.currentTheme = 'furina-fontaine';
    this.extensions = [];
    this.customStyleEl = null;
  }

  async init() {
    // Load theme
    this.currentTheme = await getSetting('active_theme', 'furina-fontaine');
    this.applyTheme(this.currentTheme);

    // Load custom CSS
    const customCss = await getSetting('custom_css', '');
    if (customCss) {
      this.injectCustomCSS(customCss);
    }

    // Load extensions state
    const savedExts = await getAllExtensions();
    const extsMap = new Map(savedExts.map(e => [e.id, e]));

    this.extensions = BUILTIN_EXTENSIONS.map(b => {
      if (extsMap.has(b.id)) {
        return { ...b, enabled: extsMap.get(b.id).enabled };
      }
      return { ...b };
    });

    // Add user custom extensions
    savedExts.forEach(e => {
      if (!e.isBuiltin) this.extensions.push(e);
    });

    this.runEnabledExtensions();
  }

  applyTheme(themeId) {
    this.currentTheme = themeId;
    document.documentElement.setAttribute('data-theme', themeId);
    setSetting('active_theme', themeId);
  }

  injectCustomCSS(css) {
    if (!this.customStyleEl) {
      this.customStyleEl = document.createElement('style');
      this.customStyleEl.id = 'spicetify-custom-css';
      document.head.appendChild(this.customStyleEl);
    }
    this.customStyleEl.textContent = css;
    setSetting('custom_css', css);
  }

  async toggleExtension(extId) {
    const ext = this.extensions.find(e => e.id === extId);
    if (!ext) return false;
    ext.enabled = !ext.enabled;
    await saveExtension(ext);
    this.runEnabledExtensions();
    return ext.enabled;
  }

  isExtensionEnabled(extId) {
    const ext = this.extensions.find(e => e.id === extId);
    return ext ? Boolean(ext.enabled) : false;
  }

  async addCustomExtension(name, code, desc = '') {
    const newExt = {
      id: `custom_${Date.now()}`,
      name: name || 'Custom Extension',
      version: '1.0.0',
      author: 'User',
      desc: desc || 'Custom user injected Spicetify script',
      enabled: true,
      isBuiltin: false,
      code: code
    };
    this.extensions.push(newExt);
    await saveExtension(newExt);
    this.runExtensionCode(newExt);
    return newExt;
  }

  runEnabledExtensions() {
    this.extensions.forEach(ext => {
      if (ext.enabled && ext.code) {
        this.runExtensionCode(ext);
      }
    });
  }

  runExtensionCode(ext) {
    try {
      const runFn = new Function('spicetify', ext.code);
      runFn(this);
      console.log(`Executed Spicetify Extension: ${ext.name}`);
    } catch (err) {
      console.error(`Failed to execute extension ${ext.name}:`, err);
    }
  }
}
