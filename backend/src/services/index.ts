import { getDb } from '../db';
import { UserRepository, StockRepository } from '../db/repositories';
import { InfluxDBService } from './influx';
import { UserService, AuthService } from './auth';
import { StockService } from './stock';

let _userService: UserService | null = null;
let _authService: AuthService | null = null;
let _stockService: StockService | null = null;

export const influxService = new InfluxDBService();

export function getUserService(): UserService {
  if (!_userService) {
    _userService = new UserService(new UserRepository(getDb()));
  }
  return _userService;
}

export function getAuthService(): AuthService {
  if (!_authService) {
    _authService = new AuthService(getUserService());
  }
  return _authService;
}

export function getStockService(): StockService {
  if (!_stockService) {
    _stockService = new StockService(new StockRepository(getDb()));
  }
  return _stockService;
}

/** Test-only reset hook. Call after closing/recreating the DB so the next getX() rewires. */
export function resetServiceSingletonsForTests(): void {
  _userService = null;
  _authService = null;
  _stockService = null;
}

export const userService = new Proxy({} as UserService, {
  get(_target, prop): unknown {
    const target = getUserService();
    const value = Reflect.get(target, prop, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

export const authService = new Proxy({} as AuthService, {
  get(_target, prop): unknown {
    const target = getAuthService();
    const value = Reflect.get(target, prop, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

export const stockService = new Proxy({} as StockService, {
  get(_target, prop): unknown {
    const target = getStockService();
    const value = Reflect.get(target, prop, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

export { InfluxDBService } from './influx';
export { UserService, AuthService, UserServiceError, AuthenticationError } from './auth';
export { StockService } from './stock';
export type {
  CreateUserData,
  UpdateUserData,
  LoginResult,
  DecodedToken,
} from './auth';
export type { DeviceReading, SeriesPoint, HistoryReadings, OutdoorReading } from './influx';
