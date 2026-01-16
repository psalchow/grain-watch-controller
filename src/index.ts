import { createApp } from './app';
import { config } from './config';

const app = createApp();
const port = config.port;

const server = app.listen(port, () => {
  console.log(`Grainwatch Controller BFF running on port ${port}`);
});

export { app, server };
