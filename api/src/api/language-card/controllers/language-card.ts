import { Context } from "koa";
import { processMarkdown, replaceTemplate } from "../helpers/parser";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import path from "path";
import { tmpdir } from "os";
import { pipeline } from "stream/promises";
import fs from "fs";
import https from "https";
import http from "http";
import { fileTypeFromFile } from "file-type";

async function downloadFileToTemp(url: string, slug: string) {
  const parsed = new URL(url);
  const protocol = parsed.protocol === "https:" ? https : http;

  const tmpPath = path.join(tmpdir(), `download-${slug}`);
  const writeStream = fs.createWriteStream(tmpPath);

  await new Promise((resolve, reject) => {
    protocol
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          return reject(
            new Error(`Failed to download file: ${res.statusCode}`),
          );
        }
        res.pipe(writeStream);
        res.on("end", resolve);
        res.on("error", reject);
      })
      .on("error", reject);
  });

  const stats = fs.statSync(tmpPath);
  const type = await fileTypeFromFile(tmpPath);

  const file = {
    filepath: tmpPath,
    originalFilename: path.basename(parsed.pathname),
    mimetype: type?.mime || "application/octet-stream",
    size: stats.size,
  };

  return file;
}

async function arrayBufferToFile(arrayBuffer: ArrayBuffer, slug: string) {
  const buffer = Buffer.from(arrayBuffer);
  const tmpPath = path.join(tmpdir(), `upload-${slug}`);

  await fs.promises.writeFile(tmpPath, buffer);

  const stats = await fs.promises.stat(tmpPath);
  const type = await fileTypeFromFile(tmpPath);

  return {
    filepath: tmpPath,
    originalFilename: path.basename(`upload-${slug}`),
    mimetype: type?.mime || "application/octet-stream",
    size: stats.size,
  };
}

