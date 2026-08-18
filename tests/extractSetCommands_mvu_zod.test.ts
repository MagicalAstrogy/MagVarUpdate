import { registerExtractSetCommandTests } from './helpers/extract_set_commands_suite';
import { setupLatestMvuZod } from './helpers/load_remote_mvu_zod';
import { describe } from '@jest/globals';

setupLatestMvuZod();

describe('with mvu_zod', () => registerExtractSetCommandTests({ mvuZod: true }));
