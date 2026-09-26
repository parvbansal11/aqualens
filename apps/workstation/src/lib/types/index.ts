/**
 * PRESERVE. Canonical contract surface.
 *
 * This module intentionally contains no type declarations of its own. Every
 * operational type is owned by the backend contract in src/lib/api/api-types.ts,
 * which was copied verbatim from the existing apps/workstation implementation.
 *
 * If a screen needs a shape that is not here, the correct fix is a contract
 * change in the repository, not a local interface in a component file.
 */
export type * from "../api-types";
