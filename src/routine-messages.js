/** Presentation helpers: turn routine-draft / import validation errors into plain-language text. */
export function friendlyError(error, t, scope) {
  const code = error?.code ?? '';
  const keys = scope === 'editor' ? [`err.editor.${code}`, `err.${code}`] : [`err.${code}`];
  for (const key of keys) {
    const message = t(key);
    if (message !== key) return message;
  }
  return t('err.generic');
}

/** Distinct friendly messages for a list of validation errors. */
export function friendlyList(errors, t, scope) {
  return [...new Set(errors.map((error) => friendlyError(error, t, scope)))];
}
