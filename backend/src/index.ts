import { createApp } from './app';
import { config } from './config';
import { bootstrapApplication } from './bootstrap';

/**
 * Starts the application server.
 *
 * This function handles the complete startup sequence:
 * 1. Bootstrap application (initialise default users if needed)
 * 2. Create Express application
 * 3. Start HTTP server
 *
 * @returns Promise that resolves when the server is listening
 */
async function startServer() {
  try {
    // Run bootstrap tasks
    console.log('Starting application bootstrap...');
    await bootstrapApplication();
    console.log('Bootstrap completed successfully\n');

    // Create and start the application
    const app = createApp();
    const port = config.port;

    const server = app.listen(port, () => {
      console.log(`Grainwatch Controller BFF running on port ${port}`);
      console.log(`Environment: ${config.nodeEnv}`);
    });

    return { app, server };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to start server:', message);
    process.exit(1);
  }
}

// Start the server
const serverPromise = startServer();

// Export for testing purposes
export { serverPromise };
