import type { InferUITool, UIMessage } from "ai";
import type { read } from "../tool/read.js";
import type { terminalTool } from "../tool/terminal.js";
import type { createWrite } from "../tool/write.js";
import { edit } from "../tool/edit.js";
import type { AppRouter } from "../app/index.js";
type terminalTool = InferUITool<ReturnType<typeof terminalTool>>;
type readTool = InferUITool<typeof read>;
type writeTool = InferUITool<ReturnType<typeof createWrite>>;
type editTool = InferUITool<typeof edit>;

export type ChatTools = {
  terminal: terminalTool;
  read: readTool;
  write: writeTool;
  edit: editTool;
};

export type CustomUIDataTypes = {
  codeDelta: {
    path: string;
    content: string;
  };
  textDelta: string;
  writeDelta: string;
  terminalDelta: string;
  workspace: {
    status: "loading" | "ready" | "error";
    message: string;
  };
};

export type ChatMessage = UIMessage<never, CustomUIDataTypes, ChatTools>;

type WebsocketMessage<TType extends string, TBody = {}> = {
  type: TType;
} & TBody;

export type WsClientMessages =
  | WebsocketMessage<"terminal_input", { input: string }>
  | WebsocketMessage<"list_files">
  | WebsocketMessage<"read_file", { path: string }>
  | WebsocketMessage<"write_file", { path: string; content: string }>;

export type WsServerMessages =
  | WebsocketMessage<
      "initial_files",
      { files: { path: string; name: string; isDirectory: boolean }[] }
    >
  | WebsocketMessage<"file_content", { path: string; content: string }>
  | WebsocketMessage<"file_changed", { path: string; content: string }>
  | WebsocketMessage<"error", { message: string }>
  | WebsocketMessage<"file_written", { path: string; content: string }>;

export type Approuter = AppRouter;
