// GymTrack — release notes shown once per version ("What's new" sheet). When you cut a new version:
// bump package.json, then add an entry here (newest first). A version without an entry shows nothing.
export const CHANGELOG = {
  '1.9.0': {
    en: [
      ['Settings, reorganised', 'Profile with photo, weight and height · mesocycle with end date and days left · themes · training · data.'],
      ['Colors and special themes', 'Color picker, plus Silver, Gold, Platinum, Nebula and Filled Nebula. Charts and bars follow the theme; decorative rings are optional.'],
      ['Exercise library', 'Browse every exercise by muscle on the body map, search, and add new ones.'],
      ['Medals', 'New Obsidian tier, laurel wreaths, a Top 3 podium and two views: by muscle or by quality.'],
      ['Metrics', 'New "sets per muscle" web chart and stronger section titles.'],
      ['Look and feel', 'GitHub-style yearly streak, liquid-glass tab bar, true-black OLED background and a soft bone white.'],
    ],
    es: [
      ['Ajustes, reorganizados', 'Perfil con foto, peso y estatura · bloque con fecha de fin y días restantes · temas · entrenamiento · datos.'],
      ['Colores y temas especiales', 'Selector de color, más Plata, Oro, Platino, Nebulosa y Nebulosa rellena. Las gráficas y barras siguen el tema; los anillos decorativos son opcionales.'],
      ['Biblioteca de ejercicios', 'Explora todos tus ejercicios por músculo en el mapa del cuerpo, busca y agrega nuevos.'],
      ['Medallas', 'Nuevo nivel Obsidiana, laureles, podio con el Top 3 y dos vistas: por músculo o por calidad.'],
      ['Métricas', 'Nuevo gráfico de red con las series por músculo y títulos de sección más marcados.'],
      ['Aspecto', 'Racha anual estilo GitHub, barra de pestañas con liquid glass, fondo negro puro para OLED y un blanco hueso suave.'],
    ],
  },
};

const KEY = 'gymtrack_seen_version';

/** Version string without the leading "v" (vite defines __APP_VERSION__ as "v1.9.0"). */
export const appVersion = () => (typeof __APP_VERSION__ !== 'undefined' ? String(__APP_VERSION__).replace(/^v/, '') : null);

/** Pure rule: show the sheet only when this version has notes, it hasn't been seen yet, and the
 *  user is not brand new (a fresh install has nothing "new" to catch up on). */
export function shouldShowWhatsNew({ version, seen, hasData }) {
  return !!version && !!CHANGELOG[version] && seen !== version && hasData;
}

export const readSeenVersion = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const markVersionSeen = (version) => { try { if (version) localStorage.setItem(KEY, version); } catch { /* private mode */ } };
