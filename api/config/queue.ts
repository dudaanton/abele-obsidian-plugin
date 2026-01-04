export default ({ env }) => ({
  connection: {
    host: env('REDIS_HOST', 'redis_service'), // Default to the service name in docker-compose
    port: env.int('REDIS_PORT', 6379),
    // Add password if your Redis instance requires it
    // password: env('REDIS_PASSWORD', undefined),
    // db: env.int('REDIS_DB', 0), // Optional: specify Redis database number
  },
  // Default queue options (can be overridden when creating queues)
  defaultJobOptions: {
    attempts: 3, // Number of times to retry a failed job
    removeOnComplete: true, // Remove job from queue once completed
    removeOnFail: 1000, // Keep failed jobs for 1000 attempts (or set to false to keep forever)
  },
});
