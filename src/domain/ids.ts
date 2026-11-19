/** Separate ID spaces: prj-, mdl-, off-, ins-. Not derivable from content. */
export const newId = (prefix: 'prj' | 'mdl' | 'off' | 'ins') => `${prefix}-${crypto.randomUUID()}`;
export const nowIso = () => new Date().toISOString();
