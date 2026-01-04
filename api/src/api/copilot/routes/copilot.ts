export default {
  routes: [
    {
      method: "POST",
      path: "/copilot",
      handler: "copilot.default",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::token-auth"],
      },
    },
  ],
};
