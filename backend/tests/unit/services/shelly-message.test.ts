import { parseShellyMonitorMessage } from '../../../src/services/fan/shelly-message';

describe('parseShellyMonitorMessage', () => {
  it('parses a success payload', () => {
    const msg = parseShellyMonitorMessage(
      '{"type":"success","message":"Contactor switched correctly","switchState":true,"inputState":true,"timestamp":123}'
    );
    expect(msg).toEqual({
      type: 'success', message: 'Contactor switched correctly',
      switchState: true, inputState: true, timestamp: 123,
    });
  });

  it('parses safety_shutoff', () => {
    const msg = parseShellyMonitorMessage(
      '{"type":"safety_shutoff","message":"x","switchState":false,"inputState":false,"timestamp":1}'
    );
    expect(msg?.type).toBe('safety_shutoff');
  });

  it('returns null for unknown type', () => {
    expect(parseShellyMonitorMessage('{"type":"nope","message":"x","switchState":true,"inputState":true,"timestamp":1}')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseShellyMonitorMessage('not json')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(parseShellyMonitorMessage('{"type":"success"}')).toBeNull();
  });
});
