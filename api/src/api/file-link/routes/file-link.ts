export default {
  routes: [
    {
      method: "POST",
      path: "/file-link",
      handler: "file-link.upload",
      config: {
        auth: false,
        policies: [],
        middlewares: ["global::token-auth"],
      },
    },
    {
      method: "GET",
      path: "/file-link/:id",
      handler: "file-link.find",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
