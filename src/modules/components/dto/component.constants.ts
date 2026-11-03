/** Components module limits. */

/** Max display name (matches todos title). */
export const COMPONENT_NAME_MAX_LENGTH = 255;

/** Max preview image reference (URL or path). */
export const COMPONENT_PREVIEW_MAX_LENGTH = 1000;

/** Max characters of a single code file (matches the note content cap). */
export const COMPONENT_CODE_MAX_LENGTH = 500_000;

/** Max code files per component. */
export const COMPONENT_MAX_FILES = 20;

/** Language tags: lowercase short tokens (css, html, js, ts, ….). */
export const COMPONENT_LANGUAGE_PATTERN = /^[a-z0-9_-]{1,20}$/;

/** Preview image reference: absolute URL or a root-relative path. */
export const COMPONENT_PREVIEW_PATTERN = /^(https?:\/\/|\/)/i;
