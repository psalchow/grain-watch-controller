import { InfluxDBService } from './influx';
import { UserService, AuthService } from './auth';

export const influxService = new InfluxDBService();
export const userService = new UserService();
export const authService = new AuthService(userService);

export { InfluxDBService } from './influx';
export { UserService, AuthService, UserServiceError, AuthenticationError } from './auth';
export type {
  CreateUserData,
  UpdateUserData,
  LoginResult,
  DecodedToken,
} from './auth';
export type { DeviceReading } from './influx';
