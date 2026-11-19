/** Separate ID spaces: prj-, mdl-, off-, ins-, lin-, kit-. Not derivable from content. */
export const newId = (prefix: 'prj' | 'mdl' | 'off' | 'ins' | 'lin' | 'kit') => `${prefix}-${crypto.randomUUID()}`;
export const nowIso = () => new Date().toISOString();
