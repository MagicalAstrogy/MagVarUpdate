import { registerButtonTests } from './helpers/button_suite';
import { setupLatestMvuZod } from './helpers/load_remote_mvu_zod';
import { describe } from '@jest/globals';

setupLatestMvuZod();

describe('with mvu_zod', () => registerButtonTests({ mvuZod: true }));
