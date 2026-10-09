import { routineEn, routineEs } from './i18n-routine.js';
import { scheduleEn, scheduleEs } from './i18n-schedule.js';
import { reviewEn, reviewEs } from './i18n-review.js';
import { appEn, appEs } from './i18n-app.js';
import { todayEn, todayEs } from './i18n-today.js';
import { settingsEn, settingsEs } from './i18n-settings.js';
import { fmtDate, fmtWeight, intlLocale, parseISO } from './calc.js';
import { createContext, createElement, useContext, useEffect, useMemo } from 'react';

/** Tiny hand-written i18n: two flat dictionaries, `{name}` interpolation, English fallback. */
export const dictionaries = {
  en: {
    'wizard.region': 'Setup wizard',
    'wizard.progress': 'Setup progress',
    'wizard.stepOf': 'Step {n} of {total}',
    'wizard.stepDone': 'completed',
    'wizard.nav': 'Setup navigation',
    'wizard.back': 'Back',
    'wizard.next': 'Next: {step}',
    'wizard.start': 'Start this routine',
    'wizard.skip': 'Skip for now',
    'wizard.close': 'Close',
    'wizard.done': 'Done',
    'step.profile': 'Profile',
    'step.routine': 'Routine',
    'step.schedule': 'Schedule',
    'step.confirm': 'Confirm',
    'title.profile': 'Your profile',
    'title.routine': 'Your routine',
    'title.import': 'Import a routine file',
    'title.schedule': 'When do you train?',
    'title.confirm': 'Confirm and start',
    'title.continuation': 'Finish your current session',
    'title.complete': 'You\'re all set',
    'sub.profile': 'Tell us a little about you to personalize your records.',
    'sub.routine': 'Build your routine from scratch or import one from a file.',
    'sub.import': 'Pick a file and check the preview before using it.',
    'sub.schedule': 'Choose how your routines are scheduled and how long this training block lasts.',
    'sub.confirm': 'Check everything once more before you start.',
    'sub.continuation': 'Finish the session in progress, then come back to confirm.',
    'sub.complete': 'Your routine and schedule are ready.',
    'skip.question': 'Are you sure you want to continue without setting up your routine?',
    'skip.confirm': 'Continue without routine',
    'skip.cancel': 'Keep setting up',
    'skip.saving': 'Saving…',
    'skip.error': 'Could not save your choice: {detail}',
    'skip.retry': 'Please try again.',
    'profile.name': 'Name',
    'profile.sex': 'Sex',
    'profile.age': 'Age',
    'profile.heightCm': 'Height (cm)',
    'profile.bodyweightKg': 'Body weight (kg)',
    'profile.choose': 'Choose an option',
    'profile.sex.male': 'Male',
    'profile.sex.female': 'Female',
    'profile.sex.other': 'Other',
    'profile.sex.prefer_not_to_say': 'Prefer not to say',
    'profile.details': 'Profile details',
    'profile.checkFields': 'Fix the highlighted fields to continue.',
    'profile.saveFailed': 'Could not save profile: {detail}',
    'profile.continueFailed': 'Profile saved, but continuing failed: {detail}',
    'profile.saving': 'Saving…',
    'profile.save': 'Save profile',
    'profile.cancel': 'Cancel',
    'profile.intro': 'Add your details to personalize your training records.',
    ...routineEn,
    ...scheduleEn,
    ...reviewEn,
    ...appEn,
    ...todayEn,
    ...settingsEn,
  },
  es: {
    'wizard.region': 'Asistente de configuración',
    'wizard.progress': 'Progreso de la configuración',
    'wizard.stepOf': 'Paso {n} de {total}',
    'wizard.stepDone': 'completado',
    'wizard.nav': 'Navegación de la configuración',
    'wizard.back': 'Atrás',
    'wizard.next': 'Siguiente: {step}',
    'wizard.start': 'Empezar esta rutina',
    'wizard.skip': 'Omitir por ahora',
    'wizard.close': 'Cerrar',
    'wizard.done': 'Listo',
    'step.profile': 'Perfil',
    'step.routine': 'Rutina',
    'step.schedule': 'Calendario',
    'step.confirm': 'Confirmar',
    'title.profile': 'Tu perfil',
    'title.routine': 'Tu rutina',
    'title.import': 'Importar un archivo de rutina',
    'title.schedule': '¿Cuándo entrenas?',
    'title.confirm': 'Confirma y empieza',
    'title.continuation': 'Termina tu sesión actual',
    'title.complete': 'Todo listo',
    'sub.profile': 'Cuéntanos un poco sobre ti para personalizar tus registros.',
    'sub.routine': 'Crea tu rutina desde cero o impórtala desde un archivo.',
    'sub.import': 'Elige un archivo y revisa la vista previa antes de usarlo.',
    'sub.schedule': 'Elige cómo se programan tus rutinas y cuánto dura este bloque de entrenamiento.',
    'sub.confirm': 'Revisa todo una vez más antes de empezar.',
    'sub.continuation': 'Termina la sesión en curso y vuelve para confirmar.',
    'sub.complete': 'Tu rutina y tu calendario están listos.',
    'skip.question': '¿Seguro que quieres continuar sin configurar tu rutina?',
    'skip.confirm': 'Continuar sin rutina',
    'skip.cancel': 'Seguir configurando',
    'skip.saving': 'Guardando…',
    'skip.error': 'No se pudo guardar tu elección: {detail}',
    'skip.retry': 'Inténtalo de nuevo.',
    'profile.name': 'Nombre',
    'profile.sex': 'Sexo',
    'profile.age': 'Edad',
    'profile.heightCm': 'Estatura (cm)',
    'profile.bodyweightKg': 'Peso corporal (kg)',
    'profile.choose': 'Elige una opción',
    'profile.sex.male': 'Hombre',
    'profile.sex.female': 'Mujer',
    'profile.sex.other': 'Otro',
    'profile.sex.prefer_not_to_say': 'Prefiero no decirlo',
    'profile.details': 'Datos del perfil',
    'profile.checkFields': 'Corrige los campos resaltados para continuar.',
    'profile.saveFailed': 'No se pudo guardar el perfil: {detail}',
    'profile.continueFailed': 'Perfil guardado, pero no se pudo continuar: {detail}',
    'profile.saving': 'Guardando…',
    'profile.save': 'Guardar perfil',
    'profile.cancel': 'Cancelar',
    'profile.intro': 'Agrega tus datos para personalizar tus registros de entrenamiento.',
    ...routineEs,
    ...scheduleEs,
    ...reviewEs,
    ...appEs,
    ...todayEs,
    ...settingsEs,
  },
};