export default {
  async preview(ctx: Context) {
    const { word, lang } = ctx.request.body;

    const url = process.env.OPENROUTER_API_URL;
    const options = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    };

    const [latvianRussianCardPrompt] = await strapi.entityService.findMany(
      "api::prompt.prompt",
      {
        filters: {
          slug: "latvian-russian-card",
        },
        limit: 1,
      },
    );

    if (!latvianRussianCardPrompt) {
      ctx.throw(500, "Latvian Russian Card prompt not found");
    }

    const [englishRussianCardPrompt] = await strapi.entityService.findMany(
      "api::prompt.prompt",
      {
        filters: {
          slug: "english-russian-card",
        },
        limit: 1,
      },
    );

    if (!englishRussianCardPrompt) {
      ctx.throw(500, "English Russian Card prompt not found");
    }

    const config = await strapi.entityService.findMany(
      "api::ai-config.ai-config",
    );

    const res = await fetch(url, {
      ...options,
      body: JSON.stringify({
        model:
          lang === "lv"
            ? config.OPENROUTER_LV_CARD_MODEL
            : config.OPENROUTER_ENG_CARD_MODEL,
        prompt:
          lang === "lv"
            ? replaceTemplate(latvianRussianCardPrompt.prompt, "word", word)
            : replaceTemplate(englishRussianCardPrompt.prompt, "word", word),
      }),
    });

    if (!res.ok) {
      ctx.throw(500, "Failed to fetch data from OpenRouter API");
    }

    const data = (await res.json()) as { choices?: { text: string }[] };

    if (!data || !data.choices?.[0]?.text) {
      ctx.throw(500, "Invalid response from OpenRouter API");
    }

    const { text } = data.choices[0];

    return {
      text: processMarkdown(text),
    };
  },

  async explain(ctx: Context) {
    const { word, lang } = ctx.request.body;

    const url = process.env.OPENROUTER_API_URL;
    const options = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    };

    const [latvianExplainCardPrompt] = await strapi.entityService.findMany(
      "api::prompt.prompt",
      {
        filters: {
          slug: "latvian-explain-card",
        },
        limit: 1,
      },
    );

    if (!latvianExplainCardPrompt) {
      ctx.throw(500, "Latvian Explain Card prompt not found");
    }

    const [englishExplainCardPrompt] = await strapi.entityService.findMany(
      "api::prompt.prompt",
      {
        filters: {
          slug: "english-explain-card",
        },
        limit: 1,
      },
    );

    if (!englishExplainCardPrompt) {
      ctx.throw(500, "English Explain Card prompt not found");
    }

    const config = await strapi.entityService.findMany(
      "api::ai-config.ai-config",
    );

    const res = await fetch(url, {
      ...options,
      body: JSON.stringify({
        model:
          lang === "lv"
            ? config.OPENROUTER_LV_CARD_MODEL
            : config.OPENROUTER_ENG_CARD_MODEL,
        prompt:
          lang === "lv"
            ? replaceTemplate(latvianExplainCardPrompt.prompt, "word", word)
            : replaceTemplate(englishExplainCardPrompt.prompt, "word", word),
      }),
    });

    if (!res.ok) {
      ctx.throw(500, "Failed to fetch data from OpenRouter API");
    }

    const data = (await res.json()) as { choices?: { text: string }[] };

    if (!data || !data.choices?.[0]?.text) {
      ctx.throw(500, "Invalid response from OpenRouter API");
    }

    const { text } = data.choices[0];

    return {
      text: processMarkdown(text),
    };
  },

  async audioElevenLabs(ctx: Context) {
    const { text, lang, slug } = ctx.request.body;

    const token = process.env.ELEVENLABS_API_TOKEN;

    const client = new ElevenLabsClient({
      apiKey: token,
    });

    const config = await strapi.entityService.findMany(
      "api::ai-config.ai-config",
    );

    const audio = await client.textToSpeech.convert(
      config.ELEVENLABS_VOICE_ID,
      {
        text,
        modelId: config.ELEVENLABS_MODEL_ID,
        outputFormat: "mp3_44100_128",
      },
    );

    const tmpPath = path.join(tmpdir(), `tts-${Date.now()}.mp3`);

    await pipeline(audio, fs.createWriteStream(tmpPath));

    // Then we can create an object in the formidable.File style:
    const file = {
      filepath: tmpPath,
      originalFilename: "speech.mp3",
      mimetype: "audio/mpeg",
      size: fs.statSync(tmpPath).size,
    };

    const uploadedFiles = await strapi
      .service("plugin::upload.upload")
      .upload({ files: file, data: { fileInfo: {} } });

    await strapi.documents("api::file-link.file-link").create({
      data: {
        slug,
        file: uploadedFiles[0]?.id,
      },
    });

    return {
      success: true,
    };
  },

  async audio(ctx: Context) {
    const config = await strapi.entityService.findMany(
      "api::ai-config.ai-config",
    );

    if (config.USE_ELEVEN_LABS) {
      return await this.audioElevenLabs(ctx);
    }

    const { text, lang, slug } = ctx.request.body;

    const url = process.env.OPENAI_AUDIO_API_URL;
    const options = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    };

    const res = await fetch(url, {
      ...options,
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice: "onyx",
      }),
    });

    if (!res.ok) {
      ctx.throw(500, "Failed to fetch data from OpenAI API");
    }

    const arrayBuffer = await res.arrayBuffer();
    const file = await arrayBufferToFile(arrayBuffer, slug);

    const uploadedFiles = await strapi
      .service("plugin::upload.upload")
      .upload({ files: file, data: { fileInfo: {} } });

    await strapi.documents("api::file-link.file-link").create({
      data: {
        slug,
        file: uploadedFiles[0]?.id,
      },
    });

    return {
      success: true,
    };
  },

  async image(ctx: Context) {
    const { text, lang, slug } = ctx.request.body;

    const url = process.env.OPENAI_IMAGE_API_URL;
    const options = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    };

    const [cardIllustrationPrompt] = await strapi.entityService.findMany(
      "api::prompt.prompt",
      {
        filters: {
          slug: "card-illustration",
        },
        limit: 1,
      },
    );

    if (!cardIllustrationPrompt) {
      ctx.throw(500, "Card illustration prompt not found");
    }

    const config = await strapi.entityService.findMany(
      "api::ai-config.ai-config",
    );

    const res = await fetch(url, {
      ...options,
      body: JSON.stringify({
        model: config.OPENAI_IMAGE_MODEL,
        prompt: replaceTemplate(cardIllustrationPrompt.prompt, "text", text),
        n: 1,
        size: "1024x1024",
      }),
    });

    if (!res.ok) {
      ctx.throw(500, "Failed to fetch data from OpenAI API");
    }

    const { data } = (await res.json()) as { data: { url: string }[] };

    const mediaLink = data[0].url;

    const file = await downloadFileToTemp(mediaLink, slug);

    const uploadedFiles = await strapi
      .service("plugin::upload.upload")
      .upload({ files: file, data: { fileInfo: {} } });

    await strapi.documents("api::file-link.file-link").create({
      data: {
        slug,
        file: uploadedFiles[0]?.id,
      },
    });

    return {
      success: true,
    };
  },
};
