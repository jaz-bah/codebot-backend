/** Documents module limits. */

/** Max display name (matches todos title). */
export const DOCUMENT_NAME_MAX_LENGTH = 255;

/** Max free-form description (matches todos description). */
export const DOCUMENT_DESCRIPTION_MAX_LENGTH = 5000;

/** Max upload size for a document (50 MB, same cap as zip uploads). */
export const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;