/** 'es' when the first preferred language that is set starts with "es", otherwise 'en'. */
export function detectLocale(languages) {
  let list = languages;
  if (list === undefined) {
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    if (!nav) return 'en';
    list = nav.languages ?? [nav.language];
  }
  const first = (Array.isArray(list) ? list : [list]).find((item) => typeof item === 'string' && item.trim());
  return first && first.trim().toLowerCase().split(/[-_]/)[0] === 'es' ? 'es' : 'en';
}

/** Look up `key` in `locale`, then English, then fall back to the key; fill `{name}` placeholders. */
export function translate(locale, key, params = {}) {
  const template = dictionaries[locale]?.[key] ?? dictionaries.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) => (params[name] == null ? match : String(params[name])));
}

// Without a provider the locale is English so components and tests are deterministic.
const I18nContext = createContext('en');

/** Supplies the locale (injectable for tests) and keeps <html lang> in sync. */
export function I18nProvider({ locale = 'en', children }) {
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
  }, [locale]);
  return createElement(I18nContext.Provider, { value: locale }, children);
}

/**
 * Locale-bound helpers. Besides `t`, the hook formats dates, weights and numbers and maps
 * code-owned constants (medal tiers, muscle names) to display text. Stored user data is
 * never translated: an unknown muscle name is shown as it is.
 */
export function useT() {
  const locale = useContext(I18nContext);
  return useMemo(() => {
    const t = (key, params) => translate(locale, key, params);
    return {
      locale,
      t,
      /** "Oct 9, 2026" / "9 oct 2026" */
      date: (iso) => fmtDate(iso, locale),
      /** Free-form date parts from an ISO day, e.g. { weekday: 'long', month: 'short', day: 'numeric' }. */
      dateParts: (iso, options) => parseISO(iso).toLocaleDateString(intlLocale(locale), options),
      weight: (value, unit) => fmtWeight(value, unit, locale),
      /** Fixed-decimals number with the locale's separator ("1.5" / "1,5"). */
      fixed: (value, digits = 1) => (locale === 'en' ? Number(value).toFixed(digits)
        : new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)),
      medal: (level) => t('medal.' + level),
      muscle: (name) => dictionaries[locale]?.['muscle.' + name] ?? name,
    };
  }, [locale]);
}
