import { Context } from "koa";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

export default {
  async upload(ctx: Context) {
    const { body, files } = ctx.request;

    if (!files || !files.file) {
      ctx.throw(400, "No file uploaded.");
    }

    // https://forum.strapi.io/t/how-to-add-a-file-to-a-component-on-entry-creation/24027/2
    // Upload file via upload plugin
    const uploadedFiles = await strapi
      .service("plugin::upload.upload")
      .upload({ files: files.file, data: { fileInfo: {} } });

    const createdEntity = await strapi
      .documents("api::file-link.file-link")
      .create({
        data: {
          slug: uuidv4(),
          file: uploadedFiles[0]?.id, // if attachment field is media type
        },
      });

    return {
      slug: createdEntity.slug,
    }; // data is already filtered for API
  },

  async find(ctx: Context) {
    const id = ctx.params.id;

    const small = ctx.query.small === "true";

    const entity = await strapi
      .documents("api::file-link.file-link")
      .findFirst({
        filters: { slug: id },
        populate: ["file"],
      });

    const { file } = entity;

    if (!entity || !file) {
      ctx.throw(404, "Entity not found");
    }

    let url = file.url;

    if (small) {
      // If we need to resize the image
      const parts = url.split("/");
      const fileName = parts.pop();
      const dir = parts.join("/");

      url = path.join(dir, `small_${fileName}`);

      // Check if the resized version exists
      const absolutePath = path.join(strapi.dirs.static.public, url);
      if (!fs.existsSync(absolutePath)) {
        // If not, return thumbnail
        url = path.join(dir, `thumbnail_${fileName}`);
      }
    }

    const absolutePath = path.join(strapi.dirs.static.public, url);

    const fileBuffer = await fs.promises.readFile(absolutePath);

    ctx.type = file.mime;
    ctx.body = fileBuffer;
  },
};
