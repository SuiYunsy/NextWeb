import { type OpenAIListModelResponse } from "@/app/client/platforms/openai";
import { getServerSideConfig } from "@/app/config/server";
import { ModelProvider, OpenaiPath } from "@/app/constant";
import { prettyObject } from "@/app/utils/format";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../auth";
import { requestOpenai } from "../../common";

const ALLOWD_PATH = new Set(Object.values(OpenaiPath));

function getModels(remoteModelRes: OpenAIListModelResponse) {
  const config = getServerSideConfig();

  if (config.disableGPT4) {
    remoteModelRes.data = remoteModelRes.data.filter(
      (m) => !m.id.startsWith("gpt-4"),
    );
  }

  return remoteModelRes;
}

async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  console.log("[OpenAI Route] params ", params);

  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  const subpath = params.path.join("/");

  if (!ALLOWD_PATH.has(subpath)) {
    console.log("[OpenAI Route] forbidden path ", subpath);
    return NextResponse.json(
      {
        error: true,
        msg: "you are not allowed to request " + subpath,
      },
      {
        status: 403,
      },
    );
  }

  const authResult = auth(req, ModelProvider.GPT);
  if (authResult.error) {
    return NextResponse.json(authResult, {
      status: 401,
    });
  }

  // 创建一个ReadableStream来处理响应流
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let streamEnded = false;

  const stream = new ReadableStream({
    async start(controller) {
      async function keepAlive() {
        while (!streamEnded) {
          const space = '😋'; // Zero Width Space
          const queue = encoder.encode(space);
          controller.enqueue(queue);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      keepAlive();

      try {
        const response = await requestOpenai(req);

        if (subpath === OpenaiPath.ListModelPath && response.status === 200) {
          const resJson = (await response.json()) as OpenAIListModelResponse;
          const availableModels = getModels(resJson);
          controller.enqueue(encoder.encode(JSON.stringify(availableModels)));
          controller.close();
        } else {
          if(response.body){
          const reader = response.body.getReader();
          const streamReader = async () => {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                streamEnded = true;
                controller.close();
                break;
              }
              controller.enqueue(value);
            }
          };
          streamReader();
        }else {streamEnded=true;controller.close();}}
      } catch (e) {
        console.error("[OpenAI] ", e);
        controller.enqueue(encoder.encode(prettyObject(e)));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/json' }
  });
}

export const GET = handle;
export const POST = handle;
// export const maxDuration = 60;
export const runtime = "edge";
export const preferredRegion = [
  // "arn1",
  // "bom1",
  // "cdg1",
  // "cle1",
  // "cpt1",
  // "dub1",
  "fra1",
  // "gru1",
  // "hnd1",
  // "iad1",
  // "icn1",
  // "kix1",
  // "lhr1",
  // "pdx1",
  // "sfo1",
  // "sin1",
  // "syd1",
];
