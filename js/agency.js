// Agency details (legal name, NIP, bank account…) used in quotes and contracts. Synced like other records.
import * as db from './db.js';

export const AGENCY_ID = '00000000-0000-4000-8000-000000000001';
export function agencyProfile() { return db.get('meta', AGENCY_ID) || {}; }
