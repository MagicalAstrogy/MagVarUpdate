import { registerTemplateTests } from './helpers/template_suite';
import { setupLatestMvuZod } from './helpers/load_remote_mvu_zod';
import { describe } from '@jest/globals';

setupLatestMvuZod();

describe('with mvu_zod', () => registerTemplateTests({ mvuZod: true }));
