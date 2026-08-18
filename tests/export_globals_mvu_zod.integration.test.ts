import { registerExportGlobalsIntegrationTests } from './helpers/export_globals_integration_suite';
import { setupLatestMvuZod } from './helpers/load_remote_mvu_zod';
import { describe } from '@jest/globals';

setupLatestMvuZod();

describe('with mvu_zod', () => registerExportGlobalsIntegrationTests({ mvuZod: true }));
