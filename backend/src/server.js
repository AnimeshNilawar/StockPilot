const app = require('./app');
const { env } = require('./config/env');
const { prisma } = require('./lib/prisma');

async function startServer() {
  try {
    // Validate DB connection
    await prisma.$connect();
    console.log('Connected to database successfully.');

    const server = app.listen(env.PORT, () => {
      console.log(`Server is running in ${env.NODE_ENV} mode on port ${env.PORT}`);
    });

    const gracefulShutdown = async () => {
      console.log('Shutting down gracefully...');
      server.close(async () => {
        await prisma.$disconnect();
        console.log('Closed database connection.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
