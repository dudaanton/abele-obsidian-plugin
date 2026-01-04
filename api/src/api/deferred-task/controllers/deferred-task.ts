import { factories } from "@strapi/strapi";
import { Context } from "koa";
import { Queue, QueueOptions, Job } from "bullmq";

// Define an interface for the expected queue configuration structure
interface QueueConfig {
  connection: QueueOptions["connection"];
  defaultJobOptions?: QueueOptions["defaultJobOptions"];
}

// --- Queue Instantiation ---
// TODO: Consider moving queue instantiation to a service or bootstrap function
// to avoid creating it on every request if the controller gets reloaded.
const queueConfig = strapi.config.get("queue") as QueueConfig; // Cast to known type
const taskQueue = new Queue("deferred-tasks", {
  connection: queueConfig.connection, // Now TS knows this exists
  defaultJobOptions: queueConfig.defaultJobOptions, // And this
});
// --- End Queue Instantiation ---

export default factories.createCoreController(
  "api::deferred-task.deferred-task",
  ({ strapi }) => ({
    /**
     * Creates a new deferred task and adds it to the queue.
     * Expects { command_name: string, payload?: object, media_ids?: number[] } in the request body.
     */
    async createTask(ctx: Context) {
      const { user } = ctx.state; // User attached by token-auth middleware
      const { command_name, payload, media_ids } = ctx.request.body as any; // Cast to any for simplicity, consider proper validation/typing

      if (!user) {
        return ctx.unauthorized("Authentication required.");
      }

      if (!command_name) {
        return ctx.badRequest("Missing required field: command_name");
      }

      try {
        // Create the task entry in the database
        const newTask = await strapi.entityService.create(
          "api::deferred-task.deferred-task",
          {
            data: {
              command_name,
              payload: payload || {},
              taskStatus: "pending",
              user: user.id,
              media: media_ids || [], // Link media files if IDs are provided
              publishedAt: new Date(), // Ensure it's published if draft/publish is ever enabled
            },
            populate: ["media"], // Populate media to confirm linking if needed
          },
        );

        // Add the task to the BullMQ queue for processing
        // Pass the database ID of the task to the worker
        await taskQueue.add(command_name, { taskId: newTask.id });

        strapi.log.info(
          `Deferred task created and queued: ID ${newTask.id}, Command: ${command_name}, User: ${user.id}`,
        );

        // Return the ID of the created task
        return ctx.send({ taskId: newTask.id });
      } catch (error) {
        strapi.log.error(
          `Error creating deferred task: ${error.message}`,
          error,
        );
        return ctx.internalServerError("Failed to create deferred task.");
      }
    },

    /**
     * Gets the status of tasks for the authenticated user.
     * Optionally filters by status query parameter (e.g., ?status=completed).
     */
    async getStatuses(ctx: Context) {
      const { user } = ctx.state;
      const { status } = ctx.query;

      if (!user) {
        return ctx.unauthorized("Authentication required.");
      }

      try {
        const filters: any = { user: { id: user.id } };
        if (
          status &&
          ["pending", "running", "completed", "error"].includes(
            status as string,
          )
        ) {
          filters.taskStatus = status;
        }

        const tasks = await strapi.entityService.findMany(
          "api::deferred-task.deferred-task",
          {
            filters,
            fields: [
              "id",
              "taskStatus",
              "command_name",
              "createdAt",
              "updatedAt",
            ], // Select specific fields
            sort: { createdAt: "desc" }, // Sort by creation date
          },
        );

        return ctx.send(tasks);
      } catch (error) {
        strapi.log.error(
          `Error fetching task statuses: ${error.message}`,
          error,
        );
        return ctx.internalServerError("Failed to fetch task statuses.");
      }
    },

    /**
     * Gets the full result of a specific task for the authenticated user.
     */
    async getResult(ctx: Context) {
      const { user } = ctx.state;
      const { id } = ctx.params;

      if (!user) {
        return ctx.unauthorized("Authentication required.");
      }

      if (!id) {
        return ctx.badRequest("Task ID is required.");
      }

      try {
        const taskId = parseInt(id, 10);
        if (isNaN(taskId)) {
          return ctx.badRequest("Invalid Task ID format.");
        }

        // Use 'as any' for now to bypass TS errors on populated relations.
        // A more robust solution would involve defining a specific type for the populated task.
        const task = (await strapi.entityService.findOne(
          "api::deferred-task.deferred-task",
          taskId,
          {
            populate: { user: true, media: true }, // Populate user for ownership check and media
          },
        )) as any;

        if (!task) {
          return ctx.notFound("Task not found.");
        }

        // Verify ownership
        if (task.user?.id !== user.id) {
          // Check ownership using the populated user relation
          return ctx.forbidden(
            "You do not have permission to access this task.",
          );
        }

        // Return the full task details
        // Sensitive fields like 'result' and 'error_message' are private by default in the schema,
        // but entityService bypasses that. We explicitly return them here.
        return ctx.send({
          id: task.id,
          command_name: task.command_name,
          status: task.status,
          payload: task.payload,
          result: task.result,
          error_message: task.error_message,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          media: task.media, // Include media details (TS now allows this due to 'as any')
        });
      } catch (error) {
        strapi.log.error(
          `Error fetching task result for ID ${id}: ${error.message}`,
          error,
        );
        return ctx.internalServerError("Failed to fetch task result.");
      }
    },
  }),
);
