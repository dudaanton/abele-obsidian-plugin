import { Context } from "koa";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import fs from "fs";

export default {
  async speechToText(ctx: Context) {
    const { body, files } = ctx.request;

    if (!files || !files.file) {
      ctx.throw(400, "No file uploaded.");
    }

    const token = process.env.ELEVENLABS_API_TOKEN;

    const client = new ElevenLabsClient({
      apiKey: token,
    });

    const config = await strapi.entityService.findMany(
      "api::ai-config.ai-config",
    );

    const file = files.file as any;
    const fileStream = fs.createReadStream(file.filepath);

    const recognizedData = await client.speechToText
      .convert({
        modelId: config.ELEVENLABS_SPEECH_TO_TEXT_MODEL_ID,
        file: fileStream,
        languageCode: "ru",
      })
      .catch((error) => {
        console.error("Speech to text error:", error);
        ctx.throw(500, "Failed to recognize speech.");
      });

    if (!recognizedData || !recognizedData.words) {
      ctx.throw(500, "Failed to recognize speech.");
    }

    const text = recognizedData.words
      .filter((w) => w.type === "word" || w.type === "spacing")
      .map((word) => word.text)
      .join("");

    return {
      text,
      success: true,
    };
  },
};
