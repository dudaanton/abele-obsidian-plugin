/**
 * deferred-task router
 */

import { factories } from "@strapi/strapi";

// We are creating custom routes, so we don't use the core router directly.
// However, keeping the factory import might be useful if we mix core/custom routes later.
// const { createCoreRouter } = require('@strapi/strapi').factories;
// export default createCoreRouter('api::deferred-task.deferred-task');

export default {
  routes: [
    {
      method: "POST",
      path: "/deferred-tasks", // Use plural form for consistency
      handler: "deferred-task.createTask", // Custom controller action
      config: {
        auth: false,
        // Apply the token-auth policy specifically to this route
        // policies: ['global::token-auth'],
        middlewares: ["global::token-auth"],
      },
    },
    {
      method: "GET",
      path: "/deferred-tasks/status",
      handler: "deferred-task.getStatuses", // Custom controller action
      config: {
        auth: false,
        // Apply the token-auth policy specifically to this route
        // policies: ['global::token-auth'],
        middlewares: ["global::token-auth"],
      },
    },
    {
      method: "GET",
      path: "/deferred-tasks/:id/result",
      handler: "deferred-task.getResult", // Custom controller action
      config: {
        auth: false,
        // Apply the token-auth policy specifically to this route
        // policies: ['global::token-auth'],
        middlewares: ["global::token-auth"],
      },
    },
    // Example of a default core route (if needed later)
    // {
    //  method: 'GET',
    //  path: '/deferred-tasks/:id', // Default findOne route
    //  handler: 'deferred-task.findOne', // Core controller action
    //  config: {
    //    policies: [],
    //    middlewares: [],
    //  },
    // }
  ],
};
