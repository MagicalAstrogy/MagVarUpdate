import { setupLatestMvuZod } from './helpers/load_remote_mvu_zod';
import { registerJsonPatchTests } from './helpers/json_patch_suite';
import { describe } from '@jest/globals';

setupLatestMvuZod();

describe('with mvu_zod', registerJsonPatchTests);
