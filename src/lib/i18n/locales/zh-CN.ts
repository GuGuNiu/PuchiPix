import type { TranslationDict } from "../types";

import ui from "./ui/zh-CN";
import tasks from "./tasks/zh-CN";
import blocklist from "./blocklist/zh-CN";
import api from "./api/zh-CN";
import log from "./log/zh-CN";
import type { UiTranslationKeys } from "./ui/zh-CN";
import type { TasksTranslationKeys } from "./tasks/zh-CN";
import type { BlocklistTranslationKeys } from "./blocklist/zh-CN";
import type { ApiTranslationKeys } from "./api/zh-CN";
import type { LogTranslationKeys } from "./log/zh-CN";

const zhCN = {
  ...ui,
  ...tasks,
  ...blocklist,
  ...api,
  ...log,
} satisfies TranslationDict;

/** 所有合法的翻译键联合类型 — 从各子模块的键类型组合（不依赖 spread 推断） */
export type TranslationKey =
  | UiTranslationKeys
  | TasksTranslationKeys
  | BlocklistTranslationKeys
  | ApiTranslationKeys
  | LogTranslationKeys;

export default zhCN;
