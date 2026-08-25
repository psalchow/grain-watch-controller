/**
 * German text for warnings and errors shown to operators.
 *
 * Only warnings and errors are translated — the rest of the interface stays in
 * English. Both lookups follow the same policy: a known message is replaced, an
 * unknown one is passed through unchanged, so a new message from the device or
 * the API still reaches the user instead of being swallowed.
 */

/**
 * Messages emitted by the Shelly monitor script and relayed over MQTT.
 *
 * These originate on the device, not in this codebase, so they can only be
 * matched by their text — the set mirrors `sim/shelly-emulator/src/shelly.ts`.
 * Adding a message to the device script means adding it here too.
 */
const DEVICE_MESSAGES: Record<string, string> = {
  'Input changed without switch command':
    'Schütz wurde von Hand geschaltet (ohne Befehl der Steuerung)',
  'Contactor switched correctly': 'Schütz hat korrekt geschaltet',
  'Switch turned OFF - input did not engage':
    'Sicherheitsabschaltung: Schütz hat nicht angezogen',
};

/**
 * Device messages carrying a variable part, which exact matching cannot cover.
 */
const DEVICE_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [
    /^Input did not switch within (\d+)ms$/,
    (m) => `Schütz hat nicht innerhalb von ${m[1]} ms geschaltet`,
  ],
];

/**
 * Error messages returned by the BFF.
 *
 * Matched on the message text rather than the error code, because the API
 * distinguishes far more failure cases than it has codes for.
 */
const API_MESSAGES: Record<string, string> = {
  // Authentication
  'Invalid username or password': 'Benutzername oder Passwort ist falsch',
  'Account has been disabled': 'Das Konto wurde deaktiviert',
  'Authentication required': 'Anmeldung erforderlich',
  'Current password is incorrect': 'Das aktuelle Passwort ist falsch',
  'Missing refresh token': 'Sitzung abgelaufen, bitte erneut anmelden',
  'Invalid refresh token': 'Sitzung ungültig, bitte erneut anmelden',
  'Refresh token has expired': 'Sitzung abgelaufen, bitte erneut anmelden',

  // Passwords
  'Password is required': 'Passwort ist erforderlich',
  'Current password is required': 'Aktuelles Passwort ist erforderlich',
  'New password is required': 'Neues Passwort ist erforderlich',
  'Password must be at least 8 characters':
    'Das Passwort muss mindestens 8 Zeichen lang sein',
  'Password must be at most 100 characters':
    'Das Passwort darf höchstens 100 Zeichen lang sein',

  // User management
  'Username is required': 'Benutzername ist erforderlich',
  'Username must be at least 3 characters':
    'Der Benutzername muss mindestens 3 Zeichen lang sein',
  'Username must be at most 50 characters':
    'Der Benutzername darf höchstens 50 Zeichen lang sein',
  'Username can only contain letters, numbers, and underscores':
    'Der Benutzername darf nur Buchstaben, Ziffern und Unterstriche enthalten',
  'Invalid email address': 'Ungültige E-Mail-Adresse',
  'Invalid role': 'Ungültige Rolle',
  'Cannot deactivate your own account':
    'Das eigene Konto kann nicht deaktiviert werden',
  'At least one stock access entry is required':
    'Mindestens eine Halle muss zugewiesen sein',
  'At least one permission field must be provided':
    'Mindestens eine Berechtigung muss angegeben werden',

  // Generic
  'Request body validation failed': 'Die Eingaben sind ungültig',
  'An unexpected error occurred': 'Ein unerwarteter Fehler ist aufgetreten',
};

/** Translates a known Shelly message; unknown text is returned unchanged. */
export function translateDeviceMessage(message: string): string {
  const exact = DEVICE_MESSAGES[message];
  if (exact) return exact;

  for (const [pattern, render] of DEVICE_PATTERNS) {
    const match = message.match(pattern);
    if (match) return render(match);
  }

  return message;
}

/** Translates a known API message; unknown text is returned unchanged. */
export function translateApiMessage(message: string): string {
  return API_MESSAGES[message] ?? message;
}

/**
 * Pulls the message out of an Axios-style error and translates it.
 *
 * @param err - The caught error, of unknown shape
 * @param fallback - German text to use when the response carries no message
 */
export function extractError(err: unknown, fallback: string): string {
  const message =
    err && typeof err === 'object' && 'response' in err
      ? (err as { response?: { data?: { error?: { message?: string } } } })
          .response?.data?.error?.message
      : null;

  return message ? translateApiMessage(message) : fallback;
}
