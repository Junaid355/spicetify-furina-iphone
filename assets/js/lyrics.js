// assets/js/lyrics.js — Spicetify Lyrics Plus engine
// Supports LRC parsing, syllable/line sync, tap-to-seek, and LRCLib integration

export function parseLRC(lrcText) {
  if (!lrcText || typeof lrcText !== 'string') return [];
  const lines = lrcText.split('\n');
  const result = [];
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for metadata tags like [ti:Title], [ar:Artist]
    if (/^\[[a-zA-Z]+:/.test(trimmed)) continue;

    let match;
    const timestamps = [];
    timeRegex.lastIndex = 0;
    while ((match = timeRegex.exec(trimmed)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const millis = match[3] ? (match[3].length === 2 ? parseInt(match[3], 10) * 10 : parseInt(match[3], 10)) : 0;
      const totalTime = minutes * 60 + seconds + millis / 1000;
      timestamps.push(totalTime);
    }

    const text = trimmed.replace(timeRegex, '').trim();
    for (const time of timestamps) {
      result.push({ time, text });
    }
  }

  // Sort by timestamp
  return result.sort((a, b) => a.time - b.time);
}

// Built-in lyrics for Furina tracks
export const SAMPLE_LYRICS = {
  la_vaguelette: `[00:00.00] ♪ La vaguelette — Furina's Solitaire ♪
[00:02.00] Ah, si je pouvais vivre dans l'eau
[00:05.50] Le monde serait si doux, si beau
[00:08.50] Mais les larmes tombent sans bruit
[00:11.80] Dans le miroir de la nuit...
[00:15.00] Qu'un jour le rideau se lève enfin
[00:18.50] Que la justice guide mon destin
[00:21.80] Fontaine chantera pour l'éternité
[00:25.00] Libre de toute fatalité...
[00:28.00] ♪ (Hydro waltz crescendo) ♪`,
  fontaine_waltz: `[00:00.00] ♪ Fontaine Opera Epiclese Waltz ♪
[00:03.00] Welcome to the Grand Opera of Fontaine
[00:07.00] All the world's a grand celestial stage
[00:11.00] The spotlights illuminate the judgment hall
[00:15.00] Let the tides dance and the melody fall
[00:19.00] Hear the applause echoing through the spires
[00:23.00] As the Hydro Archon ignites our desires!
[00:26.50] ♪ (Grand Finale) ♪`,
  hydro_solitaire: `[00:00.00] ♪ Salon Solitaire — Gentle Hydro Reverie ♪
[00:04.00] Gentilhomme Usher pours the tea
[00:08.50] Surintendante Chevalmarine floats by the sea
[00:13.00] Mademoiselle Crabaletta guards the salon door
[00:18.00] A peaceful afternoon on Fontaine's shore...
[00:23.00] Let the worries of the court melt away...
[00:27.50] Rest now in the calm of the hydro spray.`
};

// Fetch live lyrics from LRCLib (open API, no token required)
export async function fetchOnlineLyrics(title, artist, duration = 0) {
  try {
    const query = new URLSearchParams({
      track_name: title || '',
      artist_name: artist || '',
      duration: duration ? Math.round(duration).toString() : ''
    });
    const res = await fetch(`https://lrclib.net/api/get?${query.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.syncedLyrics || data.plainLyrics || null;
  } catch (e) {
    console.warn('LRCLib fetch failed, using offline fallback', e);
    return null;
  }
}

// Render and sync lyrics inside a DOM container
export class LyricsRenderer {
  constructor(containerEl, onSeekCallback) {
    this.container = containerEl;
    this.onSeek = onSeekCallback;
    this.lines = [];
    this.currentIndex = -1;
  }

  setLyrics(lrcText) {
    this.lines = parseLRC(lrcText);
    this.currentIndex = -1;
    this.render();
  }

  render() {
    this.container.innerHTML = '';
    if (!this.lines.length) {
      this.container.innerHTML = `
        <div class="lyrics-empty">
          <div class="furina-star-badge">✨</div>
          <p class="lyrics-empty-text">No synchronized lyrics available</p>
          <button class="btn-subtle" id="btn-edit-lyrics">Add / Edit Lyrics</button>
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();
    this.lines.forEach((line, idx) => {
      const p = document.createElement('p');
      p.className = 'lyrics-line';
      p.dataset.index = idx;
      p.dataset.time = line.time;
      p.textContent = line.text;
      p.addEventListener('click', () => {
        if (this.onSeek) this.onSeek(line.time);
      });
      fragment.appendChild(p);
    });

    this.container.appendChild(fragment);
  }

  updateTime(currentTime) {
    if (!this.lines.length) return;

    // Find active line: last line with time <= currentTime
    let activeIdx = -1;
    for (let i = 0; i < this.lines.length; i++) {
      if (currentTime >= this.lines[i].time) {
        activeIdx = i;
      } else {
        break;
      }
    }

    if (activeIdx !== this.currentIndex) {
      this.currentIndex = activeIdx;
      const allLines = this.container.querySelectorAll('.lyrics-line');
      allLines.forEach((el, idx) => {
        if (idx === activeIdx) {
          el.classList.add('active');
          // Smooth scroll active line to center of container
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          el.classList.remove('active');
        }
      });
    }
  }
}
