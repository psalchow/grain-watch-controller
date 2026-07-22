export type MonitorType = 'success' | 'warning' | 'alert' | 'safety_shutoff';
export type ContactorBehaviour = 'follow' | 'wontEngage';

export interface ShellySnapshot {
  switchOutput: boolean;
  inputState: boolean;
  online: boolean;
  contactorBehaviour: ContactorBehaviour;
  lastMonitor: { type: MonitorType; message: string; ts: number } | null;
}

export interface ShellyEmitters {
  publishMonitor(type: MonitorType, message: string, switchState: boolean, inputState: boolean, ts: number): void;
  publishStatus(output: boolean): void;
  publishOnline(online: boolean): void;
  onChange(snapshot: ShellySnapshot): void;
}

export interface ShellyOptions {
  gracePeriodMs?: number;
  contactorDelayMs?: number;
  autoOffMs?: number;
  now?: () => number;
}

/**
 * Faithful reproduction of the fan-control side of switch-monitoring.mjs.
 * Pure of transport: it calls the injected emitters instead of touching MQTT.
 */
export class ShellyMachine {
  private switchOutput = false;
  private inputState = false;
  private desiredInputState = false;
  private online = true;
  private contactorBehaviour: ContactorBehaviour = 'follow';
  private lastMonitor: ShellySnapshot['lastMonitor'] = null;

  private grace: ReturnType<typeof setTimeout> | null = null;
  private follow: ReturnType<typeof setTimeout> | null = null;
  private autoOff: ReturnType<typeof setTimeout> | null = null;

  private readonly gracePeriodMs: number;
  private readonly contactorDelayMs: number;
  private readonly autoOffMs: number;
  private readonly now: () => number;

  constructor(private readonly emit: ShellyEmitters, opts: ShellyOptions = {}) {
    this.gracePeriodMs = opts.gracePeriodMs ?? 3000;
    this.contactorDelayMs = opts.contactorDelayMs ?? 500;
    this.autoOffMs = opts.autoOffMs ?? 3600000;
    this.now = opts.now ?? (() => Date.now());
  }

  setSwitch(on: boolean): void {
    this.switchOutput = on;
    this.desiredInputState = on;
    this.emit.publishStatus(on);

    // Contactor reaction: follow after a short delay unless armed to fail.
    if (this.follow) { clearTimeout(this.follow); this.follow = null; }
    if (on && this.contactorBehaviour === 'wontEngage') {
      // stays disengaged — the fault case
    } else {
      this.follow = setTimeout(() => {
        this.follow = null;
        this.inputState = on;
        this.change();
      }, this.contactorDelayMs);
    }

    // Auto-off: (re)arm while on (a repeated ON — keep-alive — resets it).
    if (this.autoOff) { clearTimeout(this.autoOff); this.autoOff = null; }
    if (on) {
      this.autoOff = setTimeout(() => {
        this.autoOff = null;
        this.setSwitch(false); // models Shelly Auto OFF as an internal switch-off
      }, this.autoOffMs);
    }

    // Grace: evaluate whether the contactor reached the desired state.
    if (this.grace) clearTimeout(this.grace);
    this.grace = setTimeout(() => {
      this.grace = null;
      this.evaluateGrace();
    }, this.gracePeriodMs);

    this.change();
  }

  manualContactorToggle(): void {
    this.inputState = !this.inputState;
    this.publishMonitor('warning', 'Input changed without switch command');
    this.change();
  }

  setContactorBehaviour(b: ContactorBehaviour): void {
    this.contactorBehaviour = b;
    this.change();
  }

  setOnline(on: boolean): void {
    if (this.online === on) return;
    this.online = on;
    this.emit.publishOnline(on);
    this.change();
  }

  getSnapshot(): ShellySnapshot {
    return {
      switchOutput: this.switchOutput,
      inputState: this.inputState,
      online: this.online,
      contactorBehaviour: this.contactorBehaviour,
      lastMonitor: this.lastMonitor,
    };
  }

  stop(): void {
    for (const t of [this.grace, this.follow, this.autoOff]) if (t) clearTimeout(t);
    this.grace = this.follow = this.autoOff = null;
  }

  private evaluateGrace(): void {
    if (this.inputState === this.desiredInputState) {
      this.publishMonitor('success', 'Contactor switched correctly');
      return;
    }
    this.publishMonitor('alert', `Input did not switch within ${this.gracePeriodMs}ms`);
    if (this.desiredInputState) {
      // Commanded ON but the contactor did not engage → safety shutoff.
      this.switchOutput = false;
      this.emit.publishStatus(false);
      this.publishMonitor('safety_shutoff', 'Switch turned OFF - input did not engage');
      this.change();
    }
  }

  private publishMonitor(type: MonitorType, message: string): void {
    const ts = this.now();
    this.lastMonitor = { type, message, ts };
    this.emit.publishMonitor(type, message, this.switchOutput, this.inputState, ts);
  }

  private change(): void {
    this.emit.onChange(this.getSnapshot());
  }
}
