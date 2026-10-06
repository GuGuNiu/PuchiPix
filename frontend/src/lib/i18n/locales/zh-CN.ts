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

/** Union of all valid translation keys — composed from submodule key types (no spread inference) */
export type TranslationKey =
  | UiTranslationKeys
  | TasksTranslationKeys
  | BlocklistTranslationKeys
  | ApiTranslationKeys
  | LogTranslationKeys;

export default zhCN;
