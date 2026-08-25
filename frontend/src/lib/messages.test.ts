import { describe, it, expect } from 'vitest';
import {
  translateDeviceMessage,
  translateApiMessage,
  extractError,
} from './messages';

describe('translateDeviceMessage', () => {
  it('translates the manual-switching warning', () => {
    expect(translateDeviceMessage('Input changed without switch command')).toBe(
      'Schütz wurde von Hand geschaltet (ohne Befehl der Steuerung)'
    );
  });

  it('translates the safety shutoff', () => {
    expect(
      translateDeviceMessage('Switch turned OFF - input did not engage')
    ).toBe('Sicherheitsabschaltung: Schütz hat nicht angezogen');
  });

  it('keeps the variable part of a parameterised message', () => {
    expect(translateDeviceMessage('Input did not switch within 5000ms')).toBe(
      'Schütz hat nicht innerhalb von 5000 ms geschaltet'
    );
  });

  it('passes an unknown device message through unchanged', () => {
    expect(translateDeviceMessage('Something new from the script')).toBe(
      'Something new from the script'
    );
  });
});

describe('translateApiMessage', () => {
  it('translates a known API message', () => {
    expect(translateApiMessage('Current password is incorrect')).toBe(
      'Das aktuelle Passwort ist falsch'
    );
  });

  it('passes an unknown API message through unchanged', () => {
    expect(translateApiMessage('Teapot overheated')).toBe('Teapot overheated');
  });
});

describe('extractError', () => {
  it('translates the message from an Axios-style error', () => {
    const err = {
      response: { data: { error: { message: 'Invalid username or password' } } },
    };

    expect(extractError(err, 'Fallback')).toBe(
      'Benutzername oder Passwort ist falsch'
    );
  });

  it('falls back when the error carries no message', () => {
    expect(extractError(new Error('network down'), 'Fallback')).toBe('Fallback');
  });

  it('falls back for a non-object error', () => {
    expect(extractError(null, 'Fallback')).toBe('Fallback');
  });
});
