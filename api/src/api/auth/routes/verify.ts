import middlewares from "../../../../config/middlewares";

export default {
  routes: [
    {
      method: "GET",
      path: "/auth/verify", // Path relative to /api
      handler: "verify.verify", // Points to the verify action in the verify controller
      config: {
        auth: false,
        // policies: ["global::token-auth"],
        middlewares: ["global::token-auth"],
      },
    },
  ],
};
