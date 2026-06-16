// Folio schema — type definitions.
//
// This file is a barrel: the actual declarations live in ./types/ split by domain
// (primitives → layers → document) to keep each module well under the line budget.
// Every type the rest of the codebase imports from '../schema/types' is re-exported
// here, so import sites are unchanged.
export * from './types/primitives';
export * from './types/layers';
export * from './types/document';
