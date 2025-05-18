import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ClientCommandType } from '../../src/server/types';
import type { MatchState, PlayerServer } from '../../src/server/types';
import type { WebSocketServer, WebSocket as ServerWebSocket } from 'ws';

// This is the type for the original handleMessage function in matchServer.ts
type HandleMessageFn = (
  ws: ServerWebSocket,
  message: any,
  rawBuffer: Buffer | null,
  currentMatchState: MatchState,
  wssInstance: WebSocketServer,
  cmdPlayerIdFromConnection: string,
  playerObjectContext: PlayerServer
) => Promise<void> | void;

// Mock the actual handleMessage function that would be in matchServer.ts
const mockHandleMessage: vi.MockedFunction<HandleMessageFn> = vi.fn();

// Simulate the relevant parts of matchServer's connection handler context for the callback
const getMockContext = () => ({
  mockWs: {} as ServerWebSocket, // Mock WebSocket object for the first arg of handleMessage
  mockMatchState: {
    players: new Map(),
    chunks: new Map(),
    // Add other essential fields if your mockHandleMessage logic or the callback needs them
  } as unknown as MatchState,
  mockWss: {} as WebSocketServer,
  mockPlayerId: 'test-player-id',
  mockPlayerObjectContext: { id: 'test-player-id', ws: {} } as PlayerServer,
});

// This is the WebSocket 'message' event callback logic extracted for testing
// It now calls the vi.fn() mockHandleMessage
const onMessageCallback = (
  data: Buffer | string,
  isBinary: boolean,
  // Context arguments that would normally be in the closure of wss.on('connection', ...)
  ws: ServerWebSocket,
  matchState: MatchState,
  wss: WebSocketServer,
  playerId: string,
  playerObjectContext: PlayerServer
) => {
  if (isBinary) {
    const artificialMessage = { commandType: ClientCommandType.PLAYER_INPUT };
    mockHandleMessage(ws, artificialMessage, data as Buffer, matchState, wss, playerId, playerObjectContext);
  } else {
    const jsonDataString = Buffer.isBuffer(data) ? data.toString('utf8') : data;
    try {
      const parsedMessage = JSON.parse(jsonDataString);
      mockHandleMessage(ws, parsedMessage, null, matchState, wss, playerId, playerObjectContext);
    } catch (error) {
      // In a real scenario, sendError would be called. For this test, we can log or spy.
      console.error('[Test] Error parsing string message (JSON parse):', error, jsonDataString);
      // sendError(ws, 'error', undefined, 'InvalidJSON', 'Could not parse JSON message.');
    }
  }
};

describe('WebSocket Message Handler Logic (based on isBinary flag)', () => {
  let context: ReturnType<typeof getMockContext>;

  beforeEach(() => {
    mockHandleMessage.mockClear();
    context = getMockContext();
  });

  it('should call handleMessage with rawBuffer for binary messages', () => {
    const binaryData = Buffer.from([1, 2, 3, 4]); // Sample binary data
    onMessageCallback(
      binaryData,
      true, // isBinary = true
      context.mockWs,
      context.mockMatchState,
      context.mockWss,
      context.mockPlayerId,
      context.mockPlayerObjectContext
    );

    expect(mockHandleMessage).toHaveBeenCalledTimes(1);
    const expectedArtificialMessage = { commandType: ClientCommandType.PLAYER_INPUT };
    expect(mockHandleMessage).toHaveBeenCalledWith(
      context.mockWs,
      expectedArtificialMessage,
      binaryData, // rawBuffer should be the binaryData
      context.mockMatchState,
      context.mockWss,
      context.mockPlayerId,
      context.mockPlayerObjectContext
    );
  });

  it('should parse JSON and call handleMessage with null rawBuffer for text messages (string)', () => {
    const textData = JSON.stringify({ type: 'testJson', payload: 'hello' });
    onMessageCallback(
      textData,
      false, // isBinary = false
      context.mockWs,
      context.mockMatchState,
      context.mockWss,
      context.mockPlayerId,
      context.mockPlayerObjectContext
    );

    expect(mockHandleMessage).toHaveBeenCalledTimes(1);
    const expectedParsedMessage = { type: 'testJson', payload: 'hello' };
    expect(mockHandleMessage).toHaveBeenCalledWith(
      context.mockWs,
      expectedParsedMessage,
      null, // rawBuffer should be null
      context.mockMatchState,
      context.mockWss,
      context.mockPlayerId,
      context.mockPlayerObjectContext
    );
  });

  it('should handle text messages received as Buffer and call handleMessage with null rawBuffer', () => {
    const textDataAsBuffer = Buffer.from(JSON.stringify({ type: 'testJsonBuffer', payload: 'world' }), 'utf8');
    onMessageCallback(
      textDataAsBuffer,
      false, // isBinary = false
      context.mockWs,
      context.mockMatchState,
      context.mockWss,
      context.mockPlayerId,
      context.mockPlayerObjectContext
    );

    expect(mockHandleMessage).toHaveBeenCalledTimes(1);
    const expectedParsedMessage = { type: 'testJsonBuffer', payload: 'world' };
    expect(mockHandleMessage).toHaveBeenCalledWith(
      context.mockWs,
      expectedParsedMessage,
      null, // rawBuffer should be null
      context.mockMatchState,
      context.mockWss,
      context.mockPlayerId,
      context.mockPlayerObjectContext
    );
  });

  it('should attempt to parse JSON and not call handleMessage on JSON parse error for text messages', () => {
    const malformedTextData = "{ type: 'brokenJson";
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    onMessageCallback(
      malformedTextData,
      false, // isBinary = false
      context.mockWs,
      context.mockMatchState,
      context.mockWss,
      context.mockPlayerId,
      context.mockPlayerObjectContext
    );

    expect(mockHandleMessage).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Test] Error parsing string message (JSON parse):',
      expect.any(SyntaxError), // Error object
      malformedTextData
    );

    consoleErrorSpy.mockRestore();
  });
}); 