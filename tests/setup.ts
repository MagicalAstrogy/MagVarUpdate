// Global test setup
import * as _ from 'lodash';

// Make lodash available globally as it's used in the source code
(globalThis as any)._ = _;

// Mock window object
(globalThis as any).window = globalThis;

// Mock TavernHelper
(globalThis as any).window.TavernHelper = {
  substitudeMacros: jest.fn(input => input),
};

// Mock tavern events
(globalThis as any).tavern_events = {
  GENERATION_ENDED: 'GENERATION_ENDED',
  MESSAGE_SENT: 'MESSAGE_SENT',
  GENERATION_STARTED: 'GENERATION_STARTED',
};

// Mock functions that are not available in test environment
(globalThis as any).eventOn = jest.fn();
(globalThis as any).eventEmit = jest.fn();
(globalThis as any).getChatMessages = jest.fn();
(globalThis as any).getScriptId = jest.fn(() => 'test-script-id');
(globalThis as any).getVariables = jest.fn();
(globalThis as any).getLastMessageId = jest.fn();
(globalThis as any).replaceVariables = jest.fn();
(globalThis as any).insertOrAssignVariables = jest.fn();
(globalThis as any).setChatMessage = jest.fn();
(globalThis as any).getCurrentCharPrimaryLorebook = jest.fn();
(globalThis as any).getAvailableLorebooks = jest.fn();
(globalThis as any).substitudeMacros = jest.fn(input => input);
