/**
 * Express type augmentation for authenticated requests.
 *
 * Extends the Express Request interface to include user information
 * after successful authentication middleware processing.
 */

import { UserProfile } from '../models';

declare global {
  namespace Express {
    /**
     * Extended Request interface with authenticated user information.
     */
    interface Request {
      /**
       * Authenticated user profile attached by authentication middleware.
       * Only present after the `authenticate` middleware has successfully
       * validated the request's JWT token.
       */
      user?: UserProfile;
    }
  }
}
